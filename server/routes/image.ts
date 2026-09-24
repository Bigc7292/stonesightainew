/**
 * POST /api/image/generate — photoreal stone replacement.
 *
 * Body: { image: dataURL, prompt?: string, stone?: { name, category, description },
 *         swatch?: dataURL, scene?: SceneAnalysis, seed?: number }
 *   `prompt` is normally Claude's `edit_instruction`; when absent a strict
 *   template instruction is built from `stone`. `swatch` is shown to editors
 *   that accept a reference image (Gemini). With `scene`, the edit is aligned
 *   to the original photo and only the stone is composited back
 *   (`composited: true`), so the rest of the room is pixel-identical.
 *
 * Editors, in order: self-hosted NVIDIA Kontext NIM, Gemini image models via
 * an OpenAI-compatible gateway, NVIDIA-hosted Kontext.
 *
 * 200: { success: true, image: dataURL, localPath, provider, model?, composited }
 * 503 { code: "IMAGE_EDIT_UNAVAILABLE" } — no image editor configured.
 * 502 { code: "IMAGE_EDIT_FAILED" }      — every configured editor failed.
 * 502 { code: "IMAGE_EDIT_REFRAMED" }    — the edit could not be aligned to the photo (twice).
 * On either error the frontend renders the stone locally from Claude's analysis.
 */
import { Router, Request, Response } from "express";
import { editStone, imageEditProviders } from "../lib/imageEditor";
import { compositeStoneEdit } from "../lib/composite";
import { decodeImage, saveGeneratedAsset, toDataUrl } from "../lib/images";
import { fallbackEditInstruction } from "../lib/prompts";
import { sanitizeScene } from "../../shared/scene";

const router = Router();

router.post("/generate", async (req: Request, res: Response) => {
  const { image, prompt, stone, seed, swatch, scene } = req.body ?? {};
  if (typeof image !== "string" || !image) {
    return res.status(400).json({ success: false, code: "BAD_REQUEST", error: "Required: image (data URL)" });
  }
  const instruction =
    typeof prompt === "string" && prompt.trim()
      ? prompt.trim().slice(0, 2000)
      : stone?.name
        ? fallbackEditInstruction(stone)
        : "";
  if (!instruction) {
    return res.status(400).json({ success: false, code: "BAD_REQUEST", error: "Required: prompt or stone.name" });
  }

  if (imageEditProviders().length === 0) {
    return res.status(503).json({
      success: false,
      code: "IMAGE_EDIT_UNAVAILABLE",
      error: "No image editor configured (set IMAGE_EDIT_BASE_URL + IMAGE_EDIT_API_KEY, FLUX_INFERENCE_URL or NVIDIA_API_KEY).",
    });
  }

  const photo = decodeImage(image).buffer;
  const swatchBuf = typeof swatch === "string" && swatch ? decodeImage(swatch).buffer : undefined;
  try {
    const stoneInfo = stone?.name ? stone : { name: "the selected stone" };
    const cleanScene = scene && typeof scene === "object" ? sanitizeScene(scene) : null;
    let result = await editStone({ photo, swatch: swatchBuf, stone: stoneInfo, instruction, seed: Number.isFinite(Number(seed)) ? Number(seed) : undefined });

    let buffer = result.buffer;
    let mime = result.mime;
    let composited = false;
    if (cleanScene) {
      let c = await compositeStoneEdit(photo, result.buffer, cleanScene, swatchBuf);
      if (!c.aligned) {
        // The editor reframed the photo (generative models occasionally do):
        // try once more, then give up rather than paste misaligned stone.
        console.warn("[IMAGE] Edit is reframed; retrying once", { score: +c.alignment.score.toFixed(3) });
        result = await editStone({ photo, swatch: swatchBuf, stone: stoneInfo, instruction: `${instruction}\nThe output must have exactly the same framing as Image 1: identical crop, zoom and camera position, so it can be overlaid on the original pixel for pixel.` });
        c = await compositeStoneEdit(photo, result.buffer, cleanScene, swatchBuf);
        if (!c.aligned) {
          return res.status(502).json({
            success: false,
            code: "IMAGE_EDIT_REFRAMED",
            error: "The image editor changed the framing of the photo",
            details: `alignment score ${c.alignment.score.toFixed(2)}`,
          });
        }
      }
      console.log("[IMAGE] Composited stone into original", {
        alignment: { scale: +c.alignment.scale.toFixed(4), tx: +c.alignment.tx.toFixed(4), ty: +c.alignment.ty.toFixed(4), score: +c.alignment.score.toFixed(3) },
        editedFraction: +c.editedFraction.toFixed(3),
      });
      buffer = c.buffer;
      mime = "image/jpeg";
      composited = true;
    }
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const localPath = saveGeneratedAsset("images", buffer, ext);
    return res.json({
      success: true,
      image: toDataUrl(buffer, mime),
      localPath,
      provider: result.provider,
      model: result.model,
      composited,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      code: "IMAGE_EDIT_FAILED",
      error: "Image editing failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
