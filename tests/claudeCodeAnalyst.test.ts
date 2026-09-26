/**
 * Claude Code analyst: /api/analyze writes a job, the analyst's answer.json
 * (region ids) becomes the scene.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { analyzeWithClaudeCode, segmentJobPhoto } from "../server/lib/claudeCodeAnalyst";

/** 480×360 kitchen-like photo: grey wall, white slab top, lighter face, dark floor. */
async function photo() {
  const w = 480, h = 360;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = [150, 140, 130];
      if (y >= 140 && y < 200 && x >= 80 && x < 400) c = [240, 240, 236];
      else if (y >= 200 && y < 320 && x >= 80 && x < 220) c = [200, 205, 210];
      else if (y >= 320) c = [40, 30, 25];
      px.set(c, (y * w + x) * 3);
    }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

test("a job is written, and the analyst's region answer becomes the scene", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "analyst-"));
  process.env.CLAUDE_CODE_ANALYST_DIR = dir;
  const pending = analyzeWithClaudeCode(await photo(), { name: "Test Stone" });

  // Act as the analyst: wait for the job, pick the regions under the slab and the face.
  let job = "";
  for (let i = 0; i < 100 && !job; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const inbox = path.join(dir, "inbox");
    job = fs.existsSync(inbox) ? fs.readdirSync(inbox).find((j) => fs.existsSync(path.join(inbox, j, "request.json"))) ?? "" : "";
  }
  assert.ok(job, "job folder written");
  const jobDir = path.join(dir, "inbox", job);
  for (const f of ["photo.jpg", "regions.jpg", "request.json"]) assert.ok(fs.existsSync(path.join(jobDir, f)), f);
  const seg = await segmentJobPhoto(path.join(jobDir, "photo.jpg"));
  const at = (x: number, y: number) => seg.labels[Math.floor(y * seg.height) * seg.width + Math.floor(x * seg.width)];
  fs.writeFileSync(
    path.join(jobDir, "answer.json"),
    JSON.stringify({ top: [at(0.5, 0.47)], face: [at(0.3, 0.72)], room_type: "kitchen", summary: "Test" }),
  );

  const scene = await pending;
  assert.equal(scene.room_type, "kitchen");
  const top = scene.surfaces.find((s) => s.orientation === "horizontal");
  const face = scene.surfaces.find((s) => s.orientation === "vertical");
  assert.ok(top && face, "one top and one face");
  const ys = top!.polygon.map((p) => p.y);
  assert.ok(Math.min(...ys) > 0.35 && Math.max(...ys) < 0.6, `top outline stays on the slab (${Math.min(...ys)}–${Math.max(...ys)})`);
  assert.ok(fs.existsSync(path.join(jobDir, "scene.json")));
  fs.rmSync(dir, { recursive: true, force: true });
});
