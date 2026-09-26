/**
 * StoneSight AI — shared scene contract.
 *
 * `SceneAnalysis` is produced once per visualization by the backend
 * (`POST /api/analyze`, Claude vision — or an NVIDIA-hosted VLM as fallback)
 * and consumed by every downstream feature:
 *
 *   - Static image: the stone surface quads/polygons drive the NVIDIA edit
 *     compositing mask and the local "Claude-guided" stone renderer.
 *   - 3D walkthrough: camera + back wall + surfaces are turned into real room
 *     geometry (see `src/scene/roomGeometry.ts`).
 *   - Video: `video_prompt` feeds NVIDIA Cosmos; the 3D scene feeds the
 *     in-browser first-person recording fallback.
 *
 * Coordinate convention (IMPORTANT, shared with the Claude prompt):
 *   Image points are NORMALISED: x = 0 is the left edge, x = 1 the right edge,
 *   y = 0 is the top edge, y = 1 the bottom edge. Points may lie slightly
 *   outside [0, 1] when a corner is cropped out of frame.
 *
 * This file is dependency-free so both the Vite frontend and the Express
 * backend can import it.
 */

export interface NormPoint {
  x: number;
  y: number;
}

export type SurfaceKind =
  | "countertop"
  | "island"
  | "waterfall_side"
  | "countertop_edge"
  | "backsplash"
  | "vanity_top"
  | "table_top"
  | "wall_cladding"
  | "floor"
  | "fireplace"
  | "shower_wall"
  | "shelf"
  | "other";

export const SURFACE_KINDS: readonly SurfaceKind[] = [
  "countertop",
  "island",
  "waterfall_side",
  "countertop_edge",
  "backsplash",
  "vanity_top",
  "table_top",
  "wall_cladding",
  "floor",
  "fireplace",
  "shower_wall",
  "shelf",
  "other",
];

export type RoomType =
  | "kitchen"
  | "bathroom"
  | "living_room"
  | "dining_room"
  | "outdoor"
  | "other";

export const ROOM_TYPES: readonly RoomType[] = [
  "kitchen",
  "bathroom",
  "living_room",
  "dining_room",
  "outdoor",
  "other",
];

/** One stone surface that should receive the selected material. */
export interface StoneSurface {
  id: string;
  label: string;
  kind: SurfaceKind;
  /** Horizontal = counter/vanity/table tops, vertical = backsplash, waterfall sides, edges. */
  orientation: "horizontal" | "vertical";
  /** Horizontal surfaces: height of the top face above the floor in metres. */
  height_m: number;
  /**
   * Plane-aligned quadrilateral covering the whole surface, corners in
   * perimeter order. Edge quad[0]→quad[1] runs along `length_m`,
   * edge quad[1]→quad[2] along `depth_m` (the slab's width, or its height
   * for vertical surfaces). Used for perspective-correct texture mapping.
   */
  quad: [NormPoint, NormPoint, NormPoint, NormPoint];
  /** Visible outline of the stone (excludes sinks, hobs, objects on top). */
  polygon: NormPoint[];
  length_m: number;
  depth_m: number;
  thickness_m: number;
}

export interface SceneCamera {
  /** Horizontal field of view of the photo in degrees. */
  horizontal_fov_deg: number;
  /** Height of the camera above the floor in metres. */
  eye_height_m: number;
  /** Camera tilt; negative = looking down. */
  pitch_deg: number;
}

/** Where the far wall meets the floor/ceiling (the "Tour Into the Picture" back plane). */
export interface BackWall {
  floor_left: NormPoint;
  floor_right: NormPoint;
  ceiling_left: NormPoint;
  ceiling_right: NormPoint;
}

export interface RoomEstimate {
  width_m: number;
  depth_m: number;
  ceiling_height_m: number;
  /** How much floor there is behind the photographer, in metres. */
  space_behind_camera_m: number;
}

export interface SceneColors {
  walls: string;
  floor: string;
  ceiling: string;
  cabinets: string;
}

export interface SceneAnalysis {
  room_type: RoomType;
  summary: string;
  camera: SceneCamera;
  back_wall: BackWall | null;
  room_estimate: RoomEstimate;
  colors: SceneColors;
  surfaces: StoneSurface[];
  /** Instruction for the NVIDIA FLUX.1 Kontext image-editing model. */
  edit_instruction: string;
  /** First-person, eye-level walkthrough prompt for the NVIDIA Cosmos video model. */
  video_prompt: string;
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

function point(p: unknown, fallback: NormPoint): NormPoint {
  const o = (p ?? {}) as Partial<NormPoint>;
  return {
    x: num(o.x, fallback.x, -2, 3),
    y: num(o.y, fallback.y, -2, 3),
  };
}

function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())
    ? v.trim().toLowerCase()
    : fallback;
}

