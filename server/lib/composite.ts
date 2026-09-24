/**
 * Puts a generative edit back into the customer's original photo so that
 * ONLY the stone changes.
 *
 * 1. Align: generative editors re-render the whole frame and drift by a few
 *    pixels (and sometimes return a slightly different size). The edit is
 *    resized to the original and a similarity transform (scale + shift) is
 *    found by maximising gradient-magnitude correlation, coarse to fine.
^ * 2. Mask: Claude's grounded stone polygons, plus any photo region that the
 *    editor clearly changed INTO the chosen stone (it changed a lot and its
 *    new colour matches the swatch) — this recovers surfaces the analysis
 *    missed without letting through unwanted edits elsewhere.
 * 3. Blend: feathered mask, original pixels everywhere else.
 */
import sharp from "sharp";
import type { SceneAnalysis } from "../../shared/scene";
import { polygonMask } from "../../src/render/stoneRenderer";
import { findContentRect } from "../../src/lib/imageUtils";
import { morph, segmentRgb, type Segmentation } from "./segments";

interface Gray {
  w: number;
  h: number;
  v: Float32Array;
}

async function grayGradient(buf: Buffer, w: number, h: number): Promise<Gray> {
  const { data } = await sharp(buf).resize(w, h, { fit: "fill" }).greyscale().blur(1).raw().toBuffer({ resolveWithObject: true });
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i + 1] - data[i - 1];
      const gy = data[i + w] - data[i - w];
      g[i] = Math.sqrt(gx * gx + gy * gy);
    }
  return { w, h, v: g };
}

export interface Similarity {
  scale: number;
  /** Shift in normalised units (fraction of width / height). */
  tx: number;
  ty: number;
  score: number;
}

/** Normalised cross-correlation of `a` with `b` sampled through the transform (b(x) = b(c + s(x − c) + t)). */
function ncc(a: Gray, b: Gray, t: Similarity, ignore?: Uint8Array): number {
  const { w, h } = a;
  const cx = w / 2, cy = h / 2;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  const step = 2;
  for (let y = 4; y < h - 4; y += step)
    for (let x = 4; x < w - 4; x += step) {
      if (ignore && ignore[y * w + x]) continue;
      const bx = cx + t.scale * (x - cx) + t.tx * w;
      const by = cy + t.scale * (y - cy) + t.ty * h;
      const ix = Math.round(bx), iy = Math.round(by);
      if (ix < 1 || iy < 1 || ix >= w - 1 || iy >= h - 1) continue;
      const va = a.v[y * w + x], vb = b.v[iy * w + ix];
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
    }
  if (n < 100) return -1;
  const cov = sab / n - (sa / n) * (sb / n);
  const den = Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
  return den > 0 ? cov / den : -1;
}

/** Finds the similarity transform mapping original pixel positions into the (resized) edit. */
/**
 * `ignoreMask` (optional, 0/1 at `maskW`×`maskH`) marks pixels expected to
 * change (the stone): they are left out of the score, so it measures how well
 * the unchanged room lines up.
 */
export async function estimateAlignment(
  original: Buffer,
  edited: Buffer,
  width: number,
  height: number,
  ignoreMask?: { data: Uint8Array; w: number; h: number },
): Promise<Similarity> {
  const aspect = height / width;
  let best: Similarity = { scale: 1, tx: 0, ty: 0, score: -1 };
  // Coarse (160 px) → fine (320 px).
  const levels = [
    { w: 160, sRange: 0.05, sStep: 0.01, tRange: 0.05, tStep: 0.006 },
    { w: 320, sRange: 0.012, sStep: 0.002, tRange: 0.008, tStep: 0.0015 },
  ];
  for (const L of levels) {
    const w = L.w, h = Math.max(16, Math.round(L.w * aspect));
    const [a, b] = await Promise.all([grayGradient(original, w, h), grayGradient(edited, w, h)]);
    let ignore: Uint8Array | undefined;
    if (ignoreMask) {
      ignore = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          ignore[y * w + x] = ignoreMask.data[Math.floor((y / h) * ignoreMask.h) * ignoreMask.w + Math.floor((x / w) * ignoreMask.w)];
    }
    const centre = best.score < 0 ? { scale: 1, tx: 0, ty: 0 } : best;
    let levelBest: Similarity = { ...centre, score: ncc(a, b, { ...centre, score: 0 }, ignore) };
    for (let s = centre.scale - L.sRange; s <= centre.scale + L.sRange + 1e-9; s += L.sStep)
      for (let tx = centre.tx - L.tRange; tx <= centre.tx + L.tRange + 1e-9; tx += L.tStep)
        for (let ty = centre.ty - L.tRange; ty <= centre.ty + L.tRange + 1e-9; ty += L.tStep) {
          const cand = { scale: s, tx, ty, score: 0 };
          const score = ncc(a, b, cand, ignore);
          if (score > levelBest.score) levelBest = { ...cand, score };
        }
    best = levelBest;
  }
  return best;
}

