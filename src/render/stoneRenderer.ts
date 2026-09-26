/**
 * Claude-guided stone rendering (runs entirely in the browser).
 *
 * Two jobs:
 *
 * 1. `renderStone` — when no NVIDIA image endpoint is available, paints the
 *    chosen stone swatch onto every surface Claude located:
 *      - perspective-correct mapping via a homography from the slab's
 *        unit square onto the surface quad, scaled by its real size in metres;
 *      - the photo's own lighting is transferred with a heavily blurred
 *        luminance ratio (keeps shadows and light fall-off but not the old
 *        stone's pattern), plus strong specular highlights;
 *      - soft-edged masks from the visible polygon, so sinks and objects that
 *        Claude excluded stay untouched.
 *
 * 2. `compositeEdit` — after NVIDIA FLUX Kontext edits the photo, pastes the
 *    edited pixels back into the ORIGINAL photo only inside (slightly dilated)
 *    stone polygons. Everything else is guaranteed byte-identical to the
 *    customer's photo, fixing the "completely different room" problem.
 *
 * The pixel functions are pure (typed arrays in, typed arrays out) and are
 * unit-tested in tests/stoneRenderer.test.ts.
 */
import type { SceneAnalysis, StoneSurface } from "../../shared/scene";
import { applyH, distanceToPolygonEdge, homography, invert3, pointInPolygon, UNIT_SQUARE, type Pt } from "./homography";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface MaskOptions {
  /** Grow the polygon by this many pixels. */
  dilate?: number;
  /** Width of the soft edge in pixels. */
  feather?: number;
}

export interface Mask {
  values: Float32Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Soft polygon mask (0–1 per pixel) with optional dilation. */
export function polygonMask(poly: Pt[], width: number, height: number, opts: MaskOptions = {}): Mask {
  const dilate = opts.dilate ?? 0;
  const feather = Math.max(0.5, opts.feather ?? 1.25);
  const pad = Math.ceil(dilate + feather + 1);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys) + pad));
  const values = new Float32Array(width * height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = { x: x + 0.5, y: y + 0.5 };
      const d = distanceToPolygonEdge(p, poly);
      const signed = (pointInPolygon(p, poly) ? d : -d) + dilate;
      const m = signed / (2 * feather) + 0.5;
      if (m > 0) values[y * width + x] = m >= 1 ? 1 : m;
    }
  }
  return { values, x0, y0, x1, y1 };
}

const luminance = (d: Uint8ClampedArray, i: number) =>
  (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

/** Low-frequency luminance field (lighting only) sampled with bilinear filtering. */
export function lightingField(px: Pixels) {
  const { width: w, height: h, data } = px;
  const cell = Math.max(4, Math.round(Math.max(w, h) / 160));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  let grid = new Float32Array(gw * gh);
  const counts = new Float32Array(gw * gh);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const g = Math.floor(y / cell) * gw + Math.floor(x / cell);
      grid[g] += luminance(data, (y * w + x) * 4);
      counts[g]++;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] /= counts[i] || 1;

  // Two separable box-blur passes (radius 2 cells).
  const blur = (src: Float32Array) => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const r = 2;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < gw) { s += src[y * gw + xx]; n++; }
        }
        tmp[y * gw + x] = s / n;
      }
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < gh) { s += tmp[yy * gw + x]; n++; }
        }
        out[y * gw + x] = s / n;
      }
    return out;
  };
  grid = blur(blur(grid));

  let mean = 0;
  for (let i = 0; i < grid.length; i++) mean += grid[i];
  mean /= grid.length;

  const sample = (x: number, y: number) => {
    const gx = Math.min(gw - 1, Math.max(0, x / cell - 0.5));
    const gy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const ix1 = Math.min(gw - 1, ix + 1);
    const iy1 = Math.min(gh - 1, iy + 1);
    const a = grid[iy * gw + ix] * (1 - fx) + grid[iy * gw + ix1] * fx;
    const b = grid[iy1 * gw + ix] * (1 - fx) + grid[iy1 * gw + ix1] * fx;
    return a * (1 - fy) + b * fy;
  };
  return { sample, mean };
}

