import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const router = Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const NVIDIA_IMAGE_BASE_URL = process.env.NVIDIA_IMAGE_BASE_URL || "https://ai.api.nvidia.com/v1";

// fal.ai configuration
const FAL_API_KEY = process.env.FAL_API_KEY || "";
const FAL_API_URL = "https://queue.fal.run";

// PATH A: Local/Tunneled NIM - set COSMOS_INFERENCE_URL in .env
const COSMOS_INFERENCE_URL = process.env.COSMOS_INFERENCE_URL || "";

// NVIDIA Cosmos models (only available via local NIM container)
const NVIDIA_COSMOS_MODELS = {
  "cosmos-3-super": "nvidia/cosmos-3-super",
  "cosmos-1.0-diffusion-7b": "nvidia/cosmos-1.0-diffusion-7b",
  "cosmos-1.0-autoregressive-5b": "nvidia/cosmos-1.0-autoregressive-5b",
} as const;

type NvidiaCosmosModelKey = keyof typeof NVIDIA_COSMOS_MODELS;
const DEFAULT_COSMOS_MODEL: NvidiaCosmosModelKey = "cosmos-3-super";

// fal.ai video models
const FAL_VIDEO_MODELS = {
  "seedance-2.0": "fal-ai/bytedance/seedance-2.0/image-to-video",
  "seedance-1.0": "fal-ai/bytedance/seedance-1.0/image-to-video",
  "stable-video-diffusion": "fal-ai/stable-video-diffusion",
  "zeroscope-v2": "fal-ai/zeroscope-v2",
  "animate-diff": "fal-ai/animate-diff",
  "kling": "fal-ai/kling-video/v1",
  "runway-gen3": "fal-ai/runway-gen3",
  "luma-dream-machine": "fal-ai/luma-dream-machine",
} as const;

type FalVideoModelKey = keyof typeof FAL_VIDEO_MODELS;
const DEFAULT_FAL_MODEL: FalVideoModelKey = "seedance-2.0";

type VideoModelKey = NvidiaCosmosModelKey | FalVideoModelKey;
const DEFAULT_VIDEO_MODEL: VideoModelKey = "seedance-2.0";

interface NvidiaVideoResponse {
  id?: string;
  outputs?: string[];
  b64_video?: string;
  video?: { url?: string };
  [key: string]: any;
}

function safeTruncate(value: unknown, max = 600): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "(unserializable)";
  }
}

function validateApiKey(): string {
  if (!NVIDIA_API_KEY) {
    throw new Error("NVIDIA_API_KEY not configured in environment");
  }
  return NVIDIA_API_KEY;
}

function validateFalKey(): string {
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY not configured in environment");
  }
  return FAL_API_KEY;
}

/**
 * Generate video via fal.ai API
 */
