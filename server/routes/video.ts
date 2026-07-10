import { Router, Request, Response } from "express";
import axios from "axios";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Reload environment so the server-side NVIDIA key is available at request time.
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const router = Router();

/**
 * NVIDIA Enterprise API (NVIDIA NIM) video gateway configuration.
 * All cinematic walkthrough generation traffic is routed here instead
 * of the previous expensive third-party provider.
 * * The hosted Cosmos image-to-video NIM is served from the dedicated 
 * `ai.api.nvidia.com/v1/genai` gateway. It exposes a custom schema:
 * { prompt, image, resolution }
 * and returns the generated video at: response.data.b64_video
 */
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://ai.api.nvidia.com/v1";
const NVIDIA_VIDEO_MODEL = "nvidia/cosmos3-nano";
const NVIDIA_VIDEO_ENDPOINT = `${NVIDIA_BASE_URL}/genai/${NVIDIA_VIDEO_MODEL}`;

/**
 * Generate a video from the transformed image frame using the NVIDIA Cosmos
 * Image-to-Video NIM pipeline, then persist it locally and return the URL.
 */
async function generateVideoWithNvidia(
  prompt: string,
  imageBase64: string
): Promise<string> {
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";

  // Normalize the base64 image data string format for the NVIDIA custom payload.
  const formattedImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  // Payload exactly as verified for NVIDIA Cosmos NIM
  const payload = {
    prompt,
    image: formattedImage,
    resolution: "720_16_9",
  };

  const response = await axios.post(NVIDIA_VIDEO_ENDPOINT, payload, {
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 300000, // 5-minute timeout for video frame synthesis processing
  });

  interface NvidiaVideoResponse {
    b64_video?: string;
  }

  const data = response.data as NvidiaVideoResponse;
  const generatedVideo = data?.b64_video || null;

  if (!generatedVideo) {
    throw new Error("No video data returned from NVIDIA endpoint");
  }

  // Ensure proper MIME type prefix for base64 output
  const videoBase64 = generatedVideo.startsWith("data:")
    ? generatedVideo
    : `data:video/mp4;base64,${generatedVideo}`;

  // Local asset directory (mirrors the existing public/videos convention).
  const VIDEOS_DIR = path.join(__dirname, "..", "..", "public", "videos");
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  }

  // Generate a unique filename and write the buffer to disk
  const localFileName = `cosmos_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
  const filePath = path.join(VIDEOS_DIR, localFileName);
  const videoBuffer = Buffer.from(videoBase64.replace(/^data:video\/mp4;base64,/, ""), "base64");
  
  fs.writeFileSync(filePath, videoBuffer);

  const localUrl = `/videos/${localFileName}`;
  console.log(`[Cosmos] Video saved locally: ${localUrl}, size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
  
  return localUrl;
}

/**
 * @route POST /api/video/generate
 * @description Generate a physics-aware cinematic walkthrough clip from a stone render image
 * @access Private
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, image } = req.body;

    if (!prompt || !image) {
      return res.status(400).json({
        error: "Missing required fields: prompt and image",
      });
    }

    const pureBase64 = image.split(",")[1] || image;
    const videoUrl = await generateVideoWithNvidia(prompt, pureBase64);

    return res.status(200).json({
      success: true,
      video: videoUrl,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return res.status(500).json({
      error: "Failed to generate cinematic video",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @route GET /api/video/download
 * @description Proxy video download through server to handle authentication
 * @access Private
 */
router.get("/download", async (req: Request, res: Response) => {
  try {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing video URL" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const videoUrl = url.includes("key=")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;

    console.log(`[Video] Proxying download from: ${videoUrl.substring(0, 100)}...`);

    const response = await fetch(videoUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video] Download failed: ${errorText}`);
      res.status(response.status).json({
        error: "Failed to download video",
        details: errorText,
      });
      return;
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "attachment; filename=video.mp4");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Video download error:", error);
    res.status(500).json({
      error: "Failed to download video",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;