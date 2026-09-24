/**
 * Round-trip tests for the 3D reconstruction: build a synthetic room with a
 * known camera, project its corners into the "photo" (what Claude would
 * report), reconstruct, and check we recover the original metric geometry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeScene, defaultScene } from "../shared/scene";
import {
  buildRoomLayout,
  intersectHorizontal,
  isWalkable,
  makeCamera,
  projectToImage,
} from "../src/scene/roomGeometry";

const ASPECT = 4 / 3;
const baseScene = sanitizeScene({
  room_type: "kitchen",
  camera: { horizontal_fov_deg: 70, eye_height_m: 1.6, pitch_deg: -10 },
  room_estimate: { width_m: 5, depth_m: 7, ceiling_height_m: 2.7, space_behind_camera_m: 2 },
});
const cam = makeCamera(baseScene, ASPECT);
const proj = (x: number, y: number, z: number) => {
  const p = projectToImage(cam, { x, y, z });
  assert.ok(p, `point (${x},${y},${z}) must be in front of the camera`);
  return p!;
};
const near = (a: number, b: number, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (±${tol})`);

test("pixel rays and projection are inverse operations", () => {
  const p = proj(0.7, 0.9, -3);
  const back = intersectHorizontal(cam, p, 0.9)!;
  near(back.x, 0.7, 1e-6);
  near(back.z, -3, 1e-6);
});

test("back wall corners reconstruct the room rectangle and ceiling", () => {
  const scene = sanitizeScene({
    ...baseScene,
    back_wall: {
      floor_left: proj(-2.5, 0, -5),
      floor_right: proj(2.5, 0, -5),
      ceiling_left: proj(-2.5, 2.7, -5),
      ceiling_right: proj(2.5, 2.7, -5),
    },
  });
  const layout = buildRoomLayout(scene, ASPECT);
  assert.equal(layout.source, "back-wall");
  const [bl, br, fr, fl] = layout.corners;
  near(bl.x, -2.5); near(bl.y, -5);
  near(br.x, 2.5); near(br.y, -5);
  near(fr.y, 2); near(fl.y, 2); // 2 m of space behind the photographer
  near(layout.ceilingHeight, 2.7, 0.03);
});

test("island top and waterfall side are reconstructed metrically", () => {
  const scene = sanitizeScene({
    ...baseScene,
    back_wall: {
      floor_left: proj(-2.5, 0, -5),
      floor_right: proj(2.5, 0, -5),
      ceiling_left: proj(-2.5, 2.7, -5),
      ceiling_right: proj(2.5, 2.7, -5),
    },
    surfaces: [
      {
        id: "island",
        label: "Island top",
        kind: "island",
        orientation: "horizontal",
        height_m: 0.92,
        quad: [proj(-1, 0.92, -2), proj(-1, 0.92, -4), proj(0, 0.92, -4), proj(0, 0.92, -2)],
        polygon: [],
        length_m: 2,
        depth_m: 1,
        thickness_m: 0.04,
      },
      {
        id: "waterfall",
        label: "Island waterfall",
        kind: "waterfall_side",
        orientation: "vertical",
        height_m: 0,
        quad: [proj(-1, 0.92, -2), proj(0, 0.92, -2), proj(0, 0, -2), proj(-1, 0, -2)],
        polygon: [],
        length_m: 1,
        depth_m: 0.92,
        thickness_m: 0.04,
      },
    ],
  });
  const layout = buildRoomLayout(scene, ASPECT);
  assert.equal(layout.slabs.length, 1);
  const fp = layout.slabs[0].footprint;
  near(fp[0].x, -1); near(fp[0].y, -2);
  near(fp[1].x, -1); near(fp[1].y, -4);
  near(fp[2].x, 0); near(fp[2].y, -4);
  assert.equal(layout.slabs[0].hasBase, true);

  assert.equal(layout.panels.length, 1);
  const panel = layout.panels[0];
  near(panel.a.x, -1); near(panel.a.y, -2);
  near(panel.b.x, 0); near(panel.b.y, -2);
  near(panel.topY, 0.92, 0.03);
  assert.ok(panel.normal.y > 0.9, "waterfall faces the camera");

  // Collision: the island blocks walking, open floor does not.
  assert.equal(isWalkable(layout, { x: -0.5, y: -3 }), false);
  assert.equal(isWalkable(layout, { x: 1.5, y: -1 }), true);
  // Viewpoints: photo view + corners + stone close-up, all walkable.
  const ids = layout.viewpoints.map((v) => v.id);
  assert.ok(ids.includes("start") && ids.includes("stone"));
  assert.ok(ids.filter((i) => i.includes("-")).length >= 3);
  for (const v of layout.viewpoints.filter((v) => v.id !== "start")) {
    assert.ok(isWalkable(layout, { x: v.position.x, y: v.position.z }, 0.29), `${v.id} is walkable`);
  }
});

test("missing back wall falls back to Claude's metric estimate", () => {
  const layout = buildRoomLayout(sanitizeScene({ ...baseScene, back_wall: null }), ASPECT);
  assert.equal(layout.source, "estimate");
  const [bl, br] = layout.corners;
  near(br.x - bl.x, 5, 1.3);
  assert.ok(isWalkable(layout, { x: 0, y: 0.5 }));
});

test("default scene always produces a usable room", () => {
  const layout = buildRoomLayout(defaultScene(), 16 / 9);
  assert.ok(layout.corners.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
  assert.ok(layout.viewpoints.length >= 3);
  assert.ok(layout.ceilingHeight >= 2.1);
});
