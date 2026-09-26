/**
 * Claude Code analyst: scene analysis done by a Claude Code session working
 * next to the server, with no API key.
 *
 * Enabled with CLAUDE_CODE_ANALYST=on. For every /api/analyze request the
 * server writes a job folder
 *
 *   <CLAUDE_CODE_ANALYST_DIR>/inbox/<id>/
 *     photo.jpg      the customer's photo (≤1280 px)
 *     regions.jpg    the photo with ~180 numbered colour regions
 *     request.json   stone, photo size, region count, answer format
 *
 * and waits for the analyst (Claude Code, reading the images) to write
 * `answer.json` into the same folder:
 *
 *   { "top": [region ids], "face": [region ids],
 *     "room_type"?, "summary"?, "camera"?, "back_wall"?, "room_estimate"?, "colors"? }
 *
 * `top` regions become horizontal countertops, `face` regions vertical stone
 * faces (waterfall ends, thick edges), exactly like the customer's own
 * selection in the no-AI picker (shared/manualScene.ts). Optional fields
 * override the generic room geometry used by the 3D room and the video.
 * `npm run analyst -- preview <id>` draws a draft answer over the photo so it
 * can be checked before it is written as answer.json.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { sanitizeScene, type SceneAnalysis } from "../../shared/scene";
import type { Segmentation } from "../../shared/segmentation";
import { buildManualScene, SEGMENT_LONG_SIDE, segmentPixels, type SurfaceMark } from "../../shared/manualScene";
import { toJpeg } from "./images";
import { drawSegmentOverlay } from "./segments";
import type { StoneInfo } from "./prompts";

export const analystDir = () => path.resolve(process.env.CLAUDE_CODE_ANALYST_DIR || "claude-code");
export const analystEnabled = () => /^(on|true|1)$/i.test(process.env.CLAUDE_CODE_ANALYST || "");
const timeoutMs = () => Number(process.env.CLAUDE_CODE_ANALYST_TIMEOUT_S || 1800) * 1000;

export interface AnalystAnswer {
  top?: number[];
  face?: number[];
  room_type?: string;
  summary?: string;
  camera?: unknown;
  back_wall?: unknown;
  room_estimate?: unknown;
  colors?: unknown;
}

/** Segments a saved job photo exactly as the preview and the answer step do. */
export async function segmentJobPhoto(photoPath: string): Promise<Segmentation> {
  const { data, info } = await sharp(photoPath)
    .resize({ width: SEGMENT_LONG_SIDE, height: SEGMENT_LONG_SIDE, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return segmentPixels(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

/** Turns the analyst's answer into a scene (region ids → traced surfaces). */
export function sceneFromAnswer(seg: Segmentation, answer: AnalystAnswer, stoneName: string): SceneAnalysis {
  const marks = new Map<number, SurfaceMark>();
  for (const id of answer.face ?? []) marks.set(Number(id), "face");
  for (const id of answer.top ?? []) marks.set(Number(id), "top");
  const base = buildManualScene(seg, marks, stoneName);
  const extra: Record<string, unknown> = {};
  for (const k of ["room_type", "summary", "camera", "back_wall", "room_estimate", "colors"] as const)
    if (answer[k] !== undefined) extra[k] = answer[k];
  return sanitizeScene({ ...base, ...extra, surfaces: base.surfaces });
}

/** Photo with the answer's regions filled (gold tops, teal faces) — for checking a draft. */
export async function drawAnswerPreview(photoPath: string, seg: Segmentation, answer: AnalystAnswer): Promise<Buffer> {
  const img = sharp(photoPath);
  const { width = 0, height = 0 } = await img.metadata();
  const { data } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const top = new Set((answer.top ?? []).map(Number)), face = new Set((answer.face ?? []).map(Number));
  const scene = sceneFromAnswer(seg, answer, "preview");
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = seg.labels[Math.min(seg.height - 1, Math.floor((y / height) * seg.height)) * seg.width + Math.min(seg.width - 1, Math.floor((x / width) * seg.width))];
      const c = top.has(l) ? [212, 175, 55] : face.has(l) ? [45, 212, 191] : null;
      if (!c) continue;
      const i = (y * width + x) * 3;
      for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * 0.45 + c[k] * 0.55;
    }
  // Outline each final surface in red so the traced shapes can be checked too.
  const polys = scene.surfaces
    .map((s) => `<polygon points="${s.polygon.map((p) => `${(p.x * width).toFixed(1)},${(p.y * height).toFixed(1)}`).join(" ")}" fill="none" stroke="#ff2d2d" stroke-width="3"/>`)
    .join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${polys}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: svg }]).jpeg({ quality: 88 }).toBuffer();
}

/** Writes the job, waits for answer.json, returns the scene. */
export async function analyzeWithClaudeCode(photo: Buffer, stone: StoneInfo): Promise<SceneAnalysis> {
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(analystDir(), "inbox", id);
  fs.mkdirSync(dir, { recursive: true });
  const jpeg = await toJpeg(photo, 1280, 90);
  const photoPath = path.join(dir, "photo.jpg");
  fs.writeFileSync(photoPath, jpeg.buffer);
  const seg = await segmentJobPhoto(photoPath);
  fs.writeFileSync(path.join(dir, "regions.jpg"), await drawSegmentOverlay(jpeg.buffer, jpeg.width, jpeg.height, seg));
  fs.writeFileSync(
    path.join(dir, "request.json"),
    JSON.stringify(
      {
        id,
        stone,
        photo: { width: jpeg.width, height: jpeg.height },
        regions: seg.count,
        created: new Date().toISOString(),
        answer: "Write answer.json: { top: [ids of countertop-top regions], face: [ids of waterfall/edge regions], optional room_type, summary, camera, back_wall, room_estimate, colors }",
      },
      null,
      2,
    ),
  );
  console.log(`[CLAUDE-CODE] job ${id} waiting for ${path.join(dir, "answer.json")}`);

  const answerPath = path.join(dir, "answer.json");
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    if (fs.existsSync(answerPath)) {
      await new Promise((r) => setTimeout(r, 300)); // let the write finish
      const answer = JSON.parse(fs.readFileSync(answerPath, "utf8")) as AnalystAnswer;
      const scene = sceneFromAnswer(seg, answer, stone.name);
      fs.writeFileSync(path.join(dir, "scene.json"), JSON.stringify(scene, null, 2));
      console.log(`[CLAUDE-CODE] job ${id} answered: ${scene.surfaces.length} surface(s)`);
      return scene;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Claude Code analyst did not answer job ${id} in time`);
}
