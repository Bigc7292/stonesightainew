/**
 * Turns a 2D `SceneAnalysis` (normalised image coordinates from Claude) into
 * metric 3D room geometry — the basis of the walkable 3D scene and the
 * first-person video.
 *
 * Method ("Tour Into the Picture" reconstruction):
 *   1. A pinhole camera is placed at (0, eye_height, 0) looking down −Z with
 *      the estimated field of view and pitch.
 *   2. The back wall's floor corners are intersected with the floor plane
 *      (y = 0), giving the back wall's position and orientation in metres.
 *      Its ceiling corners give the ceiling height.
 *   3. The room is the rectangle spanned by the back wall and the space
 *      behind the photographer, widened if needed to contain the camera and
 *      every reconstructed surface.
 *   4. Horizontal stone tops are intersected with the plane y = height_m;
 *      vertical stone faces (waterfalls, backsplashes) are reconstructed from
 *      their bottom edge and the vertical plane through it.
 * If the back wall is missing or implausible, Claude's metric room estimate
 * is used instead.
 *
 * World axes: x → right, y → up, z → towards the photographer. Floor-plane
 * points are stored as `Pt` with `x = world x` and `y = world z`.
 *
 * Pure math, no three.js — unit-tested in tests/roomGeometry.test.ts.
 */
import type { NormPoint, SceneAnalysis, StoneSurface, SurfaceKind } from "../../shared/scene";
import { distanceToPolygonEdge, pointInPolygon, type Pt } from "../render/homography";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraModel {
  eye: number;
  pitch: number; // radians, negative = looking down
  hfov: number; // radians
  vfov: number; // radians
  aspect: number; // width / height of the photo
  tanX: number;
  tanY: number;
}

export interface SlabLayout {
  id: string;
  label: string;
  kind: SurfaceKind;
  /** Floor footprint of the slab top (x, z). */
  footprint: Pt[];
  topY: number;
  thickness: number;
  /** Whether a cabinet/base body should be built under the slab. */
  hasBase: boolean;
}

export interface PanelLayout {
  id: string;
  label: string;
  kind: SurfaceKind;
  /** Bottom edge endpoints on the floor plan (x, z). */
  a: Pt;
  b: Pt;
  bottomY: number;
  topY: number;
  thickness: number;
  /** Unit normal (x, z) pointing to the side the camera sees. */
  normal: Pt;
}

export interface Viewpoint {
  id: string;
  label: string;
  position: Vec3;
  yaw: number;
  pitch: number;
}

