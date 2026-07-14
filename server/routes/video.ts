import { Router, Request, Response } from 'express';

const router = Router();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Endpoint resolution order:
//   1. COSMOS_INFERENCE_URL  (e.g. a local Cosmos3 NIM container: http://localhost:8000/v1/infer)
//   2. Cloud-hosted NVIDIA Cosmos 3 GenAI endpoint (the ai.api.nvidia.com/v1/genai host that
//      FLUX uses successfully). NOTE: as of mid-2026 NVIDIA had NOT yet provisioned Cosmos 3 as a
//      callable cloud API — the nvcf /v1/infer and /v1/gr routes return a bare Go-server 404.
//      If the cloud route 404s, run a local Cosmos3 NIM container and set COSMOS_INFERENCE_URL.
const COSMOS_API_URL =
  process.env.COSMOS_INFERENCE_URL ||
  'https://ai.api.nvidia.com/v1/genai/nvidia/cosmos-3-super';

// Define the structural interface for the expected NVIDIA Cloud Response
interface NvidiaCosmosResponse {
  id?: string;
  outputs?: string[];
  b64_video?: string;
  videoUrl?: string;
  video?: { url?: string };
  [key: string]: any; // Fallback index signature for unexpected response data structures
}

/**
 * @route   POST /api/video/generate
 * @desc    Generate a video from a text prompt or an image using cloud-hosted NVIDIA Cosmos 3
 * @access  Public/Private (Depending on your auth setup)
 */
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, imageUrl, image, negativePrompt, duration, seed } = req.body;

    // 1. Verify credentials
    if (!NVIDIA_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'NVIDIA_API_KEY is missing from the server environment configuration.',
      });
      return;
    }

    // 2. Enforce minimum request parameters
    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'A prompt string is required for video generation.',
      });
      return;
    }

    // The frontend sends the uploaded image under `image` (base64 data URL); accept both
    // `imageUrl` and `image` so image-to-video is selected correctly.
    const imageSource = imageUrl || image;

    // 3. Construct the payload matching the Cosmos 3 API specification
    // Cosmos 3 automatically infers mode: if an image is present -> IMAGE2VIDEO, else -> TEXT2VIDEO
    const payload: Record<string, any> = {
      model: imageSource ? 'nvidia/cosmos-3-super/image-to-video' : 'nvidia/cosmos-3-super/text-to-video',
      prompt: prompt,
      negative_prompt: negativePrompt || 'blurry, low quality, artifacts, distorted, unrealistic movement',
      seed: seed !== undefined ? Number(seed) : Math.floor(Math.random() * 1000000),
      guidance_scale: 6.0,
      num_inference_steps: 28,
    };

    // If an image context is supplied, attach it to the vision conditioning field
    if (imageSource) {
      payload.image_url = imageSource;
    }

    // 4. Dispatch the request to the cloud-accelerated inference cluster
    const response = await fetch(COSMOS_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // 5. Handle error responses gracefully
    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = errorText;
      }

      console.error("[VIDEO] NVIDIA Cosmos request failed", {
        endpoint: COSMOS_API_URL,
        model: imageSource ? "nvidia/cosmos-3-super/image-to-video" : "nvidia/cosmos-3-super/text-to-video",
        status: response.status,
        statusText: response.statusText,
        details: errorText.slice(0, 600),
      });

      res.status(response.status).json({
        success: false,
        error: 'The cloud inference engine returned an error response.',
        details: parsedError,
      });
      return;
    }

    // Explicitly cast to NvidiaCosmosResponse interface to satisfy TypeScript compilation checks
    const data = (await response.json()) as NvidiaCosmosResponse;

    // 6. Return the standard structured output payload back to the client application
    res.status(200).json({
      success: true,
      message: 'Video generation completed successfully via cloud compute.',
      data: {
        id: data.id || null,
        videoUrl: data.outputs?.[0] || data.b64_video || data.videoUrl || data.video?.url || null,
        seed: payload.seed,
        status: 'completed'
      }
    });

  } catch (error: any) {
    // 7. Catch-all safety block for handling transport, timeout, or parsing exceptions
    console.error("[VIDEO] /generate failed", {
      endpoint: COSMOS_API_URL,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      error: 'An unexpected internal server error occurred while processing the video route.',
      details: error.message || error,
    });
  }
});

export default router;
