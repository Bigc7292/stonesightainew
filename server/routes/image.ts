import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const router = Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_IMAGE_BASE_URL = process.env.NVIDIA_IMAGE_BASE_URL || "https://ai.api.nvidia.com/v1";

// Available NVIDIA models (all accessible via NVIDIA API)
const NVIDIA_MODELS = {
  "flux.1-kontext-dev": "black-forest-labs/flux.1-kontext-dev",
  "flux.1-dev": "black-forest-labs/flux.1-dev",
  "flux.1-schnell": "black-forest-labs/flux.1-schnell",
  "flux.2-klein-4b": "black-forest-labs/flux.2-klein-4b",
  "stable-diffusion-3.5-large": "stabilityai/stable-diffusion-3.5-large",
  "qwen-image": "qwen/qwen-image",
  "qwen-image-edit": "qwen/qwen-image-edit",
} as const;

type NvidiaModelKey = keyof typeof NVIDIA_MODELS;
const DEFAULT_MODEL: NvidiaModelKey = "flux.1-dev";

// PATH A (Primary): Local/Tunneled NIM - set FLUX_INFERENCE_URL in .env
const FLUX_INFERENCE_URL = process.env.FLUX_INFERENCE_URL || "";

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

/**
 * Save generated image to local filesystem and return local path + data URL
 */
