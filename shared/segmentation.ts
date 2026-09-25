/**
 * Set-of-mark grounding for the scene analysis.
 *
 * Vision models are poor at typing exact coordinates but good at recognising
 * labelled regions. We split the photo into colour-coherent regions
 * (Felzenszwalb–Huttenlocher graph segmentation), draw their outlines and
 * numbers on the photo, let Claude say which numbers are stone, and rebuild
 * each surface's polygon (and, where possible, its quad) from the union of
 * those regions — so outlines follow real edges in the photo.
 *
 * Pure TypeScript on raw RGB, shared by the server (Claude grounding, edit
 * compositing) and the browser (tap-to-select countertops when no AI is
 * configured). Image decoding and drawing live in server/lib/segments.ts.
 */
import type { NormPoint, SceneAnalysis, StoneSurface } from "./scene";
import { polygonArea } from "./scene";

export interface Segmentation {
  width: number;
  height: number;
  /** Region id per pixel, 1..count. */
  labels: Int32Array;
  count: number;
  /** Label anchor (most interior pixel) per region, index = id. */
  anchors: { x: number; y: number }[];
  areas: number[];
  /** Mean CIE Lab colour per region, index = id. */
  colors: [number, number, number][];
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

function toLab(rgb: Uint8Array | Uint8ClampedArray, n: number): Float32Array {
  const lab = new Float32Array(n * 3);
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  for (let i = 0; i < n; i++) {
    const r = lin(rgb[i * 3]), g = lin(rgb[i * 3 + 1]), b = lin(rgb[i * 3 + 2]);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[i * 3] = 116 * y - 16;
    lab[i * 3 + 1] = 500 * (x - y);
    lab[i * 3 + 2] = 200 * (y - z);
  }
  return lab;
}

class DisjointSet {
  parent: Int32Array;
  size: Int32Array;
  internal: Float32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n).fill(1);
    this.internal = new Float32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number, w: number) {
    if (this.size[a] < this.size[b]) [a, b] = [b, a];
    this.parent[b] = a;
    this.size[a] += this.size[b];
    this.internal[a] = w;
  }
}

/**
 * Segments an RGB image. `k` controls region size (larger = bigger regions);
 * regions smaller than `minArea` (fraction of the image) are merged away.
 */
export function segmentRgb(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number, k: number, minArea: number): Segmentation {
  const n = width * height;
  const lab = toLab(rgb, n);
  // 8-connected grid edges (right, down, down-right, down-left).
  const maxEdges = n * 4;
  const ea = new Int32Array(maxEdges);
  const eb = new Int32Array(maxEdges);
  const ew = new Float32Array(maxEdges);
  let m = 0;
  const dist = (i: number, j: number) => {
    const dl = lab[i * 3] - lab[j * 3], da = lab[i * 3 + 1] - lab[j * 3 + 1], db = lab[i * 3 + 2] - lab[j * 3 + 2];
    return Math.sqrt(dl * dl + da * da + db * db);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const add = (j: number) => { ea[m] = i; eb[m] = j; ew[m] = dist(i, j); m++; };
      if (x + 1 < width) add(i + 1);
      if (y + 1 < height) {
        add(i + width);
        if (x + 1 < width) add(i + width + 1);
        if (x > 0) add(i + width - 1);
      }
    }
  }
  const order = new Uint32Array(m);
  for (let i = 0; i < m; i++) order[i] = i;
  order.sort((p, q) => ew[p] - ew[q]);

  const ds = new DisjointSet(n);
  for (let t = 0; t < m; t++) {
    const e = order[t];
    const a = ds.find(ea[e]), b = ds.find(eb[e]);
    if (a === b) continue;
    const w = ew[e];
    if (w <= Math.min(ds.internal[a] + k / ds.size[a], ds.internal[b] + k / ds.size[b])) ds.union(a, b, w);
  }
  const minPx = Math.max(4, Math.round(minArea * n));
  for (let t = 0; t < m; t++) {
    const e = order[t];
    const a = ds.find(ea[e]), b = ds.find(eb[e]);
    if (a !== b && (ds.size[a] < minPx || ds.size[b] < minPx)) ds.union(a, b, ew[e]);
  }

  // Relabel 1..count in raster order of first appearance (top-left first).
  const labels = new Int32Array(n);
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = ds.find(i);
    let id = map.get(r);
    if (id === undefined) { id = map.size + 1; map.set(r, id); }
    labels[i] = id;
  }
  const count = map.size;

  // Anchor = pixel farthest from the region border (two-pass chamfer).
  const d = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, l = labels[i];
    const border = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
      labels[i - 1] !== l || labels[i + 1] !== l || labels[i - width] !== l || labels[i + width] !== l;
    d[i] = border ? 0 : 1e9;
  }
  for (let y = 1; y < height; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    d[i] = Math.min(d[i], d[i - 1] + 1, d[i - width] + 1, d[i - width - 1] + 1.414, d[i - width + 1] + 1.414);
  }
  for (let y = height - 2; y >= 0; y--) for (let x = width - 2; x >= 1; x--) {
    const i = y * width + x;
    d[i] = Math.min(d[i], d[i + 1] + 1, d[i + width] + 1, d[i + width + 1] + 1.414, d[i + width - 1] + 1.414);
  }
  const best = new Float32Array(count + 1).fill(-1);
  const anchors = Array.from({ length: count + 1 }, () => ({ x: 0, y: 0 }));
  const areas = new Array<number>(count + 1).fill(0);
  const colors = Array.from({ length: count + 1 }, () => [0, 0, 0] as [number, number, number]);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    areas[l]++;
    colors[l][0] += lab[i * 3]; colors[l][1] += lab[i * 3 + 1]; colors[l][2] += lab[i * 3 + 2];
    if (d[i] > best[l]) { best[l] = d[i]; anchors[l] = { x: i % width, y: Math.floor(i / width) }; }
  }
  for (let l = 1; l <= count; l++) for (let c = 0; c < 3; c++) colors[l][c] /= Math.max(1, areas[l]);
  return { width, height, labels, count, anchors, areas, colors };
}