/** Signed area of a polygon in normalised units (shoelace formula). */
export function polygonArea(pts: NormPoint[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const DEFAULT_COLORS: SceneColors = {
  walls: "#e7e3dc",
  floor: "#8a7560",
  ceiling: "#f1efeb",
  cabinets: "#d9d4cc",
};

/**
 * Normalises any model output (Claude or NVIDIA VLM) into a safe
 * `SceneAnalysis`: clamps every number to a physically plausible range,
 * fills defaults and drops degenerate surfaces. Never throws.
 */
export function sanitizeScene(raw: unknown): SceneAnalysis {
  const r = (raw ?? {}) as Record<string, any>;
  const cam = (r.camera ?? {}) as Record<string, unknown>;
  const est = (r.room_estimate ?? {}) as Record<string, unknown>;
  const col = (r.colors ?? {}) as Record<string, unknown>;

  const surfaces: StoneSurface[] = [];
  const rawSurfaces: any[] = Array.isArray(r.surfaces) ? r.surfaces : [];
  rawSurfaces.slice(0, 16).forEach((s, i) => {
    if (!s || !Array.isArray(s.quad) || s.quad.length !== 4) return;
    const quad = s.quad.map((p: unknown) =>
      point(p, { x: 0.5, y: 0.5 }),
    ) as StoneSurface["quad"];
    if (Math.abs(polygonArea(quad)) < 0.0005) return; // degenerate
    let polygon: NormPoint[] = Array.isArray(s.polygon)
      ? s.polygon.slice(0, 64).map((p: unknown) => point(p, { x: 0.5, y: 0.5 }))
      : [];
    if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 0.0002) {
      polygon = [...quad];
    }
    const kind = SURFACE_KINDS.includes(s.kind) ? (s.kind as SurfaceKind) : "other";
    const orientation =
      s.orientation === "vertical" || s.orientation === "horizontal"
        ? s.orientation
        : kind === "backsplash" || kind === "waterfall_side" || kind === "countertop_edge"
          ? "vertical"
          : "horizontal";
    surfaces.push({
      id: typeof s.id === "string" && s.id ? s.id.slice(0, 40) : `surface_${i + 1}`,
      label: typeof s.label === "string" ? s.label.slice(0, 80) : kind,
      kind,
      orientation,
      height_m: num(s.height_m, 0.9, 0, 3),
      quad,
      polygon,
      length_m: num(s.length_m, 2, 0.1, 20),
      depth_m: num(s.depth_m, 0.6, 0.02, 10),
      thickness_m: num(s.thickness_m, 0.03, 0.01, 0.2),
    });
  });

  let back_wall: BackWall | null = null;
  if (r.back_wall && typeof r.back_wall === "object") {
    const b = r.back_wall as Record<string, unknown>;
    back_wall = {
      floor_left: point(b.floor_left, { x: 0.3, y: 0.62 }),
      floor_right: point(b.floor_right, { x: 0.7, y: 0.62 }),
      ceiling_left: point(b.ceiling_left, { x: 0.3, y: 0.3 }),
      ceiling_right: point(b.ceiling_right, { x: 0.7, y: 0.3 }),
    };
  }

  return {
    room_type: ROOM_TYPES.includes(r.room_type) ? r.room_type : "other",
    summary: typeof r.summary === "string" ? r.summary.slice(0, 500) : "",
    camera: {
      horizontal_fov_deg: num(cam.horizontal_fov_deg, 65, 30, 120),
      eye_height_m: num(cam.eye_height_m, 1.55, 0.5, 3),
      pitch_deg: num(cam.pitch_deg, -8, -60, 45),
    },
    back_wall,
    room_estimate: {
      width_m: num(est.width_m, 4.5, 1.5, 30),
      depth_m: num(est.depth_m, 5, 1.5, 40),
      ceiling_height_m: num(est.ceiling_height_m, 2.6, 2, 8),
      space_behind_camera_m: num(est.space_behind_camera_m, 1.5, 0.5, 10),
    },
    colors: {
      walls: hex(col.walls, DEFAULT_COLORS.walls),
      floor: hex(col.floor, DEFAULT_COLORS.floor),
      ceiling: hex(col.ceiling, DEFAULT_COLORS.ceiling),
      cabinets: hex(col.cabinets, DEFAULT_COLORS.cabinets),
    },
    surfaces,
    edit_instruction:
      typeof r.edit_instruction === "string" ? r.edit_instruction.slice(0, 2000) : "",
    video_prompt: typeof r.video_prompt === "string" ? r.video_prompt.slice(0, 2000) : "",
  };
}

/**
 * Conservative scene used when no analyser is configured or analysis failed.
 * It has no stone surfaces, so it only supports the 3D walkthrough (a generic
 * room shell around the photo) — never the local stone renderer.
 */
export function defaultScene(): SceneAnalysis {
  return sanitizeScene({
    room_type: "other",
    summary: "",
    back_wall: {
      floor_left: { x: 0.28, y: 0.66 },
      floor_right: { x: 0.72, y: 0.66 },
      ceiling_left: { x: 0.28, y: 0.3 },
      ceiling_right: { x: 0.72, y: 0.3 },
    },
    surfaces: [],
  });
}
