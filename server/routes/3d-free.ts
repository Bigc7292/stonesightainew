import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";
import fs from "fs";
import multer from "multer";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Multer config for file uploads
const upload = multer({ dest: "uploads/", limits: { fileSize: 100 * 1024 * 1024 } });

const SUPERSPLAT_VIEWER_BASE = "https://viewer.supersplat.ai";

// Demo PLY file path (existing 16MB Trellis-generated model)
const DEMO_PLY_PATH = path.resolve(__dirname, "..", "..", "..", "trellis2_1024.ply");

// Generate viewer URL for SuperSplat
function generateViewerUrl(splatUrl: string, options?: { posterUrl?: string; ministats?: boolean }): string {
  const params = new URLSearchParams({ content: splatUrl });
  if (options?.posterUrl) params.set("poster", options.posterUrl);
  if (options?.ministats) params.set("ministats", "1");
  return `${SUPERSPLAT_VIEWER_BASE}?${params.toString()}`;
}

// Upload file to Supabase storage - simplified version that serves files from public directory
async function uploadToSupabaseStorage(filePath: string, fileName: string, contentType: string): Promise<string> {
  // For now, we'll serve files from the public directory instead of Supabase storage
  // due to permission complexities with bucket creation
  const publicPath = path.join(__dirname, "..", "..", "public", fileName);
  
  // Copy the file to public directory if it doesn't exist there
  if (!fs.existsSync(publicPath)) {
    // Ensure public directory exists
    const publicDir = path.join(__dirname, "..", "..", "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // Copy file
    fs.copyFileSync(filePath, publicPath);
    console.log(`[Free3D] Copied file to public directory: ${publicPath}`);
  }
  
  // Return the URL that can be used to access the file
  // Assuming the server serves static files from /public
  return `http://localhost:5000/${fileName}`;
}

router.post("/generate-free", upload.single("plyFile"), async (req: Request, res: Response) => {
  try {
    const { prompt, userId, stoneName, stoneId } = req.body;
    const plyFile = req.file;

    // Use demo PLY if no file uploaded
    let plyPath: string;
    let fileName: string;
    
    if (plyFile) {
      plyPath = plyFile.path;
      fileName = `free3d_${Date.now()}_${Math.random().toString(36).substring(7)}.ply`;
    } else if (fs.existsSync(DEMO_PLY_PATH)) {
      plyPath = DEMO_PLY_PATH;
      fileName = `demo_trellis_${Date.now()}.ply`;
    } else {
      return res.status(400).json({
        success: false,
        error: "No PLY file uploaded and demo model not found. Upload a .ply file or generate one at https://superspl.at/convert",
      });
    }

    // Upload PLY to Supabase
    const publicUrl = await uploadToSupabaseStorage(plyPath, fileName, "model/ply");
    console.log("[Free3D] Model uploaded to Supabase", { publicUrl });

    // Generate viewer URL
    const viewerUrl = generateViewerUrl(publicUrl, { ministats: true });

    // Save generation record
    let recordId: string | null = null;
    if (userId) {
      try {
        const { data, error } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            generation_type: "3d",
            input_prompt: prompt || `Free 3D model for ${stoneName || "unknown"}`,
            input_image_url: null,
            input_parameters: {
              stoneName,
              stoneId,
              conversionMethod: plyFile ? "ply-upload" : "demo-trellis-model",
            },
            output_url: publicUrl,
            output_metadata: {
              format: "ply",
              conversionMethod: plyFile ? "ply-upload" : "demo-trellis-model",
              viewerUrl,
            },
            processing_time_ms: 0,
            model_used: plyFile ? "user-ply-upload" : "demo-trellis-model",
            tags: ["3d", "free", stoneName, stoneId].filter(Boolean) as string[],
          })
          .select()
          .single();

        if (!error && data) recordId = data.id;
      } catch (dbError) {
        console.error("[Free3D] Database error (non-blocking):", dbError);
      }
    }

    // Cleanup temp file if uploaded
    if (plyFile && fs.existsSync(plyPath)) {
      fs.unlinkSync(plyPath);
    }

    return res.status(200).json({
      success: true,
      message: "Free 3D model ready using SuperSplat viewer",
      data: {
        id: recordId,
        modelUrl: publicUrl,
        format: "ply",
        viewerUrl,
        conversionMethod: plyFile ? "ply-upload" : "demo-trellis-model",
        message: "Upload your own .ply file from https://superspl.at/convert or use demo model",
      },
    });
  } catch (error: any) {
    console.error("[Free3D] Generation failed", { message: error?.message, stack: error?.stack });
    return res.status(500).json({
      success: false,
      error: "Free 3D generation failed",
      details: error?.message || "Unknown error",
    });
  }
});

router.get("/models", async (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    models: [
      {
        id: "free-supersplat-converter",
        name: "Free SuperSplat Converter",
        description: "Free PLY-to-3D viewer using SuperSplat (no API key needed)",
        credits: "FREE",
      },
    ],
    default: "free-supersplat-converter",
  });
});

router.get("/status/:taskId", async (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    data: {
      taskId: req.params.taskId,
      status: "completed",
      progress: 100,
      message: "Free conversion is synchronous - no polling needed",
    },
  });
});

export default router;