export interface RoomLayout {
  camera: CameraModel;
  /** Floor rectangle corners: back-left, back-right, front-right, front-left. */
  corners: [Pt, Pt, Pt, Pt];
  ceilingHeight: number;
  /** Unit vector along the back wall (left → right). */
  wallDir: Pt;
  /** Unit vector from the back wall towards the photographer. */
  inward: Pt;
  slabs: SlabLayout[];
  panels: PanelLayout[];
  /** Footprints that block walking (slab bases, tables, panels). */
  obstacles: Pt[][];
  viewpoints: Viewpoint[];
  source: "back-wall" | "estimate";
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

export function makeCamera(scene: SceneAnalysis, aspect: number): CameraModel {
  const hfov = scene.camera.horizontal_fov_deg * DEG;
  const tanX = Math.tan(hfov / 2);
  const tanY = tanX / aspect;
  return {
    eye: scene.camera.eye_height_m,
    pitch: scene.camera.pitch_deg * DEG,
    hfov,
    vfov: 2 * Math.atan(tanY),
    aspect,
    tanX,
    tanY,
  };
}

/** World-space direction of the ray through a normalised image point. */
export function pixelRay(cam: CameraModel, p: NormPoint): Vec3 {
  const cx = (p.x - 0.5) * 2 * cam.tanX;
  const cy = -(p.y - 0.5) * 2 * cam.tanY;
  const cz = -1;
  const c = Math.cos(cam.pitch);
  const s = Math.sin(cam.pitch);
  // Rotation about X by the pitch angle.
  const d = { x: cx, y: cy * c - cz * s, z: cy * s + cz * c };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

/** Projects a world point back into normalised image coordinates. */
export function projectToImage(cam: CameraModel, w: Vec3): NormPoint | null {
  const v = { x: w.x, y: w.y - cam.eye, z: w.z };
  const c = Math.cos(-cam.pitch);
  const s = Math.sin(-cam.pitch);
  const cy = v.y * c - v.z * s;
  const cz = v.y * s + v.z * c;
  if (cz >= -1e-6) return null;
  return {
    x: 0.5 + v.x / -cz / (2 * cam.tanX),
    y: 0.5 - cy / -cz / (2 * cam.tanY),
  };
}

/** Intersects the ray through `p` with the horizontal plane y = planeY. */
export function intersectHorizontal(cam: CameraModel, p: NormPoint, planeY: number): Vec3 | null {
  const d = pixelRay(cam, p);
  if (Math.abs(d.y) < 1e-6) return null;
  const t = (planeY - cam.eye) / d.y;
  if (t <= 0) return null;
  return { x: d.x * t, y: planeY, z: d.z * t };
}

/** Intersects the ray through `p` with the vertical plane through `origin` with floor normal `n`. */
export function intersectVertical(cam: CameraModel, p: NormPoint, origin: Pt, n: Pt): Vec3 | null {
  const d = pixelRay(cam, p);
  const denom = d.x * n.x + d.z * n.y;
  if (Math.abs(denom) < 1e-6) return null;
  const t = (origin.x * n.x + origin.y * n.y) / denom;
  if (t <= 0) return null;
  return { x: d.x * t, y: cam.eye + d.y * t, z: d.z * t };
}

const toFloor = (v: Vec3): Pt => ({ x: v.x, y: v.z });

function polygonAreaXZ(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

const BASE_KINDS: SurfaceKind[] = ["countertop", "island", "vanity_top"];
const PANEL_KINDS: SurfaceKind[] = ["waterfall_side", "backsplash", "wall_cladding", "fireplace", "shower_wall"];
const MAX_DISTANCE = 30;

function buildSlab(cam: CameraModel, s: StoneSurface): SlabLayout | null {
  if (s.orientation !== "horizontal" || s.kind === "floor") return null;
  if (cam.eye <= s.height_m + 0.05) return null; // cannot see a top from below
  const pts = s.quad.map((p) => intersectHorizontal(cam, p, s.height_m));
  if (pts.some((p) => !p || Math.hypot(p.x, p.z) > MAX_DISTANCE)) return null;
  const footprint = (pts as Vec3[]).map(toFloor);
  if (polygonAreaXZ(footprint) < 0.05) return null;
  return {
    id: s.id,
    label: s.label,
    kind: s.kind,
    footprint,
    topY: s.height_m,
    thickness: s.thickness_m,
    hasBase: BASE_KINDS.includes(s.kind),
  };
}

function buildPanel(cam: CameraModel, s: StoneSurface, ceiling: number): PanelLayout | null {
  if (s.orientation !== "vertical" || !PANEL_KINDS.includes(s.kind)) return null;
  // quad order for vertical faces: top-left, top-right, bottom-right, bottom-left.
  const bl = intersectHorizontal(cam, s.quad[3], s.height_m);
  const br = intersectHorizontal(cam, s.quad[2], s.height_m);
  if (!bl || !br) return null;
  const a = toFloor(bl);
  const b = toFloor(br);
  const width = len(sub(b, a));
  if (width < 0.1 || width > 15 || len(a) > MAX_DISTANCE) return null;
  const dir = norm(sub(b, a));
  let n: Pt = { x: -dir.y, y: dir.x };
  if (dot(n, mul(a, -1)) < 0) n = mul(n, -1); // face the camera
  const tl = intersectVertical(cam, s.quad[0], a, n);
  const tr = intersectVertical(cam, s.quad[1], a, n);
  const tops = [tl, tr].filter((v): v is Vec3 => !!v).map((v) => v.y);
  const top = tops.length ? tops.reduce((x, y) => x + y, 0) / tops.length : s.height_m + s.depth_m;
  const topY = clamp(top, s.height_m + 0.05, ceiling);
  return { id: s.id, label: s.label, kind: s.kind, a, b, bottomY: s.height_m, topY, thickness: s.thickness_m, normal: n };
}

export function buildRoomLayout(scene: SceneAnalysis, aspect: number): RoomLayout {
  const cam = makeCamera(scene, aspect);
  const est = scene.room_estimate;
  const behind = est.space_behind_camera_m;
  const camFloor: Pt = { x: 0, y: 0 };

  // --- 1. Back wall ---------------------------------------------------------
  let origin: Pt | null = null; // back-left floor corner
  let wallDir: Pt = { x: 1, y: 0 };
  let inward: Pt = { x: 0, y: 1 };
  let wallWidth = est.width_m;
  let ceiling = est.ceiling_height_m;
  let source: RoomLayout["source"] = "estimate";

  const bw = scene.back_wall;
  if (bw) {
    const fl = intersectHorizontal(cam, bw.floor_left, 0);
    const fr = intersectHorizontal(cam, bw.floor_right, 0);
    if (fl && fr) {
      const a = toFloor(fl);
      const b = toFloor(fr);
      const w = len(sub(b, a));
      if (len(a) > 0.8 && len(a) < 40 && len(b) > 0.8 && len(b) < 40 && w >= 1) {
        const dir = norm(sub(b, a));
        let n: Pt = { x: -dir.y, y: dir.x };
        if (dot(n, sub(camFloor, a)) < 0) n = mul(n, -1);
        if (dot(sub(camFloor, a), n) > 0.8) {
          origin = a;
          wallDir = dir;
          inward = n;
          wallWidth = w;
          source = "back-wall";
          const heights = [bw.ceiling_left, bw.ceiling_right]
            .map((p) => intersectVertical(cam, p, a, n))
            .filter((v): v is Vec3 => !!v && v.y > cam.eye)
            .map((v) => v.y);
          if (heights.length) ceiling = heights.reduce((x, y) => x + y, 0) / heights.length;
        }
      }
    }
  }
  ceiling = clamp(ceiling, Math.max(2.1, cam.eye + 0.4), 8);
  if (!origin) {
    const frontDepth = Math.max(1.5, est.depth_m - behind);
    origin = { x: -est.width_m / 2, y: -frontDepth };
  }

  // Room rectangle in wall-aligned coordinates: s along the wall, t inwards.
  const toRoom = (p: Pt) => ({ s: dot(sub(p, origin!), wallDir), t: dot(sub(p, origin!), inward) });
  const camRoom = toRoom(camFloor);
  let s0 = 0;
  let s1 = wallWidth;
  let t1 = camRoom.t + behind;
  s0 = Math.min(s0, camRoom.s - 0.6);
  s1 = Math.max(s1, camRoom.s + 0.6);

  // --- 2. Stone surfaces ----------------------------------------------------
  const slabs = scene.surfaces.map((s) => buildSlab(cam, s)).filter((s): s is SlabLayout => !!s);
  const panels = scene.surfaces
    .map((s) => buildPanel(cam, s, ceiling))
    .filter((p): p is PanelLayout => !!p);

  // Keep every surface inside the room: grow the rectangle rather than clip.
  const grow = (p: Pt) => {
    const r = toRoom(p);
    s0 = Math.min(s0, r.s - 0.3);
    s1 = Math.max(s1, r.s + 0.3);
    t1 = Math.max(t1, r.t + 0.3);
  };
  slabs.forEach((sl) => sl.footprint.forEach(grow));
  panels.forEach((p) => [p.a, p.b].forEach(grow));
  // Surfaces reconstructed behind the back wall mean the wall estimate was too close.
  let tMin = 0;
  [...slabs.flatMap((s) => s.footprint), ...panels.flatMap((p) => [p.a, p.b])].forEach((p) => {
    tMin = Math.min(tMin, toRoom(p).t - 0.05);
  });

  const fromRoom = (s: number, t: number): Pt => add(origin!, add(mul(wallDir, s), mul(inward, t)));
  const corners: [Pt, Pt, Pt, Pt] = [
    fromRoom(s0, tMin),
    fromRoom(s1, tMin),
    fromRoom(s1, t1),
    fromRoom(s0, t1),
  ];

  // --- 3. Obstacles & viewpoints ---------------------------------------------
  const obstacles: Pt[][] = [
    ...slabs.map((s) => s.footprint),
    ...panels.map((p) => {
      const off = mul(p.normal, -Math.max(p.thickness, 0.05));
      return [p.a, p.b, add(p.b, off), add(p.a, off)];
    }),
  ];

  const layoutBase = { corners, obstacles };
  const viewpoints = buildViewpoints(cam, layoutBase, slabs, fromRoom, s0, s1, tMin, t1);

  return {
    camera: cam,
    corners,
    ceilingHeight: ceiling,
    wallDir,
    inward,
    slabs,
    panels,
    obstacles,
    viewpoints,
    source,
  };
}

/** Whether a floor point is walkable (inside the room, away from obstacles). */
export function isWalkable(layout: Pick<RoomLayout, "corners" | "obstacles">, p: Pt, radius = 0.25): boolean {
  if (!pointInPolygon(p, layout.corners) || distanceToPolygonEdge(p, layout.corners) < radius) return false;
  for (const o of layout.obstacles) {
    if (pointInPolygon(p, o) || distanceToPolygonEdge(p, o) < radius) return false;
  }
  return true;
}

export function yawTowards(from: Pt, to: Pt): number {
  return Math.atan2(-(to.x - from.x), -(to.y - from.y));
}

function buildViewpoints(
  cam: CameraModel,
  layout: Pick<RoomLayout, "corners" | "obstacles">,
  slabs: SlabLayout[],
  fromRoom: (s: number, t: number) => Pt,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
): Viewpoint[] {
  const eye = clamp(cam.eye, 1.4, 1.75);
  const center = fromRoom((s0 + s1) / 2, (t0 + t1) / 2);
  const points: Viewpoint[] = [
    { id: "start", label: "Photo view", position: { x: 0, y: cam.eye, z: 0 }, yaw: 0, pitch: cam.pitch },
  ];

  /** Walks from `p` towards the room centre until the spot is free. */
  const free = (p: Pt): Pt | null => {
    for (let k = 0; k <= 20; k++) {
      const q = add(p, mul(sub(center, p), k / 20));
      if (isWalkable(layout, q, 0.3)) return q;
    }
    return null;
  };

  const inset = 0.6;
  const corners: [string, string, number, number][] = [
    ["back-left", "Back-left corner", s0 + inset, t0 + inset],
    ["back-right", "Back-right corner", s1 - inset, t0 + inset],
    ["front-right", "Front-right corner", s1 - inset, t1 - inset],
    ["front-left", "Front-left corner", s0 + inset, t1 - inset],
  ];
  for (const [id, label, s, t] of corners) {
    const p = free(fromRoom(s, t));
    if (!p) continue;
    points.push({ id, label, position: { x: p.x, y: eye, z: p.y }, yaw: yawTowards(p, center), pitch: -10 * DEG });
  }

  // Close-up of the largest stone surface.
  const main = [...slabs].sort((a, b) => polygonAreaXZ(b.footprint) - polygonAreaXZ(a.footprint))[0];
  if (main) {
    const c = main.footprint.reduce((acc, p) => add(acc, mul(p, 1 / main.footprint.length)), { x: 0, y: 0 });
    // Approach from the photographer's side of the slab.
    const dir = norm(sub({ x: 0, y: 0 }, c));
    for (let d = 0.9; d <= 6; d += 0.15) {
      const p = add(c, mul(dir, d));
      // Must be clear of the slab itself, not just its centre.
      if (isWalkable(layout, p, 0.3)) {
        const drop = eye - main.topY;
        points.push({
          id: "stone",
          label: "Stone close-up",
          position: { x: p.x, y: eye, z: p.y },
          yaw: yawTowards(p, c),
          pitch: -Math.atan2(drop, Math.max(0.4, len(sub(c, p)))),
        });
        break;
      }
    }
  }
  return points;
}
