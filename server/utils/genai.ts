import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

// Force reload environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const API_KEY = process.env.NEW_VEO_KEY || process.env.GEMINI_API_KEY || "";
const VIDEOS_DIR = path.join(__dirname, "..", "..", "public", "videos");

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

if (!API_KEY) {
  console.error("***********************************************");
  console.error("CRITICAL ERROR: API KEY NOT FOUND!");
  console.error("Ensure your .env file has: NEW_VEO_KEY=your_key");
  console.error("***********************************************");
  throw new Error("Missing API Key. Server reset required.");
}

console.log(`[Diagnostic] Using Key starting with: ${API_KEY.substring(0, 5)}...`);

/**
 * Generate an image using Google's Gemini 2.5 Flash Image model
 */
export async function generateImage(
  genAI: GoogleGenAI,
  prompt: string,
  imageBase64: string,
): Promise<string> {
  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            inlineData: {
              data: imageBase64,
              mimeType: "image/png",
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    for (const part of result.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    throw new Error("No image data in response");
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
}

/**
 * Generate a video using Google's Veo model
 * Uses axios for download to bypass SDK URI parsing bug
 */
export async function generateVideo(
  genAI: GoogleGenAI,
  prompt: string,
  imageBase64: string,
): Promise<string> {
  try {
    console.log(`[Veo] Starting video generation...`);

    let operation = await genAI.models.generateVideos({
      model: "veo-2.0-generate-001",
      source: {
        prompt: prompt,
        image: {
          imageBytes: imageBase64,
          mimeType: "image/png",
        },
      },
      config: {
        numberOfVideos: 1,
        aspectRatio: "16:9",
      },
    });

    console.log(`[Veo] Operation started, polling for completion...`);

    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      operation = await genAI.operations.getVideosOperation({
        operation: operation,
      });
      console.log(`[Veo] Operation status: ${operation.done ? "done" : "in progress..."}`);
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) {
      throw new Error("No video URI in response");
    }

    console.log(`[Veo] Raw video URI: ${videoUri}`);

    // Extract file name from URI (e.g., "files/abc123:download" -> "abc123")
    const fileNameMatch = videoUri.match(/files\/([^:]+)/);
    if (!fileNameMatch) {
      throw new Error("Could not extract file name from URI");
    }
    const googleFileName = fileNameMatch[1];

    // Download using axios to bypass SDK parsing bug
    const downloadUrl = `https://generativelanguage.googleapis.com/v1beta/files/${googleFileName}:download?alt=media&key=${API_KEY}`;
    console.log(`[Veo] Downloading video via axios...`);

    const videoResponse = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
    });

    // Save to local public folder
    const localFileName = `veo_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
    const filePath = path.join(VIDEOS_DIR, localFileName);
    fs.writeFileSync(filePath, Buffer.from(videoResponse.data));

    const localUrl = `/videos/${localFileName}`;
    console.log(`[Veo] Video saved locally: ${localUrl}, size: ${(videoResponse.data.length / 1024 / 1024).toFixed(1)}MB`);
    return localUrl;
  } catch (err: any) {
    console.error(`[Veo] Video generation failed:`, err.message || err);
    throw err;
  }
}
