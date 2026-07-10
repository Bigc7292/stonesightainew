import { Router, Request, Response } from "express";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";

// Reload environment so the server-side NVIDIA key is available at request time.
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const router = Router();

/**
 * NVIDIA Enterprise API (NVIDIA NIM) gateway configuration.
 * All image inpainting / surface generation traffic is routed here
 * instead of the previous commercial third-party provider.
 *
 * The hosted FLUX.1 [dev] visual-genai NIM is served from the dedicated
 * `ai.api.nvidia.com/v1/genai` gateway (NOT the OpenAI-compatible LLM
 * catalog at integrate.api.nvidia.com). It exposes a custom schema:
 *   { prompt, height, width, cfg_scale, mode, image, seed, steps, samples }
 * and returns the generated image at:  artifacts[0].base64
 *
 * NOTE: the key is resolved inside the request handler (not at module scope)
 * so it is always read after dotenv has been loaded by the server bootstrap.
 */
const NVIDIA_BASE_URL =
  process.env.NVIDIA_BASE_URL || "https://ai.api.nvidia.com/v1";
const NVIDIA_IMAGE_MODEL = "black-forest-labs/flux.1-dev";
const NVIDIA_IMAGE_ENDPOINT = `${NVIDIA_BASE_URL}/genai/${NVIDIA_IMAGE_MODEL}`;

/**
 * Internal helper that routes the stone-surface inpainting request to the
 * NVIDIA hosted FLUX.1 [dev] image generation NIM.
 *
 * The base architectural frame (and any masking arrays describing the areas
 * that should replace the default stone) are mapped onto the NVIDIA custom
 * schema. When a conditioning image is supplied we switch the NIM into an
 * image-guided mode so the regeneration focuses on the intended surface.
 */
async function generateImageWithNvidia(
  prompt: string,
  imageBase64: string,
  masks?: unknown[],
): Promise<string> {
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";

  // NVIDIA FLUX.1 [dev] custom schema payload.
  const payload: Record<string, unknown> = {
    prompt,
    height: 1024,
    width: 1024,
    cfg_scale: 5,
    mode: "base",
    seed: 0,
    steps: 50,
    samples: 1,
  };

  // Safely attach the base architectural frame only when present. NVIDIA
  // expects the conditioning image as a full data URI string.
  if (imageBase64) {
    payload.image = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;
  }

  // Safely map the incoming masking arrays (areas replacing default stone).
  // These are passed through only when one or more masks are supplied so the
  // model focuses the regeneration on the intended surface regions without
  // disturbing the default schema when no masks are present.
  if (Array.isArray(masks) && masks.length > 0) {
    payload.mask = masks;
  }

  const response = await axios.post(NVIDIA_IMAGE_ENDPOINT, payload, {
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 180000,
  });

  const data = response.data as {
    artifacts?: Array<{ base64?: string; finishReason?: string }>;
  };

  // NVIDIA FLUX.1 [dev] returns the generated image at artifacts[0].base64.
  const generated = data?.artifacts?.[0]?.base64 || null;

  if (!generated) {
    throw new Error("No image data returned from NVIDIA endpoint");
  }

  // Always normalise to a data URI so downstream saving/rendering stays stable.
  // The NVIDIA artifact payload is raw base64 (JPEG) without a data prefix.
  return generated.startsWith("data:")
    ? generated
    : `data:image/jpeg;base64,${generated}`;
}

/**
 * @route POST /api/image/generate
 * @description Generate / inpaint a stone surface using NVIDIA FLUX.1 [dev] via NVIDIA NIM
 * @access Private
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, image, mask, masks } = req.body;

    if (!prompt || !image) {
      return res.status(400).json({
        error: "Missing required fields: prompt and image",
      });
    }

    // Extract base64 data (remove data:image/png;base64, prefix if present)
    const imageBase64 = image.split(",")[1] || image;

    // Normalise the optional masking arrays (areas replacing default stone).
    const normalizedMasks: unknown[] = Array.isArray(masks)
      ? masks
      : Array.isArray(mask)
        ? mask
        : mask
          ? [mask]
          : [];

    // Route the external request through the NVIDIA hosted REST gateway.
    const generatedImageBase64 = await generateImageWithNvidia(
      prompt,
      imageBase64,
      normalizedMasks,
    );

    return res.status(200).json({
      success: true,
      image: generatedImageBase64,
    });
  } catch (error) {
    console.error("Image generation error:", error);
    return res.status(500).json({
      error: "Failed to generate image",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
