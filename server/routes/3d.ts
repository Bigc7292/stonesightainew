import { Router, Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });

const router = Router();

const TRIPO_API_KEY = process.env.TRIPO_API_KEY || "";
const TRIPO_API_URL = process.env.TRIPO_API_URL || "https://openapi.tripo3d.ai/v3";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface TripoTaskResponse {
  code: number;
  data: {
    task_id: string;
  };
  message: string;
}

interface TripoTaskStatus {
  code: number;
  data: {
    task_id: string;
    status: "queued" | "running" | "success" | "failed";
    progress: number;
    model_version: string;
    output: {
      pbr_model: string;
      rendered_image: string;
      model: string;
      glb: string;
      ply: string;
      usdz: string;
      obj: string;
      fbx: string;
    };
    input: any;
    error?: string;
  };
  message: string;
}

function safeTruncate(value: unknown, max = 600): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "(unserializable)";
  }
}

function validateTripoKey(): string {
  if (!TRIPO_API_KEY) {
    throw new Error("TRIPO_API_KEY not configured in environment");
  }
  return TRIPO_API_KEY;
}

async function uploadToSupabaseStorage(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  const bucketName = "3d-scenes";
  
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === bucketName);
  
  if (!bucketExists) {
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 104857600,
    });
    if (createError && !createError.message.includes("already exists")) {
      console.error("[3D] Failed to create bucket:", createError);
      throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }
  }

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error("[3D] Supabase upload error:", error);
    throw new Error(`Failed to upload to Supabase: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
}

async function createTripoTask(imageUrl: string): Promise<string> {
  const apiKey = validateTripoKey();

  const payload = {
    type: "image_to_model",
    file: {
      type: "url",
      url: imageUrl,
    },
    model_version: "v3.1-20260211",
    texture: true,
    pbr: true,
    texture_quality: "detailed",
    enable_image_autofix: false,
    orientation: "default",
  };

  console.log("[3D] Creating Tripo task", {
    endpoint: `${TRIPO_API_URL}/generation/image-to-model`,
    imageUrl: imageUrl.slice(0, 100),
  });

  const response = await fetch(`${TRIPO_API_URL}/generation/image-to-model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

if (!response.ok) {
      const errorText = await response.text();
      console.error("[3D] Tripo API error creating task", {
        status: response.status,
        statusText: response.statusText,
        details: safeTruncate(errorText),
      });

      if (response.status === 401) {
        throw new Error("TRIPO_API_KEY_INVALID: The API key is not valid for v2 API. Get a v2 API key from https://platform.tripo3d.ai (the key should NOT have 'tcli_' prefix). Update TRIPO_API_KEY in server/.env");
      }

      throw new Error(`Tripo API failed with status ${response.status}: ${safeTruncate(errorText)}`);
    }

  const data = (await response.json()) as TripoTaskResponse;

  if (data.code !== 0 || !data.data?.task_id) {
    throw new Error(`Tripo API returned unexpected response: ${safeTruncate(data)}`);
  }

  console.log("[3D] Tripo task created", { taskId: data.data.task_id });
  return data.data.task_id;
}

async function pollTripoTask(taskId: string): Promise<TripoTaskStatus["data"]> {
  const apiKey = validateTripoKey();
  const maxAttempts = 180;
  const pollInterval = 3000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${TRIPO_API_URL}/tasks/${taskId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[3D] Tripo API error polling task", {
        taskId,
        status: response.status,
        statusText: response.statusText,
        details: safeTruncate(errorText),
      });

      if (response.status === 401) {
        throw new Error("Tripo API authentication failed (401). The API key may be for v3 API only, or has expired/revoked. Generate a new v2 API key from https://platform.tripo3d.ai");
      }

      throw new Error(`Tripo API polling failed with status ${response.status}: ${safeTruncate(errorText)}`);
    }

    const data = (await response.json()) as TripoTaskStatus;

    if (data.code !== 0) {
      throw new Error(`Tripo API returned error: ${safeTruncate(data)}`);
    }

    const taskData = data.data;
    console.log("[3D] Tripo task status", {
      taskId,
      status: taskData.status,
      progress: taskData.progress,
      attempt: attempt + 1,
    });

    if (taskData.status === "success") {
      return taskData;
    }

    if (taskData.status === "failed") {
      throw new Error(`Tripo task failed: ${taskData.error || "Unknown error"}`);
    }

    if (taskData.status === "queued" || taskData.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    throw new Error(`Tripo task returned unknown status: ${taskData.status}`);
  }

  throw new Error("Tripo task timed out after maximum polling attempts");
}

