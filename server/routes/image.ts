/**
 * POST /api/image/generate — NVIDIA FLUX.1 Kontext stone replacement.
 *
 * Body: { image: dataURL, prompt?: string, stone?: { name, category, description }, seed?: number }
 *   `prompt` is normally Claude's `edit_instruction`; when absent a strict
 *   template instruction is built from `stone`.
 *
 * 200: { success: true, image: dataURL, localPath, provider }
 * 503 { code: "NVIDIA_IMAGE_UNAVAILABLE" } — no NVIDIA image endpoint configured.
 * 502 { code: "NVIDIA_IMAGE_FAILED" }      — every configured endpoint failed.
 * On either error the frontend renders the stone locally from Claude's analysis.
 */
import { Router, Request, Response } from "express";
import { editWithKontext, imageEditProviders } from "../lib/imageEditor";
import { decodeImage, saveGeneratedAsset, toDataUrl } from "../lib/images";
import { fallbackEditInstruction } from "../lib/prompts";

const router = Router();

router.post("/generate", async (req: Request, res: Response) => {
  const { image, prompt, stone, seed } = req.body ?? {};
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
      code: "NVIDIA_IMAGE_UNAVAILABLE",
      error: "No NVIDIA image-editing endpoint configured (set FLUX_INFERENCE_URL or NVIDIA_API_KEY).",
    });
  }

  try {
    const result = await editWithKontext(
      decodeImage(image).buffer,
      instruction,
      Number.isFinite(Number(seed)) ? Number(seed) : undefined,
    );
    const ext = result.mime === "image/png" ? "png" : result.mime === "image/webp" ? "webp" : "jpg";
    const localPath = saveGeneratedAsset("images", result.buffer, ext);
    return res.json({
      success: true,
      image: toDataUrl(result.buffer, result.mime),
      localPath,
      provider: result.provider,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      code: "NVIDIA_IMAGE_FAILED",
      error: "NVIDIA image editing failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