/** Warps RGB(A) pixels through the similarity (bilinear). Output has the same size. */
function warp(src: Uint8Array | Buffer, w: number, h: number, ch: number, t: Similarity): Uint8Array {
  const out = new Uint8Array(w * h * ch);
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const bx = Math.min(w - 1.001, Math.max(0, cx + t.scale * (x - cx) + t.tx * w));
      const by = Math.min(h - 1.001, Math.max(0, cy + t.scale * (y - cy) + t.ty * h));
      const x0 = Math.floor(bx), y0 = Math.floor(by), fx = bx - x0, fy = by - y0;
      const i00 = (y0 * w + x0) * ch, i10 = i00 + ch, i01 = i00 + w * ch, i11 = i01 + ch;
      const o = (y * w + x) * ch;
      for (let c = 0; c < ch; c++)
        out[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
    }
  return out;
}

const toLab = (r: number, g: number, b: number): [number, number, number] => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const R = lin(r), G = lin(g), B = lin(b);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Mean Lab colour of a swatch, ignoring catalogue letterbox margins. */
async function meanLab(buf: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).resize(128, 128, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = findContentRect(new Uint8ClampedArray(data), info.width, info.height);
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (y * info.width + x) * 4;
      R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
    }
  return toLab(R / n, G / n, B / n);
}

/**
 * Pixels the edit turned into the chosen stone, cleaned up with a
 * segmentation of the original photo:
 *   - a pixel "became stone" when it changed a lot, its new colour matches
 *     the swatch (mostly hue/chroma — lighting varies across a room, e.g. a
 *     waterfall end in shadow is much darker than the swatch), and it was not
 *     a strongly coloured material before (wood, paint, brick);
 *   - a region where most pixels became stone is taken whole (fills veins);
 *   - a region where only part did (a counter merged with a similar wall) keeps
 *     just those pixels, closed to fill veins and opened to drop specks.
 * Returns a 0/1 mask at segmentation resolution.
 */
