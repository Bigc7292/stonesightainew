import { Router, Request, Response } from "express";
import { generateVideo } from "../utils/genai";

const router = Router();

/**
 * @route POST /api/video/generate
 * @description Generate a video using Google Veo
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

    const imageBase64 = image.split(",")[1] || image;

    const videoUrl = await generateVideo(
      (req as any).genAI,
      prompt,
      imageBase64,
    );

    return res.status(200).json({
      success: true,
      video: videoUrl,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return res.status(500).json({
      error: "Failed to generate video",
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
    const videoUrl = url.includes("key=") ? url : `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;

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