async function generateWithFal(
  prompt: string,
  imageSource: string | undefined,
  params: Record<string, any> = {},
  modelKey: FalVideoModelKey = DEFAULT_FAL_MODEL
): Promise<{ videoUrl: string | null; seed: number }> {
  const apiKey = validateFalKey();
  const modelId = FAL_VIDEO_MODELS[modelKey];

  const targetSeed = params.seed !== undefined ? Number(params.seed) : Math.floor(Math.random() * 1000000);

  const isImageToVideo = modelKey !== "kling" && modelKey !== "runway-gen3" && modelKey !== "luma-dream-machine";
  
  const input: Record<string, any> = {
    prompt,
    seed: targetSeed,
    resolution: params.resolution || "720p",
    duration: params.duration || "auto",
    aspect_ratio: params.aspect_ratio || "auto",
    generate_audio: params.generate_audio ?? false,
    bitrate_mode: params.bitrate_mode || "standard",
  };

  if (isImageToVideo && imageSource) {
    input.image_url = imageSource;
  } else if (isImageToVideo && !imageSource) {
    throw new Error(`${modelKey} requires an input image for image-to-video generation`);
  }

  if (modelKey === "seedance-2.0" || modelKey === "seedance-1.0") {
    input.generate_audio = params.generate_audio ?? true;
    if (params.end_image_url) {
      input.end_image_url = params.end_image_url;
    }
  }

  if (modelKey === "runway-gen3") {
    input.duration = params.duration || 5;
  }

  if (modelKey === "kling") {
    input.duration = params.duration || 5;
  }

  if (modelKey === "luma-dream-machine") {
    input.duration = params.duration || 5;
  }

  console.log("[VIDEO] fal.ai API attempt", {
    model: modelId,
    modelKey,
    hasImage: !!input.image_url,
    promptLength: prompt.length,
    seed: targetSeed,
  });

  let response;
  try {
    response = await fetch(`${FAL_API_URL}/${modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.error("[VIDEO] fal.ai request failed", {
      model: modelId,
      message: err instanceof Error ? err.message : err,
    });
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[VIDEO] fal.ai API error", {
      model: modelId,
      status: response.status,
      details: safeTruncate(errorText),
    });
    throw new Error(`fal.ai API failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = await response.json();
  const videoUrl = data?.video?.url || data?.video || data?.output?.video?.url || null;
  const seed = data?.seed || targetSeed;

  if (!videoUrl) {
    console.error("[VIDEO] Unexpected fal.ai response structure", {
      model: modelId,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid fal.ai response structure");
  }

  console.log("[VIDEO] fal.ai generation succeeded", { videoUrl: videoUrl?.slice(0, 80) });
  return { videoUrl, seed };
}

/**
 * PATH A: Generate via Local/Tunneled NIM Container (Cosmos models only)
 */
async function generateWithLocalNim(
  prompt: string,
  imageSource: string | undefined,
  params: Record<string, any> = {},
  modelKey: NvidiaCosmosModelKey = DEFAULT_COSMOS_MODEL
): Promise<{ videoUrl: string | null; seed: number }> {
  if (!COSMOS_INFERENCE_URL) {
    throw new Error("COSMOS_INFERENCE_URL not configured. Set it in .env to use local NIM container.");
  }

  const targetSeed = params.seed !== undefined ? Number(params.seed) : Math.floor(Math.random() * 1000000);
  const modelId = NVIDIA_COSMOS_MODELS[modelKey];

  const payload: Record<string, any> = {
    model: modelId,
    prompt,
    negative_prompt: params.negativePrompt || "blurry, low quality, artifacts, distorted, unrealistic movement",
    seed: targetSeed,
    guidance_scale: params.guidance_scale ?? 6.0,
    num_inference_steps: params.num_inference_steps ?? 28,
    duration: params.duration ?? 5,
    fps: params.fps ?? 24,
  };

  if (imageSource) {
    payload.image_url = imageSource;
  }

  console.log("[VIDEO] Local NIM attempt", {
    endpoint: COSMOS_INFERENCE_URL,
    model: modelId,
    hasImage: !!payload.image_url,
  });

  let response;
  try {
    response = await fetch(COSMOS_INFERENCE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY || ""}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[VIDEO] Local NIM request failed", {
      endpoint: COSMOS_INFERENCE_URL,
      message: err instanceof Error ? err.message : err,
    });
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[VIDEO] Local NIM error", {
      endpoint: COSMOS_INFERENCE_URL,
      model: modelId,
      status: response.status,
      details: safeTruncate(errorText),
    });
    throw new Error(`Local NIM failed with status ${response.status}: ${safeTruncate(errorText)}`);
  }

  const data = (await response.json()) as NvidiaVideoResponse;
  const videoUrl = data?.outputs?.[0] || data?.b64_video || data?.video?.url || null;

  if (!videoUrl) {
    console.error("[VIDEO] Unexpected Local NIM response", {
      endpoint: COSMOS_INFERENCE_URL,
      model: modelId,
      keys: Object.keys(data ?? {}),
      sample: safeTruncate(data),
    });
    throw new Error("Invalid Local NIM response structure");
  }

  return { videoUrl, seed: targetSeed };
}