function stoneChangeMask(seg: Segmentation, orig: Buffer, edit: Buffer, swatchLab: number[]): Float32Array {
  const { width: w, height: h } = seg;
  const n = w * h;
  const pass = new Uint8Array(n);
  const passCount = new Array<number>(seg.count + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const lo = toLab(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
    const le = toLab(edit[i * 3], edit[i * 3 + 1], edit[i * 3 + 2]);
    const stoneLike = Math.hypot(0.35 * (le[0] - swatchLab[0]), le[1] - swatchLab[1], le[2] - swatchLab[2]) < 18;
    // Strongly coloured originals (wood cabinets, painted walls, brick) were
    // not stone, so the editor turning them into stone is an unwanted change.
    const wasNeutral = Math.hypot(lo[1], lo[2]) < 26;
    if (stoneLike && wasNeutral && dE(lo, le) > 20) { pass[i] = 1; passCount[seg.labels[i]]++; }
  }
  const whole = new Uint8Array(seg.count + 1);
  const partial = new Uint8Array(seg.count + 1);
  for (let id = 1; id <= seg.count; id++) {
    const a = seg.areas[id];
    if (a < n * 0.002) continue; // specks
    const f = passCount[id] / a;
    if (f >= 0.5 && a <= n * 0.25) whole[id] = 1;
    else if (f >= 0.12) partial[id] = 1;
  }
  let part = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (partial[seg.labels[i]] && pass[i]) part[i] = 1;
  part = morph(morph(part, w, h, 2, "max"), w, h, 2, "min"); // close: fill veins
  part = morph(morph(part, w, h, 1, "min"), w, h, 1, "max"); // open: drop specks
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = whole[seg.labels[i]] || (part[i] && partial[seg.labels[i]]) ? 1 : 0;
  return m;
}

export interface CompositeResult {
  buffer: Buffer;
  alignment: Similarity;
  /** False when the edit could not be lined up with the photo (the editor reframed it). */
  aligned: boolean;
  /** Fraction of the photo taken from the edit. */
  editedFraction: number;
}

/** Below this, the unchanged part of the room does not line up: the edit was reframed. */
export const MIN_ALIGNMENT_SCORE = 0.35;

/**
 * Aligns `edited` to `original` and returns the original photo with only the
 * stone taken from the edit.
 */
export async function compositeStoneEdit(
  original: Buffer,
  edited: Buffer,
  scene: SceneAnalysis | null,
  swatch?: Buffer,
): Promise<CompositeResult> {
  const base = await sharp(original).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = base.info;
  const long = Math.max(w, h);
  const origJpeg = await sharp(base.data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const resized = await sharp(edited).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const resizedJpeg = await sharp(resized, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();

  // Mask A: Claude's grounded polygons.
  const mask = new Float32Array(w * h);
  for (const s of scene?.surfaces ?? []) {
    const pm = polygonMask(s.polygon.map((p) => ({ x: p.x * w, y: p.y * h })), w, h, { dilate: long * 0.008, feather: long * 0.005 });
    for (let y = pm.y0; y <= pm.y1; y++)
      for (let x = pm.x0; x <= pm.x1; x++) {
        const k = y * w + x;
        if (pm.values[k] > mask[k]) mask[k] = pm.values[k];
      }
  }

  // Align, scoring only the part of the room that should not change (outside
  // the stone, generously dilated since the editor may re-stone more).
  const iw = 160, ih = Math.max(16, Math.round((160 * h) / w));
  const small = new Uint8Array(iw * ih);
  for (let y = 0; y < ih; y++)
    for (let x = 0; x < iw; x++) small[y * iw + x] = mask[Math.floor((y / ih) * h) * w + Math.floor((x / iw) * w)] > 0 ? 1 : 0;
  const ignore = morph(small, iw, ih, 4, "max");
  let alignment = await estimateAlignment(origJpeg, resizedJpeg, w, h, { data: ignore, w: iw, h: ih });
  const aligned = alignment.score >= MIN_ALIGNMENT_SCORE;
  if (alignment.score < 0.25) alignment = { scale: 1, tx: 0, ty: 0, score: alignment.score }; // not trustworthy
  const warped = warp(resized, w, h, 3, alignment);

  // Mask B: regions the editor turned into the stone (at segmentation resolution, feathered on upsampling).
  const sw = Math.round(420 * (w >= h ? 1 : w / h)), sh = Math.round(420 * (h > w ? 1 : h / w));
  const [o, e] = await Promise.all([
    sharp(base.data, { raw: { width: w, height: h, channels: 3 } }).resize(sw, sh, { fit: "fill" }).raw().toBuffer(),
    sharp(Buffer.from(warped), { raw: { width: w, height: h, channels: 3 } }).resize(sw, sh, { fit: "fill" }).raw().toBuffer(),
  ]);
  const blurred = await sharp(o, { raw: { width: sw, height: sh, channels: 3 } }).blur(0.8).raw().toBuffer();
  const seg = segmentRgb(blurred, sw, sh, 60, 0.0015);
  const swatchLab = swatch ? await meanLab(swatch) : null;
  const change = swatchLab && aligned ? stoneChangeMask(seg, o, e, swatchLab) : new Float32Array(sw * sh);
  // Only trust "the editor turned this into stone" when the area is plausible.
  const changedFraction = change.reduce((acc, v) => acc + v, 0) / change.length;
  if (changedFraction > 0.35) change.fill(0);
  const changeImg = await sharp(Buffer.from(change.map((v) => v * 255)), { raw: { width: sw, height: sh, channels: 1 } })
    .blur(1.2)
    .resize(w, h, { fit: "fill", kernel: "linear" })
    .extractChannel(0) // sharp may promote 1-channel raw input to sRGB
    .raw()
    .toBuffer();
  for (let k = 0; k < w * h; k++) mask[k] = Math.max(mask[k], changeImg[k] / 255);

  const out = Buffer.alloc(w * h * 3);
  let taken = 0;
  for (let k = 0; k < w * h; k++) {
    const m = mask[k];
    taken += m;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = base.data[k * 3 + c] * (1 - m) + warped[k * 3 + c] * m;
  }
  const buffer = await sharp(out, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return { buffer, alignment, aligned, editedFraction: taken / (w * h) };
}
