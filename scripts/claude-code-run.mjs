/**
 * Runs the real StoneSight app inside this environment with the Claude Code
 * analyst (no API keys): starts the API server (CLAUDE_CODE_ANALYST=on) and
 * the website, then drives Chromium through the customer flow — sign in,
 * upload the photo, pick the stone, Generate — and saves all three outputs.
 *
 *   npm run claude-code:run -- <photo.jpg> ["Stone name"] [--out dir]
 *
 * While it waits at "mapping your room", answer the job it prints with
 * `npm run analyst -- …` (see server/lib/claudeCodeAnalyst.ts).
 * Outputs (default claude-code/results/<photo>-<time>/):
 *   result.jpg (static image), walkthrough.mp4|webm (video),
 *   3d-<viewpoint>.png (interactive 3D room), page.png, run.json.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outArg = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [photoArg, stone = "Dekton Trilium"] = args;
if (!photoArg) {
  console.error('usage: npm run claude-code:run -- <photo.jpg> ["Stone name"] [--out dir]');
  process.exit(2);
}
const photo = path.resolve(photoArg);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const out = path.resolve(outArg || path.join(root, "claude-code", "results", `${path.parse(photo).name}-${stamp}`));
fs.mkdirSync(out, { recursive: true });
const API_PORT = Number(process.env.API_PORT || 5088);
const WEB_PORT = Number(process.env.WEB_PORT || 3088);

const procs = [];
function start(cmd, argv, env) {
  const p = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(out, `${argv.includes("vite") ? "web" : "api"}.log`));
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  // Surface analyst jobs on this script's own output.
  p.stdout.on("data", (d) => String(d).split("\n").filter((l) => l.includes("[CLAUDE-CODE]")).forEach((l) => console.log(l)));
  procs.push(p);
}
const stopAll = () => procs.forEach((p) => p.kill("SIGTERM"));
async function waitFor(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}
const log = (m) => console.log(`[run] ${m}`);

async function main() {
  start("npx", ["tsx", "server/server.ts"], {
    PORT: String(API_PORT),
    MCP_TEST_MODE: "true", // local only: any email/password signs in
    STONESIGHT_DOTENV: "off", // no API keys from .env
    ANTHROPIC_API_KEY: "",
    NVIDIA_API_KEY: "",
    IMAGE_EDIT_API_KEY: "",
    CLAUDE_CODE_ANALYST: "on",
    CLAUDE_CODE_ANALYST_DIR: path.join(root, "claude-code"),
    CLIENT_URL: `http://localhost:${WEB_PORT}`,
  });
  start("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { MCP_TEST_MODE: "true", DISABLE_HMR: "true", VITE_API_URL: `http://localhost:${API_PORT}` });
  await waitFor(`http://localhost:${API_PORT}/api/health`);
  await waitFor(`http://localhost:${WEB_PORT}/`);
  log(`app running: website http://localhost:${WEB_PORT}  api http://localhost:${API_PORT}`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${WEB_PORT}/`);
  await page.fill('input[type="email"]', "claude-code@stonesight.local");
  await page.fill('input[type="password"]', "local-run");
  await page.click('button[type="submit"]');
  await page.setInputFiles('input[type="file"]', photo);
  await page.getByText(stone, { exact: true }).first().click();
  await page.getByRole("button", { name: /Generate Visualization/ }).click();
  log(`generating "${stone}" on ${path.basename(photo)} — waiting for the Claude Code analyst…`);

  // Progress screenshot while the analyst works (useful when a run stalls).
  const progress = setInterval(() => page.screenshot({ path: path.join(out, "progress.png") }).catch(() => {}), 15_000);

  // 1. Static image
  await page.waitForSelector('[data-testid="result-image"]', { timeout: 60 * 60_000 });
  clearInterval(progress);
  const image = await page.locator('[data-testid="result-image"] img').evaluateAll((imgs) => imgs.map((i) => i.src).find((s) => s.startsWith("data:")) || "");
  fs.writeFileSync(path.join(out, "result.jpg"), Buffer.from(image.split(",")[1], "base64"));
  const engine = await page.locator('[data-testid="processing-status"]').innerText();
  log(`static image saved (${engine.trim()})`);

  // 2. Walkthrough video
  let video = null;
  try {
    await page.waitForSelector('[data-testid="walkthrough-video"]', { timeout: 20 * 60_000 });
    video = await page.locator('[data-testid="walkthrough-video"]').evaluate(async (v) => {
      const blob = await (await fetch(v.src)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { type: blob.type, size: blob.size, w: v.videoWidth, h: v.videoHeight, b64: btoa(bin) };
    });
    const file = `walkthrough.${video.type.includes("mp4") ? "mp4" : "webm"}`;
    fs.writeFileSync(path.join(out, file), Buffer.from(video.b64, "base64"));
    video = { file, type: video.type, size: video.size, width: video.w, height: video.h };
    log(`video saved (${file}, ${video.width}×${video.height}, ${Math.round(video.size / 1024)} KB)`);
  } catch (e) {
    log(`video not produced: ${e.message}`);
  }

  // 3. Interactive 3D room — a screenshot from every viewpoint
  const view = page.locator('[data-testid="walkthrough-3d"]');
  await view.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-viewpoint="start"]', { timeout: 60_000 });
  const viewpoints = await page.locator("[data-viewpoint]").evaluateAll((els) => els.map((e) => e.getAttribute("data-viewpoint")));
  for (const vp of viewpoints) {
    await page.click(`[data-viewpoint="${vp}"]`);
    await page.waitForTimeout(1800);
    await view.screenshot({ path: path.join(out, `3d-${vp}.png`) });
  }
  log(`3D room: ${viewpoints.length} viewpoints saved`);
  await page.screenshot({ path: path.join(out, "page.png"), fullPage: true });

  const run = { photo, stone, engine: engine.trim(), video, viewpoints, seconds: Math.round((Date.now() - t0) / 1000), pageErrors: errors };
  fs.writeFileSync(path.join(out, "run.json"), JSON.stringify(run, null, 2));
  log(`done in ${run.seconds} s → ${out}`);
  await browser.close();
}

main()
  .then(() => (stopAll(), process.exit(0)))
  .catch((e) => {
    console.error(e);
    stopAll();
    process.exit(1);
  });
