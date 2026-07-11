// Removed Gemini dependencies;
import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const API_KEY = process.env.NVIDIA_API_KEY || "";
const VIDEOS_DIR = path.join(__dirname, "..", "..", "public", "videos");
const IMAGES_DIR = path.join(__dirname, "..", "..", "public", "images");

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

if (!API_KEY) {
  console.error("***********************************************");
  console.error("CRITICAL ERROR: NVIDIA_API_KEY NOT FOUND!");
  console.error("Ensure your .env file has: NVIDIA_API_KEY=your_key");
  console.error("***********************************************");
  throw new Error("Missing NVIDIA API Key. Server reset required.");
}

console.log(`[Diagnostic] NVIDIA_API_KEY starting with: ${API_KEY.substring(0, 5)}...`);

async function generateImagePromptOnly(prompt: string): Promise<string> {
  const API_URL = "https://integrate.api.nvidia.com/v1/images/generations";
  const payload = {
    model: "nvidia/nemoretail-1.0",
    prompt: prompt,
    width: 1024,
    height: 1024,
    num_steps: 30,
    seed: 42,
  };
  
  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    });
    
    if (!response.data.data?.length) {
      throw new Error("Invalid NVIDIA response structure");
    }
    
    const imageResponse = await axios.get(response.data.data[0].url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    
    const base64Image = Buffer.from(imageResponse.data).toString("base64");
    return `data:image/png;base64,${base64Image}`;
  } catch (error) {
    throw error;
  }
}

async function generateVideoFromImage(prompt: string, imageBase64: string): Promise<string> {
  const API_URL = "https://integrate.api.nvidia.com/v1/neural-graphics/generations";
  const normalizedImage = imageBase64.startsWith("data:") 
    ? imageBase64 
    : `data:image/jpeg;base64,${imageBase64}`;
  
  const payload = {
    prompt: prompt || "Generate a cinematic walkthrough with realistic motion",
    image: normalizedImage,
    resolution: "720_16_9",
    num_frames: 60
  };
  
  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 300000,
    });
    
    const videoUrl = response.data.data[0].url;
    if (!videoUrl) throw new Error("Invalid video response structure");
    
    const videoBuffer = await axios.get(videoUrl, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      responseType: "arraybuffer",
    });
    
    const localFileName = `video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
    const filePath = path.join(VIDEOS_DIR, localFileName);
    fs.writeFileSync(filePath, Buffer.from(videoBuffer.data));
    
    return `/videos/${localFileName}`;
  } catch (error) {
    console.error("Video generation error:", error);
    throw error;
  }
}

async function generateImage(
  prompt: string,
  imageBase64: string = ""
): Promise<string> {
  // For image-to-image, we'd need to integrate with prompt processing,
  // but for text-to-image generation, we can use the prompt-only function
  if (imageBase64) {
    // This would be extended to handle image prompt variations
    const variations = [
      `${prompt} - texture variation 1`,
      `${prompt} - texture variation 2`,
      `${prompt} - texture variation 3`
    ];
    
    const results = await Promise.all(
      variations.map(async (variation, index) => {
        try {
          const image1 = await generateImagePromptOnly(variation);
          return {
            variation,
            image: image1,
            success: true
          };
        } catch (error) {
          throw error;
        }
      })
    );
    
    return results.map(r => r.image)[0];
  } else {
    return await generateImagePromptOnly(prompt);
  }
}

async function generateVideo(
  prompt: string,
  imageBase64: string = ""
): Promise<string> {
  if (imageBase64) {
    return await generateVideoFromImage(prompt, imageBase64);
  } else {
    return await generateVideoFromImage(prompt, "");
  }
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
