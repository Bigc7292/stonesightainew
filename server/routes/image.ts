import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const router = Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_IMAGE_MODEL = "black-forest-labs/flux.1-kontext-dev";
const FLUX_ENDPOINT =
  process.env.NVIDIA_IMAGE_URL ||
  "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev";
const EXAMPLES_UPLOAD_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/examples";

function validateApiKey(): string {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured in environment");
  }
  return NVIDIA_API_KEY;
}

function safeTruncate(value: unknown, max = 600): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "(unserializable)";
  }
}

async function uploadImageExample(apiKey: string, base64DataUrl: string): Promise<string> {
  const body = new FormData();
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL format");
  }
  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  body.append("file", buffer, `input.${mimeType.split("/")[1] || "png"}`);

  const response = await fetch(EXAMPLES_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[IMAGE] Example upload failed", {
      endpoint: EXAMPLES_UPLOAD_ENDPOINT,
      status: response.status,
      details: safeTruncate(errorText),
    });
    throw new Error(`Image upload failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = await response.json();
  const exampleId = data?.example_id || data?.id;
  if (!exampleId) {
    console.error("[IMAGE] Unexpected upload response", { keys: Object.keys(data ?? {}), sample: safeTruncate(data) });
    throw new Error("Missing example_id in upload response");
  }
  return exampleId;
}

/**
 * Generate an image with NVIDIA FLUX.1 Kontext, persist locally, and return both
 * the local path (for persistence) and the base64 data URL (for the client).
 */
async function generateImageWithNvidiaKontext(
  prompt: string,
  imageBase64: string,
  params: Record<string, any> = {},
): Promise<{ localPath: string; dataUrl: string }> {
  const apiKey = validateApiKey();

  const exampleId = await uploadImageExample(apiKey, imageBase64);

  const payload: Record<string, any> = {
    prompt,
    example_id: exampleId,
    height: params.height ?? 1024,
    width: params.width ?? 1024,
    steps: params.num_steps ?? 28,
    cfg_scale: params.cfg_scale ?? 5.0,
    seed: params.seed !== undefined ? Number(params.seed) : Math.floor(Math.random() * 1000000),
  };

  let response;
  try {
    response = await fetch(FLUX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[IMAGE] NVIDIA request failed", {
      endpoint: FLUX_ENDPOINT,
      model: NVIDIA_IMAGE_MODEL,
      message: err instanceof Error ? err.message : err,
    });
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[IMAGE] NVIDIA API error", {
      endpoint: FLUX_ENDPOINT,
      model: NVIDIA_IMAGE_MODEL,
      status: response.status,
      statusText: response.statusText,
      details: safeTruncate(errorText),
    });
    throw new Error(`NVIDIA API call failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = await response.json();
  const rawBase64: string | undefined = data?.b64_output || data?.outputs?.[0];

  if (!rawBase64) {
    console.error("[IMAGE] Unexpected NVIDIA response structure", {
      endpoint: FLUX_ENDPOINT,
      model: NVIDIA_IMAGE_MODEL,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid NVIDIA response structure");
  }

  const dataUrl = rawBase64.startsWith("data:") ? rawBase64 : `data:image/png;base64,${rawBase64}`;

  const IMAGES_DIR = path.join(__dirname, "..", "..", "public", "images");
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const localFileName = `replaced_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
  const filePath = path.join(IMAGES_DIR, localFileName);
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync(filePath, buffer);

  console.log(`[IMAGE] Image saved locally: /images/${localFileName}`);

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

    const imageBase64 = image.includes(",") ? image : `data:image/jpeg;base64,${image}`;

    const { localPath, dataUrl } = await generateImageWithNvidiaKontext(prompt, imageBase64, params);

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
          const { localPath } = await generateImageWithNvidiaKontext(
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
