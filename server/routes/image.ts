import { Router, Request, Response } from "express";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const router = Router();

/**
 * NVIDIA FLUX.1-dev image generation via the hosted NIM GenAI endpoint.
 * The OpenAI-compatible /v1/images/generations serverless route is not
 * provisioned for this API key, so we use the dedicated GenAI endpoint.
 */
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_IMAGE_MODEL = "black-forest-labs/flux.1-dev";
const FLUX_ENDPOINT =
  process.env.NVIDIA_IMAGE_URL ||
  "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev";

function validateApiKey(): string {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured in environment");
  }
  return NVIDIA_API_KEY;
}

/**
 * Safely stringify + truncate a value for logging so error output stays
 * readable and never dumps secrets or a multi-MB base64 image payload.
 */
function safeTruncate(value: unknown, max = 600): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "(unserializable)";
  }
}

/**
 * Build the request payload conditionally based on the target endpoint.
 * Serverless uses the OpenAI-compatible schema; local NIM uses the /infer schema.
 */
function buildPayload(prompt: string, params: Record<string, any>) {
  // NVIDIA NIM FLUX.1-dev request shape. Base mode is text-to-image;
  // height/width are fixed at 1024 for this model.
  // NOTE: do NOT include `model` in the body — the hosted GenAI endpoint
  // takes the model from the URL path and returns 422 (extra_forbidden)
  // if `model` is present in the payload.
  return {
    prompt,
    height: params.height ?? 1024,
    width: params.width ?? 1024,
    steps: params.num_steps ?? 30,
    cfg_scale: params.cfg_scale ?? 5,
    seed: params.seed ?? 42,
    mode: "base",
  };
}

/**
 * Generate an image with NVIDIA FLUX.1-dev, persist locally, and return both
 * the local path (for persistence) and the base64 data URL (for the client).
 */
async function generateImageWithNvidia(
  prompt: string,
  imageBase64: string,
  params: Record<string, any> = {},
): Promise<{ localPath: string; dataUrl: string }> {
  const apiKey = validateApiKey();
  const payload = buildPayload(prompt, params);

  let response;
  try {
    response = await axios.post(FLUX_ENDPOINT, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 120000,
    });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error("[FLUX] NVIDIA request failed", {
        endpoint: FLUX_ENDPOINT,
        model: NVIDIA_IMAGE_MODEL,
        status: err.response?.status,
        statusText: err.response?.statusText,
        response: err.response?.data ? safeTruncate(err.response.data) : "(no response body)",
      });
    } else {
      console.error("[FLUX] Unexpected error during NVIDIA request", err);
    }
    throw err;
  }

  const data = response.data;

  // NVIDIA NIM FLUX returns { artifacts: [ { base64: "<jpeg>" } ] }
  const rawBase64: string | undefined = data?.artifacts?.[0]?.base64;

  if (!rawBase64) {
    console.error("[FLUX] Unexpected NVIDIA response structure", {
      endpoint: FLUX_ENDPOINT,
      model: NVIDIA_IMAGE_MODEL,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid NVIDIA response structure");
  }

  // Normalize to a data URL if needed (artifact is raw JPEG base64).
  const dataUrl = rawBase64.startsWith("data:")
    ? rawBase64
    : `data:image/jpeg;base64,${rawBase64}`;

  // Write asset to local public images folder.
  const IMAGES_DIR = path.join(__dirname, "..", "..", "public", "images");
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const localFileName = `flux_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
  const filePath = path.join(IMAGES_DIR, localFileName);
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ""), "base64");
  fs.writeFileSync(filePath, buffer);

  console.log(`[FLUX] Image saved locally: /images/${localFileName}`);

  // Return both the persisted path and the base64 data URL the client expects.
  return { localPath: `/images/${localFileName}`, dataUrl };
}

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, image, ...params } = req.body;

    if (!prompt || !image) {
      return res.status(400).json({
        error: "Missing required fields: prompt and image",
        received: { prompt: !!prompt, image: !!image },
      });
    }

    const imageBase64 = image.split(",")[1] || image;

    const { localPath, dataUrl } = await generateImageWithNvidia(prompt, imageBase64, params);

    return res.status(200).json({
      success: true,
      image: dataUrl,
      localPath,
      model: NVIDIA_IMAGE_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[IMAGE] /generate failed", {
      endpoint: FLUX_ENDPOINT,
      model: NVIDIA_IMAGE_MODEL,
      message: error?.message,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      response: error?.response?.data ? safeTruncate(error.response.data) : undefined,
    });
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to generate image via NVIDIA FLUX pipeline",
      details: errorMessage,
      endpoint: FLUX_ENDPOINT,
    });
  }
});

// Keep status and batch endpoints (reads localPath model as flux).
router.get("/status/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    return res.status(200).json({
      jobId: id,
      status: "completed",
      model: NVIDIA_IMAGE_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch job status",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/batch", async (req: Request, res: Response) => {
  try {
    const { prompt, image, variations } = req.body;

    if (!prompt || !image || !variations?.length) {
      return res.status(400).json({
        error: "Missing required fields: prompt, image, or variations array",
      });
    }

    const results = await Promise.all(
      variations.map(async (variation: string, index: number) => {
        try {
          const { localPath } = await generateImageWithNvidia(
            `${prompt} - ${variation}`,
            image,
          );
          return { index, variation, success: true, localPath };
        } catch (error) {
          return {
            index,
            variation,
            success: false,
            error: error instanceof Error ? error.message : "Generation failed",
          };
        }
      }),
    );

    return res.status(200).json({
      success: true,
      batch: results,
      model: NVIDIA_IMAGE_MODEL,
    });
  } catch (error) {
    console.error("Batch generation error:", error);
    return res.status(500).json({
      error: "Failed to generate batch images",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;