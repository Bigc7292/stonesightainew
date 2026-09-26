/**
 * Tap-to-select (no-AI mode): regions tapped by the customer become the same
 * scene surfaces Claude would produce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManualScene, regionAt, segmentPixels, type SurfaceMark } from "../src/render/manualScene";
import { polygonArea } from "../shared/scene";

/** 240×180 RGBA: grey wall, white slab top (y 70–100), white-grey face below it (y 100–160, x 40–110), dark floor. */
function kitchen() {
  const w = 240, h = 180;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = [150, 140, 130];
      if (y >= 70 && y < 100 && x >= 40 && x < 200) c = [240, 240, 236]; // countertop top
      else if (y >= 100 && y < 160 && x >= 40 && x < 110) c = [200, 205, 210]; // waterfall face
      else if (y >= 160) c = [40, 30, 25]; // floor
      px.set([...c, 255], i);
    }
  return { px, w, h };
}

test("tapped regions become a horizontal top and a vertical face", () => {
  const { px, w, h } = kitchen();
  const seg = segmentPixels(px, w, h);
  const top = regionAt(seg, 120 / w, 85 / h);
  const face = regionAt(seg, 75 / w, 130 / h);
  assert.ok(top > 0 && face > 0 && top !== face);
  assert.equal(regionAt(seg, 1.5, 0.5), 0, "outside the image");

  const marks = new Map<number, SurfaceMark>([[top, "top"], [face, "face"]]);
  const scene = buildManualScene(seg, marks, "Dekton Trilium");
  assert.equal(scene.surfaces.length, 2);
  const t = scene.surfaces.find((s) => s.orientation === "horizontal")!;
  const f = scene.surfaces.find((s) => s.orientation === "vertical")!;
  assert.equal(t.kind, "countertop");
  assert.equal(f.kind, "waterfall_side");
  // Areas match the painted rectangles (normalised units).
  assert.ok(Math.abs(Math.abs(polygonArea(t.polygon)) - (160 * 30) / (w * h)) < 0.02, `top area ${polygonArea(t.polygon)}`);
  assert.ok(Math.abs(Math.abs(polygonArea(f.polygon)) - (70 * 60) / (w * h)) < 0.02, `face area ${polygonArea(f.polygon)}`);
  // The generic room shell is present so the 3D walkthrough and video work.
  assert.ok(scene.back_wall);
});

test("separate tapped areas become separate surfaces; empty selection gives none", () => {
  const { px, w, h } = kitchen();
  const seg = segmentPixels(px, w, h);
  const top = regionAt(seg, 120 / w, 85 / h);
  const floor = regionAt(seg, 120 / w, 170 / h);
  const two = buildManualScene(seg, new Map<number, SurfaceMark>([[top, "top"], [floor, "top"]]), "X");
  assert.equal(two.surfaces.length, 2, "not connected → two countertops");
  assert.equal(buildManualScene(seg, new Map(), "X").surfaces.length, 0);
});
