/**
 * Server-side image helpers (sharp).
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

export interface DecodedImage {
  buffer: Buffer;
  mime: string;
}

/** Accepts a data URL or bare base64 and returns the raw bytes. */
export function decodeImage(input: string): DecodedImage {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(input);
  if (match) {
    return {
      mime: match[1] || "image/jpeg",
      buffer: Buffer.from(match[3], match[2] ? "base64" : "utf8"),
    };
  }
  return { mime: "image/jpeg", buffer: Buffer.from(input, "base64") };
}

export function toDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** Detects the real image type from magic bytes (NIMs may return PNG or JPEG). */
export function sniffImageMime(buffer: Buffer): string {
  if (buffer.length > 3 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length > 11 && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/png";
}

/** Resizes so the longest side is at most `maxSide`, re-encoding as JPEG. */
export async function toJpeg(buffer: Buffer, maxSide: number, quality = 90) {
  const img = sharp(buffer).rotate(); // honour EXIF orientation
  const out = await img
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Draws a labelled 10×10 coordinate grid on top of the photo. Giving Claude
 * this second copy of the photo markedly improves the precision of the
 * normalised coordinates it returns.
 */
export async function withCoordinateGrid(buffer: Buffer, width: number, height: number) {
  const lines: string[] = [];
  const fontSize = Math.max(11, Math.round(Math.min(width, height) / 45));
  for (let i = 1; i < 10; i++) {
    const x = (width * i) / 10;
    const y = (height * i) / 10;
    const label = (i / 10).toFixed(1);
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#ff2d55" stroke-opacity="0.75" stroke-width="1.5"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#00e5ff" stroke-opacity="0.75" stroke-width="1.5"/>`,
      `<text x="${x + 3}" y="${fontSize + 2}" font-size="${fontSize}" font-family="sans-serif" fill="#ff2d55" stroke="#000" stroke-width="0.6">${label}</text>`,
      `<text x="3" y="${y - 3}" font-size="${fontSize}" font-family="sans-serif" fill="#00e5ff" stroke="#000" stroke-width="0.6">${label}</text>`,
    );
  }
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.join("")}</svg>`,
  );
  return sharp(buffer).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer();
}

export const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");

/** Persists a generated asset under public/<folder>/ and returns its URL path. */
export function saveGeneratedAsset(folder: "images" | "videos", buffer: Buffer, ext: string): string {
  const dir = path.join(PUBLIC_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${folder === "images" ? "stone" : "walkthrough"}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return `/${folder}/${name}`;
}
