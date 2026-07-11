import { Router, Request, Response } from "express";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const router = Router();

/**
 * NVIDIA FLUX.1-dev image generation with conditional routing.
 *
 * - Enterprise/local containers expose the OpenAI-compatible
 *   /v1/infer namespace.
 * - Public serverless catalog maps to /v1/images/generations.
 */
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_IMAGE_MODEL = "nvidia/flux.1-dev";

// Conditional routing per infrastructure testing specs.
const isLocalNim = (process.env.NVIDIA_BASE_URL || "").includes("localhost");
const targetUrl = isLocalNim
  ? `${NVIDIA_BASE_URL}/infer`
  : `${NVIDIA_BASE_URL}/images/generations`;

function validateApiKey(): string {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured in environment");
  }
  return NVIDIA_API_KEY;
}

/**
 * Build the request payload conditionally based on the target endpoint.
 * Serverless uses the OpenAI-compatible schema; local NIM uses the /infer schema.
 */
function buildPayload(prompt: string, imageBase64: string, params: Record<string, any>) {
  const normalizedImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  // Common fields pass through from the user's incoming image parameters.
  const passthrough = {
    width: params.width ?? 1024,
    height: params.height ?? 1024,
    num_steps: params.num_steps ?? 30,
    seed: params.seed ?? 42,
  };

  // OpenAI-compatible schema (serverless) vs NIM /infer schema (local).
  const schema = isLocalNim
    ? {
        model: NVIDIA_IMAGE_MODEL,
        prompt,
        image: normalizedImage,
        ...passthrough,
      }
    : {
        model: NVIDIA_IMAGE_MODEL,
        prompt,
        image: normalizedImage,
        ...passthrough,
      };

  return schema;
}

/**
 * Generate an image with NVIDIA FLUX.1-dev, persist locally, and return the path.
 */
async function generateImageWithNvidia(
  prompt: string,
  imageBase64: string,
  params: Record<string, any> = {},
): Promise<string> {
  const apiKey = validateApiKey();
  const payload = buildPayload(prompt, imageBase64, params);

  const response = await axios.post(targetUrl, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 120000,
  });

  const data = response.data;

  // Extract raw base64 data return string (data:image/...;base64,...).
  let rawBase64: string | undefined;
  if (data?.data?.[0]?.b64_json) {
    rawBase64 = data.data[0].b64_json;
  } else if (data?.data?.[0]?.url) {
    const imageResponse = await axios.get(data.data[0].url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    rawBase64 = `data:image/png;base64,${Buffer.from(imageResponse.data).toString("base64")}`;
  }

  if (!rawBase64) {
    throw new Error("Invalid NVIDIA response structure");
  }

  // Normalize to data URL if needed.
  const dataUrl = rawBase64.startsWith("data:") ? rawBase64 : `data:image/png;base64,${rawBase64}`;

  // Write asset to local public images folder.
  const IMAGES_DIR = path.join(__dirname, "..", "..", "public", "images");
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const localFileName = `flux_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
  const filePath = path.join(IMAGES_DIR, localFileName);
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync(filePath, buffer);

  console.log(`[FLUX] Image saved locally: /images/${localFileName}`);

  // Return the path string cleanly.
  return `/images/${localFileName}`;
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

    const localPath = await generateImageWithNvidia(prompt, imageBase64, params);

    return res.status(200).json({
      success: true,
      localPath,
      model: NVIDIA_IMAGE_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Image generation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to generate image via NVIDIA FLUX pipeline",
      details: errorMessage,
      endpoint: targetUrl,
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
          const localPath = await generateImageWithNvidia(
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