router.post("/generate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, imageUrl, image, negativePrompt, duration, seed, model, ...params } = req.body;
    const imageSource = imageUrl || image;

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: "A prompt string is required for video generation.",
      });
      return;
    }

    const modelKey = (model as VideoModelKey) || DEFAULT_VIDEO_MODEL;
    const isCosmosModel = modelKey in NVIDIA_COSMOS_MODELS;
    const isFalModel = modelKey in FAL_VIDEO_MODELS;

    if (!isCosmosModel && !isFalModel) {
      res.status(400).json({
        success: false,
        error: `Invalid model. Available: ${[...Object.keys(NVIDIA_COSMOS_MODELS), ...Object.keys(FAL_VIDEO_MODELS)].join(", ")}`,
      });
      return;
    }

    const usedModel = isCosmosModel 
      ? NVIDIA_COSMOS_MODELS[modelKey as NvidiaCosmosModelKey] 
      : FAL_VIDEO_MODELS[modelKey as FalVideoModelKey];

    // PATH A: fal.ai (Primary - cloud API)
    if (isFalModel) {
      try {
        console.log("[VIDEO] Attempting fal.ai...", { model: usedModel, modelKey });
        const { videoUrl, seed: usedSeed } = await generateWithFal(prompt, imageSource, params, modelKey as FalVideoModelKey);
        console.log("[VIDEO] fal.ai succeeded");
        res.status(200).json({
          success: true,
          message: "Video generation completed via fal.ai.",
          data: {
            id: null,
            videoUrl,
            seed: usedSeed,
            status: "completed",
            model: usedModel,
          },
        });
        return;
      } catch (falError: any) {
        console.error("[VIDEO] fal.ai failed", {
          message: falError.message,
          model: usedModel,
        });
        res.status(503).json({
          success: false,
          error: "fal.ai video generation failed",
          details: falError.message,
        });
        return;
      }
    }

    // PATH B: Cosmos models (Local NIM only)
    if (!COSMOS_INFERENCE_URL) {
      res.status(503).json({
        success: false,
        error: "Cosmos video models require local NIM container",
        details: "NVIDIA Cosmos models are only available via local NIM deployment.",
        setupInstructions: {
          step1: "Pull NIM container: docker pull nvcr.io/nim/nvidia/cosmos-3-super:latest",
          step2: "Run container: docker run -d --gpus all -p 8000:8000 nvcr.io/nim/nvidia/cosmos-3-super:latest",
          step3: "Set in .env: COSMOS_INFERENCE_URL=http://localhost:8000/v1/infer",
          step4: "Restart server",
        },
        availableModels: Object.entries(NVIDIA_COSMOS_MODELS).map(([key, value]) => ({ id: key, fullId: value })),
        note: "Use fal.ai models (seedance-2.0, kling, runway-gen3, etc.) for immediate cloud API access",
      });
      return;
    }

    try {
      console.log("[VIDEO] Attempting Local NIM (Cosmos)...", { endpoint: COSMOS_INFERENCE_URL, model: usedModel });
      const { videoUrl, seed: usedSeed } = await generateWithLocalNim(prompt, imageSource, params, modelKey as NvidiaCosmosModelKey);
      console.log("[VIDEO] Local NIM succeeded");
      res.status(200).json({
        success: true,
        message: "Video generation completed successfully via local/tunneled NIM.",
        data: {
          id: null,
          videoUrl,
          seed: usedSeed,
          status: "completed",
          model: usedModel,
        },
      });
      return;
    } catch (localError: any) {
      console.error("[VIDEO] Local NIM failed", {
        message: localError.message,
        model: usedModel,
      });
      res.status(503).json({
        success: false,
        error: "Local NIM video generation failed",
        details: localError.message,
        hint: "Check that your NIM container is running and accessible at COSMOS_INFERENCE_URL",
      });
      return;
    }
  } catch (error: any) {
    console.error("[VIDEO] /generate failed", {
      endpoint: COSMOS_INFERENCE_URL,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      error: "An unexpected internal server error occurred while processing the video route.",
      details: error.message || error,
    });
  }
});

router.get("/models", async (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    models: [
      ...Object.entries(FAL_VIDEO_MODELS).map(([key, value]) => ({
        id: key,
        fullId: value,
        description: getFalModelDescription(key),
        source: "fal.ai",
        type: key.includes("kling") || key.includes("runway") || key.includes("luma") ? "text-to-video" : "image-to-video",
        note: "Works now with your fal.ai credits",
      })),
      ...Object.entries(NVIDIA_COSMOS_MODELS).map(([key, value]) => ({
        id: key,
        fullId: value,
        description: getCosmosModelDescription(key),
        source: "local-nim",
        type: "text-to-video",
        note: "Requires local NIM container deployment",
      })),
    ],
    default: DEFAULT_VIDEO_MODEL,
  });
});

function getFalModelDescription(key: FalVideoModelKey): string {
  const descriptions: Record<FalVideoModelKey, string> = {
    "seedance-2.0": "Seedance 2.0 - ByteDance image-to-video (4-15s, 480p-4k, audio optional)",
    "seedance-1.0": "Seedance 1.0 - ByteDance image-to-video (legacy)",
    "stable-video-diffusion": "Stable Video Diffusion - Image-to-video (25 frames, 576x1024)",
    "zeroscope-v2": "Zeroscope V2 XL - Text-to-video (24 frames, 576x320)",
    "animate-diff": "AnimateDiff - Image-to-video animation",
    "kling": "Kling Video - High-quality text-to-video (5s, 1080p)",
    "runway-gen3": "Runway Gen-3 - High-quality text-to-video (5s, 720p)",
    "luma-dream-machine": "Luma Dream Machine - High-quality text-to-video (5s, 1080p)",
  };
  return descriptions[key] || "";
}

function getCosmosModelDescription(key: NvidiaCosmosModelKey): string {
  const descriptions: Record<NvidiaCosmosModelKey, string> = {
    "cosmos-3-super": "Cosmos 3 Super - High-quality physics-aware video generation from text/image (latest)",
    "cosmos-1.0-diffusion-7b": "Cosmos 1.0 Diffusion 7B - 7B param diffusion model for text/image-to-video",
    "cosmos-1.0-autoregressive-5b": "Cosmos 1.0 Autoregressive 5B - 5B param autoregressive video prediction",
  };
  return descriptions[key] || "";
}

export default router;