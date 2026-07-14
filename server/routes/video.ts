import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const router = Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

const COSMOS_INFERENCE_URL =
  process.env.COSMOS_INFERENCE_URL ||
  "https://ai.api.nvidia.com/v1/genai/nvidia/cosmos-3-super";

interface NvidiaCosmosResponse {
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

/**
 * @route   POST /api/video/generate
 * @desc    Generate video via local NIM container, custom GPU tunnel, or fallback serverless cloud
 * @access  Public
 */
router.post("/generate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, imageUrl, image, negativePrompt, duration, seed } = req.body;
    const imageSource = imageUrl || image;

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: "A prompt string is required for video generation.",
      });
      return;
    }

    const targetSeed = seed !== undefined ? Number(seed) : Math.floor(Math.random() * 1000000);

    // =========================================================================
    // PATH A: Use Local/Tunnel NVIDIA NIM Container (If configured and active)
    // =========================================================================
    if (COSMOS_INFERENCE_URL && COSMOS_INFERENCE_URL.includes("localhost")) {
      console.log(`[VIDEO] Attempting local NIM generation at: ${COSMOS_INFERENCE_URL}`);

      try {
        const payload: Record<string, any> = {
          model: imageSource
            ? "nvidia/cosmos-3-super/image-to-video"
            : "nvidia/cosmos-3-super/text-to-video",
          prompt,
          negative_prompt: negativePrompt || "blurry, low quality, artifacts, distorted, unrealistic movement",
          seed: targetSeed,
          guidance_scale: 6.0,
          num_inference_steps: 28,
        };

        if (imageSource) {
          payload.image_url = imageSource;
        }

        const response = await fetch(COSMOS_INFERENCE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${NVIDIA_API_KEY || ""}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = (await response.json()) as NvidiaCosmosResponse;
          res.status(200).json({
            success: true,
            message: "Video generation completed successfully via local/tunneled NIM.",
            data: {
              id: data.id || null,
              videoUrl: data.outputs?.[0] || data.b64_video || data.video?.url || null,
              seed: targetSeed,
              status: "completed",
            },
          });
          return;
        } else {
          const errorText = await response.text();
          console.warn(`[VIDEO] Local NIM at ${COSMOS_INFERENCE_URL} returned status ${response.status}`, {
            status: response.status,
            statusText: response.statusText,
            details: safeTruncate(errorText),
          });
        }
      } catch (nimError: any) {
        console.warn(`[VIDEO] Local NIM connection failed: ${nimError.message}. Falling back...`, {
          message: nimError.message,
          stack: nimError.stack,
        });
      }
    }

    // =========================================================================
    // PATH B: Fallback to Serverless Cloud API (Replicate / RunPod)
    // =========================================================================
    if (REPLICATE_API_TOKEN) {
      console.log("[VIDEO] Routing request to Serverless Cloud GPU Fallback (Replicate)...");

      try {
        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            Authorization: `Token ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: "nvidia/cosmos-3-super",
            input: {
              prompt,
              negative_prompt: negativePrompt || "blurry, low quality, artifacts, distorted, unrealistic movement",
              seed: targetSeed,
              steps: 28,
              ...(imageSource && { image: imageSource }),
            },
          }),
        });

        if (response.ok) {
          const prediction = await response.json();
          res.status(200).json({
            success: true,
            message: "Video generation initiated successfully via Serverless Cloud Fallback.",
            data: {
              id: prediction.id,
              videoUrl: prediction.output || null,
              seed: targetSeed,
              status: prediction.status || "starting",
            },
          });
          return;
        } else {
          const errorText = await response.text();
          console.error("[VIDEO] Replicate fallback returned error", {
            status: response.status,
            statusText: response.statusText,
            details: safeTruncate(errorText),
          });
        }
      } catch (fallbackError: any) {
        console.error("[VIDEO] Serverless fallback failed:", {
          message: fallbackError.message,
          stack: fallbackError.stack,
        });
      }
    }

    // =========================================================================
    // PATH C: Out of Options / Error Handling
    // =========================================================================
    res.status(503).json({
      success: false,
      error: "All Cosmos 3 Video Generation pipelines are currently offline.",
      details:
        "No active Local/Tunneled NIM container detected on port 8000, NVIDIA Cloud API returned a 404, and no REPLICATE_API_TOKEN fallback is configured in the .env file.",
    });
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

export default router;