async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { imageUrl, prompt, userId, stoneName, stoneId } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: imageUrl",
      });
    }

    console.log("[3D] Generation request received", {
      hasImageUrl: !!imageUrl,
      imageUrlPrefix: imageUrl.slice(0, 100),
      prompt: prompt?.slice(0, 100),
      userId,
      stoneName,
      stoneId,
    });

    const taskId = await createTripoTask(imageUrl);
    const taskResult = await pollTripoTask(taskId);

    const plyUrl = taskResult.output?.ply;
    const glbUrl = taskResult.output?.glb;
    const modelUrl = plyUrl || glbUrl;

    if (!modelUrl) {
      console.error("[3D] No model URL in Tripo response", {
        taskId,
        output: taskResult.output,
      });
      return res.status(500).json({
        success: false,
        error: "Tripo generated no downloadable model",
      });
    }

    console.log("[3D] Downloading model from Tripo", {
      modelUrl: modelUrl.slice(0, 100),
      format: plyUrl ? "PLY" : "GLB",
    });

    const modelBuffer = await downloadFile(modelUrl);
    const fileName = `3d_${Date.now()}_${Math.random().toString(36).substring(7)}.${plyUrl ? "ply" : "glb"}`;
    const contentType = plyUrl ? "model/ply" : "model/gltf-binary";

    const publicUrl = await uploadToSupabaseStorage(modelBuffer, fileName, contentType);

    console.log("[3D] Model uploaded to Supabase", {
      publicUrl,
      fileName,
      size: modelBuffer.length,
    });

    let recordId: string | null = null;
    if (userId) {
      try {
        const { data, error } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            generation_type: "3d",
            input_prompt: prompt || `Generate 3D model for ${stoneName}`,
            input_image_url: imageUrl,
            input_parameters: {
              stoneName,
              stoneId,
              tripoTaskId: taskId,
              modelVersion: taskResult.model_version,
            },
            output_url: publicUrl,
            output_metadata: {
              taskId,
              modelVersion: taskResult.model_version,
              format: plyUrl ? "ply" : "glb",
              tripoOutput: taskResult.output,
            },
            processing_time_ms: 0,
            model_used: "tripo-v3.1",
            tags: ["3d", stoneName, stoneId].filter(Boolean) as string[],
          })
          .select()
          .single();

        if (error) {
          console.error("[3D] Failed to save generation record:", error);
        } else {
          recordId = data.id;
        }
      } catch (dbError) {
        console.error("[3D] Database error (non-blocking):", dbError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "3D generation completed successfully",
      data: {
        id: recordId,
        modelUrl: publicUrl,
        format: plyUrl ? "ply" : "glb",
        taskId,
        modelVersion: taskResult.model_version,
        tripoOutput: taskResult.output,
      },
    });
  } catch (error: any) {
    console.error("[3D] Generation failed", {
      message: error?.message,
      stack: error?.stack,
    });

    const statusCode = error?.message?.includes("TRIPO_API_KEY") ? 503 : 500;
    return res.status(statusCode).json({
      success: false,
      error: "3D generation failed",
      details: error?.message || "Unknown error",
    });
  }
});

router.get("/models", async (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    models: [
      {
        id: "tripo-v3.1",
        name: "Tripo v3.1",
        description: "High-fidelity 3D generation from single image (PBR, detailed textures)",
        credits: "20-30 credits",
      },
    ],
    default: "tripo-v3.1",
  });
});

router.get("/status/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const taskResult = await pollTripoTask(taskId);

    return res.status(200).json({
      success: true,
      data: {
        taskId,
        status: taskResult.status,
        progress: taskResult.progress,
        modelVersion: taskResult.model_version,
        output: taskResult.output,
      },
    });
  } catch (error: any) {
    console.error("[3D] Status check failed", {
      taskId: req.params.taskId,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to check task status",
      details: error?.message,
    });
  }
});

export default router;