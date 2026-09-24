/**
 * Browser image helpers: decoding, EXIF-aware downscaling and data-URL
 * conversion. Uploads are normalised to ≤1600 px on the long side so every
 * pipeline (analysis, NVIDIA edit, local render, 3D) sees the same pixels.
 */

export const UPLOAD_MAX_SIDE = 1600;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${src.slice(0, 60)}`));
    img.src = src;
  });
}

function drawScaled(source: CanvasImageSource, w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Reads an uploaded file, applies EXIF orientation and downscales it to a JPEG data URL. */
export async function fileToDataUrl(file: File, maxSide = UPLOAD_MAX_SIDE, quality = 0.92): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, maxSide);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // Older browsers: fall back to <img> decoding (orientation handled by CSS image-orientation default).
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return drawScaled(img, img.naturalWidth, img.naturalHeight, maxSide).toDataURL("image/jpeg", quality);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Loads any image URL (same-origin or CORS-enabled) into a downscaled JPEG data URL. */
export async function urlToDataUrl(url: string, maxSide: number, quality = 0.9): Promise<string> {
  const img = await loadImage(url);
  return drawScaled(img, img.naturalWidth, img.naturalHeight, maxSide).toDataURL("image/jpeg", quality);
}

export function getImageData(img: CanvasImageSource, w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function imageDataToDataUrl(data: ImageData, quality = 0.92): string {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Finds uniform white/black margins around a product swatch (catalogue
 * images are often letterboxed) so they are never tiled as "stone".
 * Pure function over RGBA pixels; returns the content rectangle.
 */
export function findContentRect(data: Uint8ClampedArray, w: number, h: number) {
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const isBorder = (samples: number[]) => {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
    return sd < 8 && (mean > 232 || mean < 22);
  };
  const col = (x: number) => Array.from({ length: Math.ceil(h / 4) }, (_, k) => lum((Math.min(h - 1, k * 4) * w + x) * 4));
  const row = (y: number) => Array.from({ length: Math.ceil(w / 4) }, (_, k) => lum((y * w + Math.min(w - 1, k * 4)) * 4));
  let left = 0;
  let right = w - 1;
  let top = 0;
  let bottom = h - 1;
  while (left < w * 0.4 && isBorder(col(left))) left++;
  while (right > w * 0.6 && isBorder(col(right))) right--;
  while (top < h * 0.4 && isBorder(row(top))) top++;
  while (bottom > h * 0.6 && isBorder(row(bottom))) bottom--;
  // Where a margin was found, trim 2 extra pixels to drop anti-aliased edges.
  const x0 = left > 0 ? left + 2 : 0;
  const x1 = right < w - 1 ? right - 2 : w - 1;
  const y0 = top > 0 ? top + 2 : 0;
  const y1 = bottom < h - 1 ? bottom - 2 : h - 1;
  return { x: x0, y: y0, width: Math.max(1, x1 - x0 + 1), height: Math.max(1, y1 - y0 + 1) };
}

/** Loads a stone swatch, trims catalogue margins and downsizes it for texturing. */
export async function loadSwatch(url: string, maxSide = 1024): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const probe = drawScaled(img, img.naturalWidth, img.naturalHeight, 512);
  const pd = probe.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, probe.width, probe.height);
  const r = findContentRect(pd.data, probe.width, probe.height);
  const sx = img.naturalWidth / probe.width;
  const sy = img.naturalHeight / probe.height;
  const cw = r.width * sx;
  const ch = r.height * sy;
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x * sx, r.y * sy, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Triggers a browser download for a URL or data URL. */
export function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