/** Mirrored-repeat bilinear sampling of the swatch (avoids visible tile seams). */
function sampleSwatch(sw: Pixels, u: number, v: number, out: number[]) {
  const mirror = (t: number, n: number) => {
    const period = 2 * n;
    let m = ((t % period) + period) % period;
    if (m >= n) m = period - m - 1;
    return Math.min(n - 1, Math.max(0, m));
  };
  const x = mirror(u, sw.width);
  const y = mirror(v, sw.height);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(sw.width - 1, x0 + 1);
  const y1 = Math.min(sw.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = sw.data;
  for (let c = 0; c < 3; c++) {
    const a = d[(y0 * sw.width + x0) * 4 + c] * (1 - fx) + d[(y0 * sw.width + x1) * 4 + c] * fx;
    const b = d[(y1 * sw.width + x0) * 4 + c] * (1 - fx) + d[(y1 * sw.width + x1) * 4 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
}

const toPixels = (pts: { x: number; y: number }[], w: number, h: number): Pt[] =>
  pts.map((p) => ({ x: p.x * w, y: p.y * h }));

export interface RenderOptions {
  /** Real-world width (m) covered by one swatch image. */
  tileMeters?: number;
}

/** Paints the swatch onto every surface Claude located. Returns a new image. */
export function renderStone(photo: Pixels, swatch: Pixels, scene: SceneAnalysis, opts: RenderOptions = {}): Pixels {
  const { width: w, height: h } = photo;
  const out = new Uint8ClampedArray(photo.data);
  const light = lightingField(photo);
  const exposure = Math.min(1.15, Math.max(0.65, light.mean / 0.5));
  const tile = opts.tileMeters ?? 0.9;
  const rgb = [0, 0, 0];

  // Vertical faces first so horizontal tops win where masks overlap.
  const ordered: StoneSurface[] = [...scene.surfaces].sort(
    (a, b) => (a.orientation === "vertical" ? 0 : 1) - (b.orientation === "vertical" ? 0 : 1),
  );

  for (const surface of ordered) {
    const quad = toPixels(surface.quad, w, h);
    const H = homography(UNIT_SQUARE, quad);
    const Hinv = H && invert3(H);
    if (!Hinv) continue;
    const mask = polygonMask(toPixels(surface.polygon, w, h), w, h, { dilate: 0.5, feather: 1.25 });

    // Average lighting over the surface normalises the shading ratio.
    let sum = 0;
    let n = 0;
    for (let y = mask.y0; y <= mask.y1; y += 3)
      for (let x = mask.x0; x <= mask.x1; x += 3)
        if (mask.values[y * w + x] > 0.5) { sum += light.sample(x, y); n++; }
    const regionMean = n ? sum / n : light.mean;

    const pxPerMeter = swatch.width / tile;
    for (let y = mask.y0; y <= mask.y1; y++) {
      for (let x = mask.x0; x <= mask.x1; x++) {
        const m = mask.values[y * w + x];
        if (m <= 0.002) continue;
        const st = applyH(Hinv, x + 0.5, y + 0.5);
        sampleSwatch(swatch, st.x * surface.length_m * pxPerMeter, st.y * surface.depth_m * pxPerMeter, rgb);
        const i = (y * w + x) * 4;
        const L = luminance(photo.data, i);
        const Lb = light.sample(x, y);
        const shade = Math.min(1.6, Math.max(0.35, Lb / (regionMean || 1))) * exposure;
        const highlight = Math.max(0, L - Lb - 0.18) * 1.5 * 255;
        for (let c = 0; c < 3; c++) {
          const stone = rgb[c] * shade + highlight;
          out[i + c] = photo.data[i + c] * (1 - m) + stone * m;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Keeps the original photo everywhere except inside the stone polygons,
 * where the NVIDIA-edited pixels are used. `edited` must already be resized
 * to the photo's dimensions.
 */
export function compositeEdit(photo: Pixels, edited: Pixels, scene: SceneAnalysis): Pixels {
  const { width: w, height: h } = photo;
  if (edited.width !== w || edited.height !== h) throw new Error("edited image must match photo size");
  const union = new Float32Array(w * h);
  const long = Math.max(w, h);
  for (const s of scene.surfaces) {
    const mask = polygonMask(toPixels(s.polygon, w, h), w, h, { dilate: long * 0.012, feather: long * 0.006 });
    for (let y = mask.y0; y <= mask.y1; y++)
      for (let x = mask.x0; x <= mask.x1; x++) {
        const k = y * w + x;
        if (mask.values[k] > union[k]) union[k] = mask.values[k];
      }
  }
  const out = new Uint8ClampedArray(photo.data);
  for (let k = 0; k < w * h; k++) {
    const m = union[k];
    if (m <= 0) continue;
    const i = k * 4;
    for (let c = 0; c < 3; c++) out[i + c] = photo.data[i + c] * (1 - m) + edited.data[i + c] * m;
  }
  return { width: w, height: h, data: out };
}
