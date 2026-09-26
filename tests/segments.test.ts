/**
 * Unit tests for set-of-mark grounding: segmentation, region → polygon/quad
 * rebuilding and the colour-consistency filter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRegionAssignments, segmentRgb } from "../server/lib/segments";
import { polygonArea, sanitizeScene } from "../shared/scene";

/** 200×160 image: grey background, white trapezoid "slab", dark "hob" square. */
function synthetic() {
  const w = 200, h = 160;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    // Trapezoid: y 60..120, x from 40+(120-y)/3 .. 160-(120-y)/3.
    const inSlab = y >= 60 && y < 120 && x >= 40 + (120 - y) / 3 && x < 160 - (120 - y) / 3;
    const inHob = y >= 20 && y < 50 && x >= 20 && x < 50;
    const v = inSlab ? [235, 235, 230] : inHob ? [30, 30, 30] : [120, 100, 80];
    rgb.set(v, i);
  }
  return { rgb, w, h };
}

const labelAt = (seg: ReturnType<typeof segmentRgb>, x: number, y: number) => seg.labels[y * seg.width + x];

test("segmentRgb separates uniform regions and records their colours", () => {
  const { rgb, w, h } = synthetic();
  const seg = segmentRgb(rgb, w, h, 60, 0.0015);
  assert.equal(seg.count, 3);
  const slab = labelAt(seg, 100, 100), hob = labelAt(seg, 35, 35), bg = labelAt(seg, 5, 150);
  assert.equal(new Set([slab, hob, bg]).size, 3);
  assert.ok(seg.colors[slab][0] > 85, "slab is light");
  assert.ok(seg.colors[hob][0] < 20, "hob is dark");
  // Anchor sits inside its own region.
  const a = seg.anchors[slab];
  assert.equal(labelAt(seg, a.x, a.y), slab);
});

test("applyRegionAssignments rebuilds polygon and quad from regions and drops colour outliers", () => {
  const { rgb, w, h } = synthetic();
  const seg = segmentRgb(rgb, w, h, 60, 0.0015);
  const slab = labelAt(seg, 100, 100), hob = labelAt(seg, 35, 35);
  const scene = sanitizeScene({
    surfaces: [{
      id: "top", kind: "countertop", orientation: "horizontal",
      // Deliberately wrong, box-shaped guess (as a VLM typically returns).
      quad: [{ x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      polygon: [{ x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
    }],
  });
  const { scene: out, updated } = applyRegionAssignments(scene, [{ surface_id: "top", regions: [slab, hob, 999] }], seg);
  assert.deepEqual(updated, ["top"]);
  const s = out.surfaces[0];
  // Trapezoid area in normalised units: mean width (120+80)/2/200 × height 60/160.
  const expected = (100 / 200) * (60 / 160);
  assert.ok(Math.abs(Math.abs(polygonArea(s.polygon)) - expected) < 0.02, `polygon area ${polygonArea(s.polygon)}`);
  assert.ok(s.polygon.every((p) => p.y > 0.3), "dark hob region was filtered out");
  // Fitted quad hugs the trapezoid and keeps the reference corner order (top-left first).
  assert.ok(Math.abs(s.quad[0].x - 0.3) < 0.04 && Math.abs(s.quad[0].y - 0.375) < 0.04, JSON.stringify(s.quad[0]));
  assert.ok(Math.abs(s.quad[2].x - 0.8) < 0.04 && Math.abs(s.quad[2].y - 0.75) < 0.04, JSON.stringify(s.quad[2]));
});

test("applyRegionAssignments keeps the original surface when no usable regions are given", () => {
  const { rgb, w, h } = synthetic();
  const seg = segmentRgb(rgb, w, h, 60, 0.0015);
  const scene = sanitizeScene({
    surfaces: [{ id: "top", kind: "countertop", quad: [{ x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] }],
  });
  const { scene: out, updated } = applyRegionAssignments(scene, [{ surface_id: "top", regions: [] }, { surface_id: "nope", regions: [1] }], seg);
  assert.deepEqual(updated, []);
  assert.deepEqual(out.surfaces[0], scene.surfaces[0]);
});
