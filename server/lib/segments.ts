/**
 * Server-side helpers around the shared segmentation (shared/segmentation.ts):
 * decoding a photo with sharp and drawing the numbered-region overlay that
 * Claude sees in the grounding pass.
 */
import sharp from "sharp";
import { segmentRgb, type Segmentation } from "../../shared/segmentation";

export * from "../../shared/segmentation";

/**
 * Segments a photo into roughly `target` regions (retrying with a larger `k`
 * when there are too many to label legibly).
 */
export async function segmentPhoto(photo: Buffer, target = 50): Promise<Segmentation> {
  const { data, info } = await sharp(photo)
    .resize({ width: 420, height: 420, fit: "inside" })
    .blur(0.8)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let k = 60;
  let seg = segmentRgb(data, info.width, info.height, k, 0.0015);
  for (let i = 0; i < 5 && seg.count > target * 1.3; i++) {
    k *= 1.4;
    seg = segmentRgb(data, info.width, info.height, k, 0.0015);
  }
  return seg;
}

/** Photo with yellow region outlines and a number on every region. */
export async function drawSegmentOverlay(photo: Buffer, width: number, height: number, seg: Segmentation) {
  const { data } = await sharp(photo).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = seg.width / width, sy = seg.height / height;
  const labelAt = (x: number, y: number) =>
    seg.labels[Math.min(seg.height - 1, Math.floor(y * sy)) * seg.width + Math.min(seg.width - 1, Math.floor(x * sx))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = labelAt(x, y);
      const edge = (x + 1 < width && labelAt(x + 1, y) !== l) || (y + 1 < height && labelAt(x, y + 1) !== l);
      if (edge) {
        const i = (y * width + x) * 3;
        data[i] = 255; data[i + 1] = 214; data[i + 2] = 10;
      }
    }
  }
  const font = Math.max(12, Math.round(Math.min(width, height) / 55));
  const texts: string[] = [];
  for (let id = 1; id <= seg.count; id++) {
    const a = seg.anchors[id];
    const x = ((a.x + 0.5) / seg.width) * width, y = ((a.y + 0.5) / seg.height) * height;
    texts.push(
      `<text x="${x.toFixed(0)}" y="${(y + font * 0.35).toFixed(0)}" text-anchor="middle" font-size="${font}" font-weight="bold" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${id}</text>`,
    );
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts.join("")}</svg>`);
  return sharp(data, { raw: { width, height, channels: 3 } }).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
}
