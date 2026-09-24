/**
 * Backend integration tests. The real Express app is exercised against:
 *   - a fake NVIDIA NIM server (FLUX Kontext + Cosmos endpoints), and
 *   - a fake Anthropic Messages API (via ANTHROPIC_BASE_URL), so the real
 *     @anthropic-ai/sdk structured-output call path runs without keys.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

const FIXTURES = path.join(__dirname, "fixtures");
const photo = `data:image/jpeg;base64,${fs.readFileSync(path.join(FIXTURES, "kitchen.jpg")).toString("base64")}`;
const sceneFixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, "kitchen-analysis.json"), "utf8"));

let fake: http.Server;
let app: http.Server;
let fakeBase = "";
let api = "";
const seen: { flux?: any; cosmos?: any; anthropic?: any; anthropicHeaders?: http.IncomingHttpHeaders; anthropicCalls: any[]; gemini?: any } = { anthropicCalls: [] };
let geminiEdit = ""; // base64 JPEG returned by the fake Gemini endpoint

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b));
  });
}

before(async () => {
  const editedPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#224466" } }).png().toBuffer();
  // Fake Gemini edit: the same photo, slightly smaller (as real editors return),
  // with a charcoal slab painted over the island top and a white "unwanted"
  // change on the ceiling that must NOT reach the result.
  const kitchen = await sharp(fs.readFileSync(path.join(FIXTURES, "kitchen.jpg"))).rotate().jpeg({ quality: 95 }).toBuffer();
  const meta = await sharp(kitchen).metadata();
  const W = meta.width!, H = meta.height!;
  const rect = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x * W}" y="${y * H}" width="${w * W}" height="${h * H}" fill="${fill}"/>`;
  const paint = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rect(0.3, 0.58, 0.4, 0.04, "#2b2b2d")}${rect(0.05, 0.02, 0.2, 0.08, "#ff00ff")}</svg>`);
  // sharp resizes before compositing within one pipeline, so do it in two steps.
  const painted = await sharp(kitchen).composite([{ input: paint }]).jpeg({ quality: 95 }).toBuffer();
  geminiEdit = (await sharp(painted).resize(Math.round(W * 0.98), Math.round(H * 0.98)).jpeg().toBuffer()).toString("base64");
  fake = http.createServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/infer") {
      seen.flux = JSON.parse(body);
      res.end(JSON.stringify({ artifacts: [{ base64: editedPng.toString("base64"), finishReason: "SUCCESS" }] }));
    } else if (req.url === "/cosmos") {
      seen.cosmos = JSON.parse(body);
      res.end(JSON.stringify({ b64_video: Buffer.from("fake-mp4-bytes").toString("base64") }));
    } else if (req.url === "/gemini/v1/chat/completions") {
      seen.gemini = JSON.parse(body);
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `![image](data:image/jpeg;base64,${geminiEdit})` } }] }));
    } else if (req.url?.startsWith("/v1/messages")) {
      const call = JSON.parse(body);
      seen.anthropicCalls.push(call);
      const grounding = JSON.stringify(call.messages.at(-1).content).includes("numbered regions");
      if (!grounding) {
        seen.anthropic = call;
        seen.anthropicHeaders = req.headers;
      }
      const reply = grounding
        ? { assignments: [{ surface_id: sceneFixture.surfaces[0].id, regions: [1, 2, 3] }] }
        : sceneFixture;
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: seen.anthropic.model,
          content: [{ type: "text", text: JSON.stringify(reply) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 800 },
        }),
      );
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  fakeBase = fakeUrl;

  Object.assign(process.env, {
    MCP_TEST_MODE: "true",
    FLUX_INFERENCE_URL: `${fakeUrl}/v1/infer`,
    COSMOS_INFERENCE_URL: `${fakeUrl}/cosmos`,
    NVIDIA_API_KEY: "",
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_BASE_URL: fakeUrl,
  });
  const { createApp } = await import("../server/app");
  app = createApp().listen(0);
  await new Promise<void>((r) => app.once("listening", () => r()));
  api = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

after(() => {
  app?.close();
  fake?.close();
});

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${api}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("health reports configured providers without secrets", async () => {
  const res = await fetch(`${api}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.providers.analysis, "claude");
  assert.deepEqual(body.providers.image, ["nvidia-kontext-self-hosted"]);
  assert.deepEqual(body.providers.video, ["nvidia-cosmos"]);
  assert.ok(!JSON.stringify(body).includes("test-key"));
});

test("analyze calls Claude with vision + structured outputs and returns a sanitised scene", async () => {
  const res = await post("/api/analyze", {
    image: photo,
    swatch: photo,
    stone: { name: "Dekton Trilium", category: "Dekton", tone: "Dark", description: "Charcoal with white veins" },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.analyzer, "claude");
  assert.equal(body.analysis.surfaces.length, 3);
  assert.equal(body.analysis.surfaces[0].kind, "island");

  const req = seen.anthropic;
  assert.equal(req.model, "claude-opus-5");
  assert.deepEqual(req.thinking, { type: "adaptive" });
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.fallbacks, "default");
  assert.match(String(seen.anthropicHeaders?.["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  const images = req.messages[0].content.filter((b: any) => b.type === "image");
  assert.equal(images.length, 3, "photo, gridded photo and swatch");
  assert.match(req.system, /normalised/);

  // Second call: set-of-mark grounding on the numbered-region overlay.
  const groundingCall = seen.anthropicCalls.at(-1);
  assert.equal(seen.anthropicCalls.length, 2, "analysis + grounding");
  assert.equal(groundingCall.messages.length, 3, "continues the analysis conversation");
  assert.equal(groundingCall.messages.at(-1).content.filter((b: any) => b.type === "image").length, 1);
});

test("analyze validates input", async () => {
  const res = await post("/api/analyze", { image: photo });
  assert.equal(res.status, 400);
});

test("image generation edits the photo with FLUX Kontext (image-to-image, not text-to-image)", async () => {
  const res = await post("/api/image/generate", { image: photo, prompt: "Replace the island with Dekton Trilium." });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.provider, "nvidia-kontext-self-hosted");
  assert.match(body.image, /^data:image\/png;base64,/);
  assert.equal(seen.flux.aspect_ratio, "match_input_image");
  assert.match(seen.flux.image, /^data:image\/jpeg;base64,/);
  assert.equal(seen.flux.prompt, "Replace the island with Dekton Trilium.");
  const file = path.join(__dirname, "..", "public", body.localPath);
  assert.ok(fs.existsSync(file));
  fs.unlinkSync(file);
});

test("image generation builds a strict template prompt when Claude's instruction is absent", async () => {
  const res = await post("/api/image/generate", { image: photo, stone: { name: "Sandik", category: "Dekton" } });
  assert.equal(res.status, 200);
  assert.match(seen.flux.prompt, /Sandik/);
  assert.match(seen.flux.prompt, /Do not add, remove or move any object/);
  const body = await res.json();
  fs.rmSync(path.join(__dirname, "..", "public", body.localPath), { force: true });
});

test("Gemini edit sees the swatch, and only the stone is composited back into the original", async () => {
  const saved = { FLUX_INFERENCE_URL: process.env.FLUX_INFERENCE_URL };
  Object.assign(process.env, { FLUX_INFERENCE_URL: "", IMAGE_EDIT_BASE_URL: `${fakeBase}/gemini`, IMAGE_EDIT_API_KEY: "img-key" });
  try {
    const swatch = `data:image/jpeg;base64,${(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#2b2b2d" } }).jpeg().toBuffer()).toString("base64")}`;
    const res = await post("/api/image/generate", {
      image: photo,
      swatch,
      scene: sceneFixture,
      prompt: "Replace the island top.",
      stone: { name: "Dekton Trilium", category: "Dekton", description: "Charcoal with white veins" },
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.provider, "gemini-image");
    assert.equal(body.composited, true);

    // Request: room photo + swatch as images, the strict prompt with Claude's instruction.
    const content = seen.gemini.messages[0].content;
    assert.equal(content.filter((c: any) => c.type === "image_url").length, 2);
    const text = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    assert.match(text, /Dekton Trilium/);
    assert.match(text, /Replace the island top\./);
    assert.match(text, /Change ONLY the stone material/);
    assert.deepEqual(seen.gemini.modalities, ["image", "text"]);

    // Result: original size; stone taken from the edit; unwanted ceiling edit discarded.
    const out = await sharp(Buffer.from(body.image.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
    const orig = await sharp(fs.readFileSync(path.join(FIXTURES, "kitchen.jpg"))).rotate().raw().toBuffer({ resolveWithObject: true });
    assert.equal(out.info.width, orig.info.width);
    assert.equal(out.info.height, orig.info.height);
    const px = (img: typeof out, x: number, y: number) => {
      const i = (Math.round(y * img.info.height) * img.info.width + Math.round(x * img.info.width)) * img.info.channels;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    assert.ok(diff(px(out, 0.15, 0.06), px(orig, 0.15, 0.06)) < 12, "ceiling edit must not leak");
    const island = px(out, 0.5, 0.6);
    assert.ok(island.every((v) => v < 90), `island takes the charcoal edit: ${island}`);
    fs.rmSync(path.join(__dirname, "..", "public", body.localPath), { force: true });
  } finally {
    Object.assign(process.env, saved, { IMAGE_EDIT_BASE_URL: "", IMAGE_EDIT_API_KEY: "" });
  }
});

test("video generation runs as a Cosmos job and serves the MP4", async () => {
  const start = await post("/api/video/generate", { image: photo, prompt: "First-person walkthrough at eye level." });
  assert.equal(start.status, 202);
  const { jobId } = await start.json();
  let status: any;
  for (let i = 0; i < 50; i++) {
    status = await (await fetch(`${api}/api/video/status/${jobId}`)).json();
    if (status.status === "succeeded" || status.status === "failed") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(status.status, "succeeded", JSON.stringify(status));
  assert.match(seen.cosmos.negative_prompt, /people/);
  assert.equal(seen.cosmos.prompt, "First-person walkthrough at eye level.");
  const file = await fetch(`${api}${status.videoUrl}`);
  assert.equal(await file.text(), "fake-mp4-bytes");
  fs.rmSync(path.join(__dirname, "..", "public", status.videoUrl), { force: true });
});

test("unknown video jobs return 404", async () => {
  const res = await fetch(`${api}/api/video/status/does-not-exist`);
  assert.equal(res.status, 404);
});

test("missing providers produce structured 503s the frontend can fall back on", async () => {
  const saved = { FLUX_INFERENCE_URL: process.env.FLUX_INFERENCE_URL, COSMOS_INFERENCE_URL: process.env.COSMOS_INFERENCE_URL, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  Object.assign(process.env, { FLUX_INFERENCE_URL: "", COSMOS_INFERENCE_URL: "", ANTHROPIC_API_KEY: "" });
  try {
    const img = await post("/api/image/generate", { image: photo, prompt: "x" });
    assert.equal(img.status, 503);
    assert.equal((await img.json()).code, "IMAGE_EDIT_UNAVAILABLE");
    const vid = await post("/api/video/generate", { image: photo });
    assert.equal(vid.status, 503);
    assert.equal((await vid.json()).code, "NVIDIA_VIDEO_UNAVAILABLE");
    const an = await post("/api/analyze", { image: photo, stone: { name: "X" } });
    assert.equal(an.status, 503);
    assert.equal((await an.json()).code, "NO_ANALYZER");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("auth rejects requests without a token outside test mode", async () => {
  process.env.MCP_TEST_MODE = "false";
  try {
    const res = await post("/api/analyze", { image: photo, stone: { name: "X" } });
    assert.equal(res.status, 401);
  } finally {
    process.env.MCP_TEST_MODE = "true";
  }
});
