/**
 * Browser side of the hand-picked surfaces (shared/manualScene.ts): loads the
 * customer's photo into pixels and segments it.
 */
import type { Segmentation } from "../../shared/segmentation";
import { SEGMENT_LONG_SIDE, segmentPixels } from "../../shared/manualScene";

export * from "../../shared/manualScene";

/** Loads an image element into pixels at the segmentation size and segments it. */
export function segmentImage(img: HTMLImageElement, target = 180): Segmentation {
  const scale = SEGMENT_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(16, Math.round(img.naturalWidth * Math.min(1, scale)));
  const h = Math.max(16, Math.round(img.naturalHeight * Math.min(1, scale)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return segmentPixels(ctx.getImageData(0, 0, w, h).data, w, h, target);
}