// ---------------------------------------------------------------------------
// Mask → polygon / quad
// ---------------------------------------------------------------------------

/** Square-kernel erosion (op = "min") or dilation (op = "max") of a binary mask. */
export function morph(mask: Uint8Array, w: number, h: number, r: number, op: "min" | "max"): Uint8Array {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pick = op === "min" ? (a: number, b: number) => a & b : (a: number, b: number) => a | b;
  const init = op === "min" ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = init;
    for (let d = -r; d <= r; d++) { const nx = x + d; v = pick(v, nx < 0 || nx >= w ? init : mask[y * w + nx]); }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = init;
    for (let d = -r; d <= r; d++) { const ny = y + d; v = pick(v, ny < 0 || ny >= h ? init : tmp[ny * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/** Keeps the largest 8-connected component of a binary mask. */
function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const comp = new Int32Array(w * h);
  let bestId = 0, bestSize = 0, id = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || comp[s]) continue;
    id++;
    let size = 0;
    stack.push(s);
    comp[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !comp[j]) { comp[j] = id; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = comp[i] === bestId && bestId > 0 ? 1 : 0;
  return out;
}

/** Outer boundary of a single-component mask (Moore neighbour tracing), pixel coords. */
function traceBoundary(mask: Uint8Array, w: number, h: number): { x: number; y: number }[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < w * h; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return [];
  // Clockwise neighbours starting west.
  const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const sx = start % w, sy = (start / w) | 0;
  const pts = [{ x: sx, y: sy }];
  let cx = sx, cy = sy, dir = 0; // came from the west
  for (let guard = 0; guard < w * h * 4; guard++) {
    let found = false;
    for (let t = 0; t < 8; t++) {
      const d = (dir + t) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (at(nx, ny)) {
        cx = nx; cy = ny;
        dir = (d + 5) % 8; // resume just clockwise of the pixel we came from
        found = true;
        break;
      }
    }
    if (!found) break; // single pixel
    if (cx === sx && cy === sy) break;
    pts.push({ x: cx, y: cy });
  }
  return pts;
}

function simplify(pts: NormPoint[], tol: number): NormPoint[] {
  if (pts.length < 4) return pts;
  const dp = (a: number, b: number, keep: boolean[]) => {
    let maxD = 0, idx = -1;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = true; dp(a, idx, keep); dp(idx, b, keep); }
  };
  // Split the closed ring at the point farthest from the start.
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y); if (d > fd) { fd = d; far = i; } });
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[far] = true;
  dp(0, far, keep);
  pts.push(pts[0]);
  const keepEnd = [...keep, true];
  dp(far, pts.length - 1, keepEnd);
  pts.pop();
  return pts.filter((_, i) => keepEnd[i]);
}

function convexHull(pts: NormPoint[]): NormPoint[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: NormPoint, a: NormPoint, b: NormPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: NormPoint[] = [], upper: NormPoint[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Largest-area quadrilateral with vertices on the hull (brute force; hull is small). */
function maxAreaQuad(hull: NormPoint[]): NormPoint[] | null {
  const n = hull.length;
  if (n < 4) return null;
  let best = -1, q: number[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const area = Math.abs(polygonArea([hull[a], hull[b], hull[c], hull[d]]));
    if (area > best) { best = area; q = [a, b, c, d]; }
  }
  return q.map((i) => hull[i]);
}

/** Reorders `fit` (a closed quad) to match `ref`'s corner order (cyclic shifts + reversal). */
function matchCorners(fit: NormPoint[], ref: NormPoint[]): NormPoint[] {
  let best = Infinity, out = fit;
  for (const seq of [fit, [...fit].reverse()]) {
    for (let s = 0; s < 4; s++) {
      const cand = [0, 1, 2, 3].map((i) => seq[(i + s) % 4]);
      const cost = cand.reduce((acc, p, i) => acc + Math.hypot(p.x - ref[i].x, p.y - ref[i].y), 0);
      if (cost < best) { best = cost; out = cand; }
    }
  }
  return out;
}

const bbox = (ps: NormPoint[]) => ({
  x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)),
  y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)),
});