async function saveGeneratedImage(dataUrl: string): Promise<{ localPath: string; dataUrl: string }> {
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

/**
 * Generate via NVIDIA Cloud API (ai.api.nvidia.com/v1)
 * Supports all NVIDIA-hosted visual models
 */
async function generateWithNvidiaApi(
  prompt: string,
  imageBase64: string,
  params: Record<string, any> = {},
  modelKey: NvidiaModelKey = DEFAULT_MODEL
): Promise<{ localPath: string; dataUrl: string }> {
  const apiKey = validateApiKey();
  const modelId = NVIDIA_MODELS[modelKey];
  const endpoint = `${NVIDIA_IMAGE_BASE_URL}/genai/${modelId}`;

  const hasInputImage = imageBase64 && imageBase64.length > 100; // non-trivial image
  const imageData = hasInputImage 
    ? (imageBase64.includes(",") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`)
    : undefined;

  // Build payload based on model type
  const payload: Record<string, any> = {
    prompt,
    steps: params.num_steps ?? 28,
    cfg_scale: params.cfg_scale ?? 5.0,
    seed: params.seed !== undefined ? Number(params.seed) : Math.floor(Math.random() * 1000000),
  };

  // Model-specific parameter handling
  const isKontext = modelKey === "flux.1-kontext-dev" || modelKey === "qwen-image-edit";
  const isTextToImage = modelKey === "flux.1-dev" || modelKey === "flux.1-schnell" || modelKey === "flux.2-klein-4b" || modelKey === "stable-diffusion-3.5-large" || modelKey === "qwen-image";

  if (isKontext) {
    // Image-to-image editing models - require input image, use aspect_ratio
    if (!imageData) {
      throw new Error(`${modelKey} requires an input image for editing`);
    }
    payload.image = imageData;
    payload.aspect_ratio = params.aspect_ratio || "match_input_image";
  } else if (isTextToImage) {
    // Text-to-image models - use width/height, no input image needed
    payload.width = params.width ?? 1024;
    payload.height = params.height ?? 1024;
    // Ensure dimensions are multiples of 64
    payload.width = Math.round(payload.width / 64) * 64;
    payload.height = Math.round(payload.height / 64) * 64;
  }

  // Model-specific parameter overrides
  if (modelKey === "flux.1-schnell") {
    payload.steps = params.num_steps ?? 4;
  }
  if (modelKey === "stable-diffusion-3.5-large") {
    payload.cfg_scale = params.cfg_scale ?? 7.0;
    payload.steps = params.num_steps ?? 28;
  }
  if (modelKey === "flux.2-klein-4b") {
    payload.steps = params.num_steps ?? 8;
  }

  console.log("[IMAGE] NVIDIA API attempt", {
    endpoint,
    model: modelId,
    hasInputImage: !!payload.image,
    isKontext,
    isTextToImage,
    promptLength: payload.prompt?.length,
    steps: payload.steps,
    cfg_scale: payload.cfg_scale,
    width: payload.width,
    height: payload.height,
    aspect_ratio: payload.aspect_ratio,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[IMAGE] NVIDIA API request failed", {
      endpoint,
      model: modelId,
      message: err instanceof Error ? err.message : err,
    });
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[IMAGE] NVIDIA API error", {
      endpoint,
      model: modelId,
      status: response.status,
      statusText: response.statusText,
      details: safeTruncate(errorText),
    });
    throw new Error(`NVIDIA API failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = await response.json();
  const rawBase64: string | undefined = 
    data?.b64_output || 
    data?.outputs?.[0] || 
    data?.images?.[0] ||
    data?.artifacts?.[0]?.base64;

  if (!rawBase64) {
    console.error("[IMAGE] Unexpected NVIDIA response structure", {
      endpoint,
      model: modelId,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid NVIDIA response structure");
  }

  const dataUrl = rawBase64.startsWith("data:") ? rawBase64 : `data:image/png;base64,${rawBase64}`;
  return saveGeneratedImage(dataUrl);
}

/**
 * PATH A: Generate via Local/Tunneled NIM (if FLUX_INFERENCE_URL configured)
 */
async function generateWithLocalNim(
  prompt: string,
  imageBase64: string,
  params: Record<string, any> = {}
): Promise<{ localPath: string; dataUrl: string }> {
  if (!FLUX_INFERENCE_URL) {
    throw new Error("FLUX_INFERENCE_URL not configured");
  }

  const imageData = imageBase64.includes(",") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;

  const payload: Record<string, any> = {
    prompt,
    image: imageData,
    aspect_ratio: "match_input_image",
    steps: params.num_steps ?? 28,
    cfg_scale: params.cfg_scale ?? 5.0,
    seed: params.seed !== undefined ? Number(params.seed) : Math.floor(Math.random() * 1000000),
  };

  console.log("[IMAGE] Local NIM attempt", {
    endpoint: FLUX_INFERENCE_URL,
    hasImage: !!payload.image,
  });

  let response;
  try {
    response = await fetch(FLUX_INFERENCE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY || ""}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[IMAGE] Local NIM request failed", {
      endpoint: FLUX_INFERENCE_URL,
      message: err instanceof Error ? err.message : err,
    });
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[IMAGE] Local NIM error", {
      endpoint: FLUX_INFERENCE_URL,
      status: response.status,
      details: safeTruncate(errorText),
    });
    throw new Error(`Local NIM failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = await response.json();
  const rawBase64: string | undefined = data?.b64_output || data?.outputs?.[0] || data?.artifacts?.[0]?.base64;

  if (!rawBase64) {
    console.error("[IMAGE] Unexpected Local NIM response", {
      endpoint: FLUX_INFERENCE_URL,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid Local NIM response structure");
  }

  const dataUrl = rawBase64.startsWith("data:") ? rawBase64 : `data:image/png;base64,${rawBase64}`;
  return saveGeneratedImage(dataUrl);
}

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, image, model, ...params } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: "Missing required field: prompt",
        received: { prompt: !!prompt, image: !!image },
      });
    }

    const modelKey = (model as NvidiaModelKey) || DEFAULT_MODEL;
    if (!NVIDIA_MODELS[modelKey]) {
      return res.status(400).json({
        error: `Invalid model. Available: ${Object.keys(NVIDIA_MODELS).join(", ")}`,
      });
    }

    // Check if model requires input image (image-to-image editing)
    const isImageToImage = modelKey === "flux.1-kontext-dev" || modelKey === "qwen-image-edit";
    if (isImageToImage && !image) {
      return res.status(400).json({
        error: `Model ${modelKey} requires an input image for editing`,
      });
    }

    const imageDataUrl = image?.includes(",") ? image : image ? `data:image/jpeg;base64,${image}` : undefined;
    const imageBase64 = image?.includes(",") ? image.split(",")[1] : image;

    let localPath: string;
    let dataUrl: string;
    const usedModel = NVIDIA_MODELS[modelKey];

    // PATH A: Local/Tunneled NIM (Primary - set FLUX_INFERENCE_URL)
    if (FLUX_INFERENCE_URL) {
      try {
        console.log("[IMAGE] Attempting Local NIM (Path A)...", { endpoint: FLUX_INFERENCE_URL });
        ({ localPath, dataUrl } = await generateWithLocalNim(prompt, imageBase64 || "", params));
        console.log("[IMAGE] Local NIM succeeded");
        return res.status(200).json({
          success: true,
          image: dataUrl,
          localPath,
          model: usedModel,
          timestamp: new Date().toISOString(),
        });
      } catch (localError: any) {
        console.warn("[IMAGE] Local NIM failed, trying NVIDIA Cloud API (Path B)...", {
          message: localError.message,
        });
      }
    } else {
      console.log("[IMAGE] FLUX_INFERENCE_URL not set, skipping Local NIM (Path A)");
    }

    // PATH B: NVIDIA Cloud API (ai.api.nvidia.com/v1)
    try {
      console.log("[IMAGE] Attempting NVIDIA Cloud API (Path B)...", { model: usedModel });
      ({ localPath, dataUrl } = await generateWithNvidiaApi(prompt, imageBase64 || "", params, modelKey));
      console.log("[IMAGE] NVIDIA Cloud API succeeded");
      return res.status(200).json({
        success: true,
        image: dataUrl,
        localPath,
        model: usedModel,
        timestamp: new Date().toISOString(),
      });
    } catch (nvidiaError: any) {
      console.error("[IMAGE] NVIDIA Cloud API failed", {
        message: nvidiaError.message,
        model: usedModel,
      });
    }

    throw new Error("All NVIDIA image generation paths exhausted");
  } catch (error: any) {
    console.error("[IMAGE] /generate failed (all NVIDIA paths exhausted)", {
      model: NVIDIA_MODELS[DEFAULT_MODEL],
      message: error?.message,
    });
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(503).json({
      error: "Image generation unavailable",
      details: errorMessage,
      hint: "Set FLUX_INFERENCE_URL for local NIM, or ensure NVIDIA_API_KEY is valid for cloud API. Available models: flux.1-kontext-dev, flux.1-dev, flux.1-schnell, flux.2-klein-4b, stable-diffusion-3.5-large, qwen-image, qwen-image-edit",
    });
  }
});

router.get("/models", async (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    models: Object.entries(NVIDIA_MODELS).map(([key, value]) => ({
      id: key,
      fullId: value,
      description: getModelDescription(key),
    })),
    default: DEFAULT_MODEL,
  });
});

function getModelDescription(key: NvidiaModelKey): string {
  const descriptions: Record<NvidiaModelKey, string> = {
    "flux.1-kontext-dev": "FLUX.1 Kontext - In-context image generation and editing (12B params)",
    "flux.1-dev": "FLUX.1 Dev - High-quality text-to-image generation (12B params)",
    "flux.1-schnell": "FLUX.1 Schnell - Fast distilled model, 4 steps (12B params)",
    "flux.2-klein-4b": "FLUX.2 Klein - Distilled 4B param model for speed",
    "stable-diffusion-3.5-large": "Stable Diffusion 3.5 Large - High quality, 8B params",
    "qwen-image": "Qwen Image - High-quality text-to-image generation",
    "qwen-image-edit": "Qwen Image Edit - In-context image editing",
  };
  return descriptions[key] || "";
}

router.get("/status/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    return res.status(200).json({
      jobId: id,
      status: "completed",
      model: NVIDIA_MODELS[DEFAULT_MODEL],
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
    const { prompt, image, variations, model } = req.body;

    if (!prompt || !image || !variations?.length) {
      return res.status(400).json({
        error: "Missing required fields: prompt, image, or variations array",
      });
    }

    const modelKey = (model as NvidiaModelKey) || DEFAULT_MODEL;
    if (!NVIDIA_MODELS[modelKey]) {
      return res.status(400).json({
        error: `Invalid model. Available: ${Object.keys(NVIDIA_MODELS).join(", ")}`,
      });
    }

    const results = await Promise.all(
      variations.map(async (variation: string, index: number) => {
        try {
          const { localPath } = await generateWithNvidiaApi(
            `${prompt} - ${variation}`,
            image.includes(",") ? image.split(",")[1] : image,
            {},
            modelKey
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
      model: NVIDIA_MODELS[modelKey],
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