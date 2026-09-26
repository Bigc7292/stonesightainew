/**
 * Unit tests for the pure building blocks: scene sanitising, NVIDIA response
 * handling, homographies, the stone renderer / compositor, swatch trimming
 * and the walkthrough camera path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultScene, sanitizeScene } from "../shared/scene";
import { extractImageBase64, extractVideo, nvidiaInvoke } from "../server/lib/nvidia";
import { extractJsonObject } from "../server/lib/analyzers";
import { applyH, homography, invert3, UNIT_SQUARE } from "../src/render/homography";
import { compositeEdit, polygonMask, renderStone, type Pixels } from "../src/render/stoneRenderer";
import { findContentRect } from "../src/lib/imageUtils";
import { buildRoomLayout, isWalkable, makeCamera, projectToImage } from "../src/scene/roomGeometry";
import { buildWalkthroughPath } from "../src/scene/walkthroughPath";

// --- scene -------------------------------------------------------------------

test("sanitizeScene clamps values, drops degenerate surfaces and fills polygons", () => {
  const s = sanitizeScene({
    camera: { horizontal_fov_deg: 500, eye_height_m: -3, pitch_deg: "x" },
    colors: { walls: "red", floor: "#AABBCC" },
    surfaces: [
      { kind: "island", quad: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.7 }, { x: 0.1, y: 0.7 }], polygon: [] },
      { kind: "countertop", quad: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }] },
      { kind: "not-a-kind", quad: [{ x: 0, y: 0 }] },
    ],
  });
  assert.equal(s.camera.horizontal_fov_deg, 120);
  assert.equal(s.camera.eye_height_m, 0.5);
  assert.equal(s.camera.pitch_deg, -8);
  assert.equal(s.colors.walls, "#e7e3dc");
  assert.equal(s.colors.floor, "#aabbcc");
  assert.equal(s.surfaces.length, 1);
  assert.equal(s.surfaces[0].polygon.length, 4, "polygon falls back to quad");
  assert.equal(s.surfaces[0].orientation, "horizontal");
  assert.equal(defaultScene().surfaces.length, 0);
});

// --- NVIDIA helpers ---------------------------------------------------------------

test("NIM response parsing handles every known shape", () => {
  assert.equal(extractImageBase64({ artifacts: [{ base64: "AAA" }] }), "AAA");
  assert.equal(extractImageBase64({ data: [{ b64_json: "BBB" }] }), "BBB");
  assert.equal(extractImageBase64({ image: "data:image/png;base64,CCC" }), "CCC");
  assert.equal(extractImageBase64({}), undefined);
  assert.deepEqual(extractVideo({ b64_video: "VVV" }), { base64: "VVV" });
  assert.deepEqual(extractVideo({ video: "https://x/y.mp4" }), { url: "https://x/y.mp4" });
  assert.deepEqual(extractVideo({}), {});
});

test("nvidiaInvoke follows NVCF 202 polling until the result is ready", async () => {
  const calls: string[] = [];
  let polls = 0;
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    if (!url.includes("/status/")) return new Response("", { status: 202, headers: { "NVCF-REQID": "req-1" } });
    polls++;
    return polls < 3
      ? new Response("", { status: 202, headers: { "NVCF-REQID": "req-1" } })
      : new Response(JSON.stringify({ artifacts: [{ base64: "OK" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const data = await nvidiaInvoke("https://ai.api.nvidia.com/v1/x", {}, { apiKey: "k", fetchImpl: fakeFetch, pollIntervalMs: 1 });
  assert.equal(extractImageBase64(data), "OK");
  assert.equal(calls.filter((c) => c.endsWith("/status/req-1")).length, 3);
});

test("nvidiaInvoke surfaces HTTP errors with status and body", async () => {
  const fakeFetch = (async () => new Response('{"detail":"Expected: example_id"}', { status: 422 })) as unknown as typeof fetch;
  await assert.rejects(nvidiaInvoke("https://x", {}, { fetchImpl: fakeFetch }), (e: any) => e.status === 422 && /example_id/.test(e.body));
});

test("extractJsonObject tolerates fenced and chatty model output", () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('prefix {"b":{"c":2}} suffix'), { b: { c: 2 } });
  assert.throws(() => extractJsonObject("no json"));
});

// --- homography -----------------------------------------------------------------

test("homography maps the unit square onto a quad and back", () => {
  const quad = [{ x: 10, y: 20 }, { x: 110, y: 30 }, { x: 90, y: 80 }, { x: 5, y: 70 }];
  const H = homography(UNIT_SQUARE, quad)!;
  quad.forEach((q, i) => {
    const p = applyH(H, UNIT_SQUARE[i].x, UNIT_SQUARE[i].y);
    assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6);
  });
  const back = applyH(invert3(H)!, 90, 80);
  assert.ok(Math.abs(back.x - 1) < 1e-6 && Math.abs(back.y - 1) < 1e-6);
});

// --- renderer -------------------------------------------------------------------

function solid(w: number, h: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
}
const px = (p: Pixels, x: number, y: number) => Array.from(p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 3));

const oneSurface = sanitizeScene({
  surfaces: [
    {
      kind: "countertop",
      orientation: "horizontal",
      quad: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 }],
      polygon: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 }],
      length_m: 1,
      depth_m: 1,
    },
  ],
});

test("polygonMask is solid inside, empty outside, soft at the edge", () => {
  const m = polygonMask([{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }], 40, 40, { feather: 1 });
  assert.equal(m.values[20 * 40 + 20], 1);
  assert.equal(m.values[2 * 40 + 2], 0);
  const edge = m.values[20 * 40 + 10];
  assert.ok(edge > 0 && edge < 1);
});

test("renderStone paints the swatch inside the surface and leaves the rest untouched", () => {
  const photo = solid(80, 80, [128, 128, 128]);
  const swatch = solid(16, 16, [200, 20, 20]);
  const out = renderStone(photo, swatch, oneSurface);
  assert.deepEqual(px(out, 5, 5), [128, 128, 128], "outside unchanged");
  const [r, g, b] = px(out, 40, 40);
  assert.ok(r > 150 && g < 60 && b < 60, `inside takes the stone colour, got ${r},${g},${b}`);
});

test("compositeEdit keeps the original outside the stone mask", () => {
  const photo = solid(80, 80, [128, 128, 128]);
  const edited = solid(80, 80, [0, 255, 0]);
  const out = compositeEdit(photo, edited, oneSurface);
  assert.deepEqual(px(out, 2, 2), [128, 128, 128]);
  assert.deepEqual(px(out, 40, 40), [0, 255, 0]);
});

test("findContentRect trims letterbox margins from catalogue swatches", () => {
  const w = 100;
  const h = 60;
  const img = solid(w, h, [255, 255, 255]);
  for (let y = 0; y < h; y++)
    for (let x = 20; x < 80; x++) img.data.set([60 + ((x * 7 + y * 13) % 90), 60, 60], (y * w + x) * 4);
  const r = findContentRect(img.data, w, h);
  assert.ok(r.x >= 20 && r.x <= 23, `x=${r.x}`);
  assert.ok(r.x + r.width <= 80 && r.x + r.width >= 76, `right=${r.x + r.width}`);
  assert.equal(r.y, 0);
  assert.equal(r.height, h);
});

// --- walkthrough path ---------------------------------------------------------------

test("walkthrough path stays at eye level, looks both ways and never enters obstacles", () => {
  const base = sanitizeScene({
    camera: { horizontal_fov_deg: 70, eye_height_m: 1.6, pitch_deg: -10 },
    room_estimate: { width_m: 5, depth_m: 7, ceiling_height_m: 2.7, space_behind_camera_m: 2 },
  });
  const cam = makeCamera(base, 4 / 3);
  const P = (x: number, y: number, z: number) => projectToImage(cam, { x, y, z })!;
  const scene = sanitizeScene({
    ...base,
    back_wall: { floor_left: P(-2.5, 0, -5), floor_right: P(2.5, 0, -5), ceiling_left: P(-2.5, 2.7, -5), ceiling_right: P(2.5, 2.7, -5) },
    surfaces: [
      {
        kind: "island",
        orientation: "horizontal",
        height_m: 0.92,
        quad: [P(-1, 0.92, -2), P(-1, 0.92, -4), P(0, 0.92, -4), P(0, 0.92, -2)],
        length_m: 2,
        depth_m: 1,
      },
    ],
  });
  const layout = buildRoomLayout(scene, 4 / 3);
  const poseAt = buildWalkthroughPath(layout);
  let minYaw = Infinity;
  let maxYaw = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = poseAt(i / 100);
    assert.ok(Math.abs(p.position.y - 1.6) < 0.05, "eye level");
    assert.ok(isWalkable(layout, { x: p.position.x, y: p.position.z }, 0.2), `walkable at t=${i / 100}`);
    minYaw = Math.min(minYaw, p.yaw);
    maxYaw = Math.max(maxYaw, p.yaw);
  }
  assert.ok(maxYaw > 0.4 && minYaw < -0.4, "looks left and right");
  const end = poseAt(1);
  assert.ok(Math.hypot(end.position.x, end.position.z) > 0.5, "walks into the room");
  assert.ok(end.pitch < 0, "ends looking down at the stone");
});