/**
 * Drops regions whose colour is far from the surface's dominant colour — one
 * slab of stone reads as one material, so a dark hob or floor region listed
 * with a white marble top is almost certainly a mislabel.
 */
function consistentRegions(ids: number[], seg: Segmentation): Set<number> {
  if (ids.length < 2) return new Set(ids);
  const total = ids.reduce((a, id) => a + seg.areas[id], 0);
  const deltaE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Reference = the region whose colour is closest to the others, area-weighted.
  let ref = ids[0], bestCost = Infinity;
  for (const a of ids) {
    const cost = ids.reduce((acc, b) => acc + seg.areas[b] * deltaE(seg.colors[a], seg.colors[b]), 0) / total;
    if (cost < bestCost) { bestCost = cost; ref = a; }
  }
  return new Set(ids.filter((id) => deltaE(seg.colors[id], seg.colors[ref]) <= 22));
}

/**
 * Rebuilds one surface from the regions Claude assigned to it. Returns null
 * when the regions don't form a usable shape (the caller keeps the original).
 */
export function surfaceFromRegions(
  surface: StoneSurface,
  regions: number[],
  seg: Segmentation,
  opts: {
    /** The regions were chosen by a person (tap-to-select): keep them exactly, no colour filter or spur removal. */
    trustRegions?: boolean;
  } = {},
): StoneSurface | null {
  const { width: w, height: h } = seg;
  const valid = [...new Set(regions.filter((r) => r >= 1 && r <= seg.count))];
  const set = opts.trustRegions ? new Set(valid) : consistentRegions(valid, seg);
  if (set.size === 0) return null;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (set.has(seg.labels[i])) mask[i] = 1;
  // Opening removes thin spurs where a region leaks along a door frame or
  // cable; frame borders count as inside so edge-touching slabs survive.
  const opened = opts.trustRegions ? mask : morph(morph(mask, w, h, 2, "min"), w, h, 2, "max");
  let openedArea = 0;
  for (let i = 0; i < opened.length; i++) openedArea += opened[i];
  if (openedArea > 0) mask = opened;
  mask = largestComponent(mask, w, h);
  let area = 0;
  for (let i = 0; i < mask.length; i++) area += mask[i];
  if (area < w * h * 0.002) return null;

  const ring = traceBoundary(mask, w, h).map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h }));
  if (ring.length < 3) return null;
  let tol = 0.003;
  let polygon = simplify(ring, tol);
  while (polygon.length > 40) { tol *= 1.5; polygon = simplify(ring, tol); }
  if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 0.0005) return null;

  // Quad: the largest quadrilateral inside the region's convex hull. A slab
  // seen in perspective is a quadrilateral, so this recovers its plane far
  // better than typed coordinates; the corners keep Claude's order so edge
  // 0→1 still runs along length_m.
  const fit = maxAreaQuad(simplify(convexHull(polygon), 0.002));
  let quad: StoneSurface["quad"];
  if (fit && Math.abs(polygonArea(fit)) > 0.0005) {
    quad = matchCorners(fit, surface.quad) as StoneSurface["quad"];
  } else {
    const from = bbox(surface.polygon), to = bbox(polygon);
    const sxr = (to.x1 - to.x0) / Math.max(1e-3, from.x1 - from.x0);
    const syr = (to.y1 - to.y0) / Math.max(1e-3, from.y1 - from.y0);
    quad = surface.quad.map((p) => ({ x: to.x0 + (p.x - from.x0) * sxr, y: to.y0 + (p.y - from.y0) * syr })) as StoneSurface["quad"];
  }
  return { ...surface, polygon, quad };
}

/** Applies Claude's region assignments to a scene, surface by surface. */
export function applyRegionAssignments(
  scene: SceneAnalysis,
  assignments: { surface_id: string; regions: number[] }[],
  seg: Segmentation,
): { scene: SceneAnalysis; updated: string[] } {
  const updated: string[] = [];
  const surfaces = scene.surfaces.map((s) => {
    const a = assignments.find((x) => x.surface_id === s.id);
    const next = a ? surfaceFromRegions(s, a.regions, seg) : null;
    if (next) updated.push(s.id);
    return next ?? s;
  });
  return { scene: { ...scene, surfaces }, updated };
}
