import { Router, Request, Response } from 'express';

const router = Router();

// Ensure your environment variables are configured in your .env file:
// NVIDIA_API_KEY=nvapi-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const COSMOS_API_URL = 'https://api.nvcf.nvidia.com/v1/infer/nvidia/cosmos-3-super';

// Define the structural interface for the expected NVIDIA Cloud Response
interface NvidiaCosmosResponse {
  id?: string;
  outputs?: string[];
  b64_video?: string;
  [key: string]: any; // Fallback index signature for unexpected response data structures
}

/**
 * @route   POST /api/video/generate
 * @desc    Generate a video from a text prompt or an image using cloud-hosted NVIDIA Cosmos 3
 * @access  Public/Private (Depending on your auth setup)
 */
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, imageUrl, negativePrompt, duration, seed } = req.body;

    // 1. Validate that the API key exists before attempting any cloud network requests
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

    // 3. Construct the payload matching the Cosmos 3 Open-API inference specification
    // Cosmos 3 automatically infers mode: if imageUrl is present -> IMAGE2VIDEO, else -> TEXT2VIDEO
    const payload: Record<string, any> = {
      model: imageUrl ? 'nvidia/cosmos-3-super/image-to-video' : 'nvidia/cosmos-3-super/text-to-video',
      prompt: prompt,
      negative_prompt: negativePrompt || 'blurry, low quality, artifacts, distorted, unrealistic movement',
      seed: seed !== undefined ? Number(seed) : Math.floor(Math.random() * 1000000),
      guidance_scale: 6.0,
      num_inference_steps: 28,
    };

    // If an image context is supplied, attach it to the vision conditioning field
    if (imageUrl) {
      payload.image_url = imageUrl;
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

    // 5. Handle non-OK downstream responses gracefully
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
        model: imageUrl ? "nvidia/cosmos-3-super/image-to-video" : "nvidia/cosmos-3-super/text-to-video",
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

    // Explicitly cast the json() resolution promise to our NvidiaCosmosResponse interface 
    // to safely resolve the 'unknown' object binding and appease the compiler.
    const data = (await response.json()) as NvidiaCosmosResponse;

    // 6. Return the standard structured output payload back to your client-side application
    res.status(200).json({
      success: true,
      message: 'Video generation completed successfully via cloud compute.',
      data: {
        id: data.id || null,
        videoUrl: data.outputs?.[0] || data.b64_video || null,
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