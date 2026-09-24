/**
 * End-to-end test of the full StoneSight flow in real Chromium:
 *   login (test mode) → upload photo → pick stone → Generate →
 *   1) static image, 2) first-person video, 3) interactive 3D walkthrough.
 *
 * AI calls are replaced with deterministic fixtures via request interception
 * (no API keys needed):
 *   - /api/analyze returns tests/fixtures/kitchen-analysis.json (a Claude-format scene analysis)
 *   - Scenario A: no NVIDIA → local Claude-guided renderer + browser-recorded video
 *   - Scenario B: a fake NVIDIA Kontext edit that recolours the WHOLE photo;
 *     asserts the compositor kept every pixel outside the stone mask identical.
 *
 * Usage: npm run test:e2e   (set E2E_OUT=dir to keep screenshots; CHROMIUM_PATH to override)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = process.env.E2E_OUT || path.join(root, "tests", "e2e", "output");
fs.mkdirSync(out, { recursive: true });
const FIXTURE_IMG = path.join(root, "tests", "fixtures", "kitchen.jpg");
const FIXTURE_SCENE = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "kitchen-analysis.json"), "utf8"));
const API_PORT = 5077;
const WEB_PORT = 3077;
const STONE = "Dekton Trilium";

const procs = [];
function start(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
}
async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sceneFor = (stone) =>
  JSON.parse(JSON.stringify(FIXTURE_SCENE).replaceAll("{{STONE}}", stone));

async function runFlow(browser, scenario) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => check(`[${scenario.name}] no page errors`, false, e.message));
  const calls = { analyze: 0, image: 0, video: 0 };

  await page.route(`http://localhost:${API_PORT}/api/health`, (route) =>
    route.fulfill({ json: { ok: true, providers: { analysis: "claude", image: scenario.image ? ["nvidia-kontext-self-hosted"] : [], video: [] } } }),
  );
  await page.route(`http://localhost:${API_PORT}/api/analyze`, async (route) => {
    calls.analyze++;
    const body = route.request().postDataJSON();
    check(`[${scenario.name}] analyze receives photo + swatch + stone`, !!body.image?.startsWith("data:image/") && !!body.swatch && body.stone?.name === STONE);
    await route.fulfill({ json: { success: true, analysis: sceneFor(STONE), analyzer: "claude", model: "claude-opus-5" } });
  });
  if (scenario.image) {
    await page.route(`http://localhost:${API_PORT}/api/image/generate`, async (route) => {
      calls.image++;
      const body = route.request().postDataJSON();
      check(`[${scenario.name}] Kontext receives Claude's edit instruction`, body.prompt?.includes(STONE));
      await route.fulfill({ json: { success: true, image: scenario.editedDataUrl, localPath: "/images/fake.jpg", provider: "nvidia-kontext-self-hosted" } });
    });
  }

  await page.goto(`http://localhost:${WEB_PORT}/`);
  await page.fill('input[type="email"]', "tester@stonesight.ai");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.setInputFiles('input[type="file"]', FIXTURE_IMG);
  await page.getByText(STONE, { exact: true }).first().click();
  await page.getByRole("button", { name: /Generate Visualization/ }).click();

  // 1. Static image
  await page.waitForSelector('[data-testid="result-image"]', { timeout: 60_000 });
  const after = await page.locator('[data-testid="result-image"] img').evaluateAll((imgs) => imgs.map((i) => i.src).find((s) => s.startsWith("data:")) || "");
  check(`[${scenario.name}] static image produced`, after.startsWith("data:image/jpeg"), `${Math.round(after.length / 1024)} KB`);
  fs.writeFileSync(path.join(out, `${scenario.name}-result.jpg`), Buffer.from(after.split(",")[1], "base64"));
  const status = await page.locator('[data-testid="processing-status"]').innerText();
  check(`[${scenario.name}] correct image engine`, status.includes(scenario.expectEngine), status);

  // 2. First-person video (browser-rendered fallback). Waited for first so the
  //    CPU-only CI timing checks below are not competing with the encoder.
  if (scenario.expectVideo) {
    const t0 = Date.now();
    await page.waitForSelector('[data-testid="walkthrough-video"]', { timeout: 600_000 });
    console.log(`  (video ready after ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const meta = await page.locator('[data-testid="walkthrough-video"]').evaluate(async (v) => {
      await new Promise((r) => (v.readyState >= 1 ? r() : v.addEventListener("loadedmetadata", r, { once: true })));
      const blob = await (await fetch(v.src)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { size: blob.size, type: blob.type, w: v.videoWidth, h: v.videoHeight, b64: btoa(bin) };
    });
    check(`[${scenario.name}] walkthrough video recorded`, meta.size > 100_000 && meta.w / meta.h > 1.7 && meta.w >= 960, `${meta.type} ${meta.w}×${meta.h} ${Math.round(meta.size / 1024)} KB`);
    fs.writeFileSync(path.join(out, `${scenario.name}-walkthrough.${meta.type.includes("mp4") ? "mp4" : "webm"}`), Buffer.from(meta.b64, "base64"));
    // Pull frames across the timeline to verify the camera actually travels.
    const frames = await page.locator('[data-testid="walkthrough-video"]').evaluate(async (v) => {
      v.pause();
      const shots = [];
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      // MediaRecorder output can report Infinity duration until fully scanned.
      if (!Number.isFinite(v.duration)) {
        await new Promise((r) => {
          v.addEventListener("durationchange", r, { once: true });
          v.currentTime = 1e6;
        });
      }
      for (const f of [0.04, 0.25, 0.5, 0.75, 0.97]) {
        await new Promise((r) => {
          v.addEventListener("seeked", r, { once: true });
          v.currentTime = f * v.duration;
        });
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        shots.push(c.toDataURL("image/jpeg", 0.85));
      }
      return { shots, duration: v.duration };
    });
    frames.shots.forEach((s, i) => fs.writeFileSync(path.join(out, `${scenario.name}-video-frame-${i}.jpg`), Buffer.from(s.split(",")[1], "base64")));
    const sizes = frames.shots.map((s) => s.length);
    check(`[${scenario.name}] video frames differ over time (camera moves)`, new Set(sizes).size >= 4, `duration ${frames.duration.toFixed ? frames.duration.toFixed(1) : frames.duration}s`);
  }
  // 3. Interactive 3D walkthrough
  const view = page.locator('[data-testid="walkthrough-3d"]');
  await view.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-viewpoint="start"]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  await view.screenshot({ path: path.join(out, `${scenario.name}-3d-start.png`) });
  const viewpoints = await page.locator("[data-viewpoint]").evaluateAll((els) => els.map((e) => e.getAttribute("data-viewpoint")));
  check(`[${scenario.name}] 3D corner viewpoints available`, viewpoints.filter((v) => v.includes("-")).length >= 3, viewpoints.join(", "));
  for (const vp of viewpoints) {
    await page.click(`[data-viewpoint="${vp}"]`);
    await page.waitForTimeout(1800);
    await view.screenshot({ path: path.join(out, `${scenario.name}-3d-${vp}.png`) });
  }
  const pose = () => view.evaluate((el) => {
    const s = el.__stonesight;
    return { x: s.controller.position.x, z: s.controller.position.z, yaw: s.controller.yaw };
  });
  await page.click('[data-viewpoint="start"]');
  await page.waitForTimeout(1800);
  const p0 = await pose();
  await view.focus();
  // Hold each key until the effect is observed (or 8 s pass). Frame rate under
  // software WebGL varies wildly, so a fixed hold time makes the check flaky.
  const holdUntil = async (key, done) => {
    await page.keyboard.down(key);
    const end = Date.now() + 8000;
    while (Date.now() < end && !done(await pose())) await page.waitForTimeout(100);
    await page.keyboard.up(key);
  };
  await holdUntil("w", (p) => Math.hypot(p.x - p0.x, p.z - p0.z) > 0.35);
  const pw = await pose();
  await holdUntil("q", (p) => Math.abs(p.yaw - pw.yaw) > 0.3);
  const p1 = await pose();
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check(`[${scenario.name}] keyboard walking moves the viewer`, moved > 0.3, `${moved.toFixed(2)} m`);
  check(`[${scenario.name}] keyboard turning rotates the view`, Math.abs(p1.yaw - p0.yaw) > 0.25, `${(((p1.yaw - p0.yaw) * 180) / Math.PI).toFixed(0)}°`);
  // Mouse drag look
  const box = await view.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const p2 = await pose();
  check(`[${scenario.name}] mouse drag looks around`, Math.abs(p2.yaw - p1.yaw) > 0.3);
  await view.screenshot({ path: path.join(out, `${scenario.name}-3d-walked.png`) });
  // Collision: walking forward for a long time must never enter the island.
  const blocked = await view.evaluate(async (el) => {
    const { controller, layout } = el.__stonesight;
    controller.goTo(layout.viewpoints[0], false);
    controller.moveInput.forward = 1;
    for (let i = 0; i < 200; i++) controller.update(0.05);
    controller.moveInput.forward = 0;
    const p = { x: controller.position.x, y: controller.position.z };
    const inside = (poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    return { inObstacle: layout.obstacles.some(inside), inRoom: inside(layout.corners) };
  });
  check(`[${scenario.name}] collision keeps viewer out of the island and inside the room`, !blocked.inObstacle && blocked.inRoom);

  await page.screenshot({ path: path.join(out, `${scenario.name}-page.png`), fullPage: true });
  check(`[${scenario.name}] expected backend calls`, calls.analyze === 1 && calls.image === (scenario.image ? 1 : 0), JSON.stringify(calls));
  await page.close();
  return after;
}

async function main() {
  start("npx", ["tsx", "server/server.ts"], { MCP_TEST_MODE: "true", PORT: String(API_PORT), ANTHROPIC_API_KEY: "", NVIDIA_API_KEY: "" });
  start("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { MCP_TEST_MODE: "true", VITE_API_URL: `http://localhost:${API_PORT}` });
  await waitFor(`http://localhost:${API_PORT}/api/health`);
  await waitFor(`http://localhost:${WEB_PORT}/`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    // Scenario A — Claude only (local renderer + browser video)
    await runFlow(browser, { name: "claude-only", image: false, expectEngine: "StoneSight renderer", expectVideo: true });

    // Scenario B — Claude + NVIDIA Kontext: fake edit recolours everything.
    const meta = await sharp(FIXTURE_IMG).metadata();
    const edited = await sharp(FIXTURE_IMG).modulate({ hue: 180, saturation: 2 }).tint("#20ff40").jpeg({ quality: 95 }).toBuffer();
    const resultB = await runFlow(browser, {
      name: "claude-nvidia",
      image: true,
      editedDataUrl: `data:image/jpeg;base64,${edited.toString("base64")}`,
      expectEngine: "NVIDIA FLUX.1 Kontext · Claude precision mask",
      expectVideo: false,
    });
    // Pixels far from every stone polygon must equal the original photo.
    const orig = await sharp(FIXTURE_IMG).raw().toBuffer();
    const res = await sharp(Buffer.from(resultB.split(",")[1], "base64")).resize(meta.width, meta.height).raw().toBuffer();
    const samples = [[0.5, 0.15], [0.2, 0.45], [0.85, 0.85], [0.3, 0.97], [0.62, 0.5], [0.95, 0.3]];
    let maxDiff = 0;
    for (const [nx, ny] of samples) {
      const i = (Math.floor(ny * meta.height) * meta.width + Math.floor(nx * meta.width)) * 3;
      for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(orig[i + c] - res[i + c]));
    }
    check("[claude-nvidia] room outside the stone is unchanged after NVIDIA edit", maxDiff <= 12, `max channel diff ${maxDiff} (JPEG noise only)`);
    const ii = (Math.floor(0.75 * meta.height) * meta.width + Math.floor(0.3 * meta.width)) * 3; // on the waterfall
    const changed = Math.abs(orig[ii] - res[ii]) + Math.abs(orig[ii + 1] - res[ii + 1]) + Math.abs(orig[ii + 2] - res[ii + 2]);
    check("[claude-nvidia] stone area takes the NVIDIA edit", changed > 60, `sum diff ${changed}`);
  } finally {
    await browser.close();
    procs.forEach((p) => p.kill("SIGTERM"));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Artifacts: ${out}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  procs.forEach((p) => p.kill("SIGTERM"));
  process.exit(1);
});
