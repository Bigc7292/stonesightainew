/**
 * Hand-picked surfaces: the customer (no-AI mode) or the Claude Code analyst
 * marks photo regions as countertop tops or vertical faces.
 *
 * The photo is split into colour-coherent regions in the browser (the same
 * segmentation the server uses for Claude's grounding, ./segmentation.ts),
 * and the tapped regions are turned into the same `SceneAnalysis` surfaces
 * Claude would produce — so the local stone renderer, the 3D walkthrough and
 * the recorded video all work without any AI service or API key.
 */
import { defaultScene, sanitizeScene, type SceneAnalysis, type StoneSurface } from "./scene";
import { segmentRgb, surfaceFromRegions, type Segmentation } from "./segmentation";

/** What a tapped region is: a horizontal countertop top, or a vertical face (waterfall end, slab edge). */
export type SurfaceMark = "top" | "face";

export const SEGMENT_LONG_SIDE = 420;

/** 3×3 box blur on RGBA → RGB (matches the server's light pre-blur). */
function blurToRgb(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  return out;
}

/**
 * Segments raw RGBA pixels into roughly `target` regions (retrying with bigger
 * regions when there are too many). The regions are fine-grained on purpose —
 * a countertop and the wall behind it must never share a region — and the
 * customer paints over as many as needed with a drag.
 */
export function segmentPixels(rgba: Uint8ClampedArray, w: number, h: number, target = 180): Segmentation {
  const rgb = blurToRgb(rgba, w, h);
  let k = 35;
  let seg = segmentRgb(rgb, w, h, k, 0.0008);
  for (let i = 0; i < 5 && seg.count > target * 1.3; i++) {
    k *= 1.4;
    seg = segmentRgb(rgb, w, h, k, 0.0008);
  }
  return seg;
}

/** Region id under a normalised point (0–1), or 0 when outside. */
export function regionAt(seg: Segmentation, nx: number, ny: number): number {
  const x = Math.floor(nx * seg.width), y = Math.floor(ny * seg.height);
  if (x < 0 || y < 0 || x >= seg.width || y >= seg.height) return 0;
  return seg.labels[y * seg.width + x];
}

/** Groups selected region ids into spatially connected groups (one surface each). */
function connectedGroups(seg: Segmentation, ids: Set<number>): number[][] {
  const { width: w, height: h, labels } = seg;
  // Region adjacency among the selected regions.
  const adj = new Map<number, Set<number>>();
  for (const id of ids) adj.set(id, new Set());
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = labels[y * w + x];
      if (!ids.has(a)) continue;
      const right = x + 1 < w ? labels[y * w + x + 1] : a;
      const down = y + 1 < h ? labels[(y + 1) * w + x] : a;
      for (const b of [right, down]) if (b !== a && ids.has(b)) { adj.get(a)!.add(b); adj.get(b)!.add(a); }
    }
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const group: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const n of adj.get(id)!) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    groups.push(group);
  }
  return groups;
}

/** Bounding-box quad (TL, TR, BR, BL) of a set of regions, normalised. */
function regionBoxQuad(seg: Segmentation, ids: number[]): StoneSurface["quad"] {
  const set = new Set(ids);
  let x0 = seg.width, y0 = seg.height, x1 = 0, y1 = 0;
  for (let y = 0; y < seg.height; y++)
    for (let x = 0; x < seg.width; x++)
      if (set.has(seg.labels[y * seg.width + x])) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  const nx = (v: number) => v / seg.width, ny = (v: number) => v / seg.height;
  return [
    { x: nx(x0), y: ny(y0) },
    { x: nx(x1 + 1), y: ny(y0) },
    { x: nx(x1 + 1), y: ny(y1 + 1) },
    { x: nx(x0), y: ny(y1 + 1) },
  ];
}

/**
 * Builds a scene from the customer's taps: every connected group of "top"
 * regions becomes a horizontal countertop, every group of "face" regions a
 * vertical stone face. Room geometry uses the generic default room.
 */
export function buildManualScene(seg: Segmentation, marks: Map<number, SurfaceMark>, stoneName: string): SceneAnalysis {
  const surfaces: StoneSurface[] = [];
  for (const mark of ["top", "face"] as const) {
    const ids = new Set([...marks].filter(([, m]) => m === mark).map(([id]) => id));
    connectedGroups(seg, ids).forEach((group, i) => {
      const quad = regionBoxQuad(seg, group);
      const placeholder: StoneSurface = {
        id: `${mark === "top" ? "countertop" : "stone_face"}_${i + 1}`,
        label: mark === "top" ? "Countertop" : "Vertical stone face",
        kind: mark === "top" ? "countertop" : "waterfall_side",
        orientation: mark === "top" ? "horizontal" : "vertical",
        height_m: mark === "top" ? 0.9 : 0,
        quad,
        polygon: quad,
        length_m: 2.4,
        depth_m: mark === "top" ? 0.65 : 0.9,
        thickness_m: 0.03,
      };
      const surface = surfaceFromRegions(placeholder, group, seg, { trustRegions: true });
      if (surface) surfaces.push(surface);
    });
  }
  const base = defaultScene();
  return sanitizeScene({
    ...base,
    room_type: "kitchen",
    summary: `Surfaces selected by hand for ${stoneName}.`,
    surfaces,
  });
}
