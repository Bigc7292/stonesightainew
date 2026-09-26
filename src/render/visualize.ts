/**
 * Browser wrappers around the pure stone renderer: decode images, run the
 * pixel functions, and hand back JPEG data URLs.
 */
import type { SceneAnalysis } from "../../shared/scene";
import { getImageData, imageDataToDataUrl, loadImage, loadSwatch } from "../lib/imageUtils";
import { compositeEdit, renderStone } from "./stoneRenderer";

const asImageData = (p: { width: number; height: number; data: Uint8ClampedArray }) =>
  new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);

/** Local (no NVIDIA) stone visualisation driven by Claude's surface analysis. */
export async function renderStoneLocally(photoUrl: string, swatchUrl: string, scene: SceneAnalysis): Promise<string> {
  const [photo, swatch] = await Promise.all([loadImage(photoUrl), loadSwatch(swatchUrl)]);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const result = renderStone(getImageData(photo, w, h), getImageData(swatch, swatch.width, swatch.height), scene);
  return imageDataToDataUrl(asImageData(result));
}

/** Pastes NVIDIA-edited stone back into the untouched original photo. */
export async function compositeEditedImage(photoUrl: string, editedUrl: string, scene: SceneAnalysis): Promise<string> {
  const [photo, edited] = await Promise.all([loadImage(photoUrl), loadImage(editedUrl)]);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const result = compositeEdit(getImageData(photo, w, h), getImageData(edited, w, h), scene);
  return imageDataToDataUrl(asImageData(result));
}
