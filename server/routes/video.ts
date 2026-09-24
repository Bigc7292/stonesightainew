/**
 * First-person walkthrough video via NVIDIA Cosmos (image-to-video).
 *
 * POST /api/video/generate  { image: dataURL, prompt?: string, stone?: {...}, seed?: number }
 *   → 202 { success: true, jobId }
 *   → 503 { code: "NVIDIA_VIDEO_UNAVAILABLE" } when COSMOS_INFERENCE_URL is unset
 *     (the frontend then records the walkthrough from the 3D scene instead).
 * GET  /api/video/status/:jobId
 *   → { success: true, status: queued|running|succeeded|failed, videoUrl?, error? }
 *
 * `prompt` is normally Claude's `video_prompt`; otherwise a first-person
 * template is used. Extra model-specific parameters can be supplied through
 * the COSMOS_EXTRA_PARAMS environment variable (JSON).
 */
import { Router, Request, Response } from "express";
import { config } from "../lib/env";
import { JobStore } from "../lib/jobs";
import { decodeImage, saveGeneratedAsset, toJpeg } from "../lib/images";
import { extractVideo, nvidiaInvoke } from "../lib/nvidia";
import { fallbackVideoPrompt, VIDEO_NEGATIVE_PROMPT } from "../lib/prompts";

const router = Router();
const jobs = new JobStore<{ videoPath: string }>();

const userIdOf = (req: Request) => ((req as any).user?.id as string) || "anonymous";

async function runCosmos(image: Buffer, prompt: string, seed: number): Promise<{ videoPath: string }> {
  const input = await toJpeg(image, 1280, 92);
  const data = await nvidiaInvoke(
    config.cosmosInferenceUrl(),
    {
      prompt,
      negative_prompt: VIDEO_NEGATIVE_PROMPT,
      image: `data:image/jpeg;base64,${input.buffer.toString("base64")}`,
      seed,
      ...config.cosmosExtraParams(),
    },
    { apiKey: config.nvidiaApiKey() || undefined, timeoutMs: 20 * 60_000, pollIntervalMs: 5000 },
  );

  const video = extractVideo(data as Record<string, any>);
  let buffer: Buffer;
  if (video.base64) {
    buffer = Buffer.from(video.base64, "base64");
  } else if (video.url) {
    const res = await fetch(video.url);
    if (!res.ok) throw new Error(`could not download Cosmos output (${res.status})`);
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error(`unexpected Cosmos response keys: ${Object.keys(data).join(", ")}`);
  }
  const videoPath = saveGeneratedAsset("videos", buffer, "mp4");
  console.log("[VIDEO] Cosmos walkthrough saved", { videoPath, bytes: buffer.length });
  return { videoPath };
}

router.post("/generate", (req: Request, res: Response) => {
  const { image, prompt, stone, seed } = req.body ?? {};
  if (typeof image !== "string" || !image) {
    return res.status(400).json({ success: false, code: "BAD_REQUEST", error: "Required: image (data URL)" });
  }
  if (!config.cosmosInferenceUrl()) {
    return res.status(503).json({
      success: false,
      code: "NVIDIA_VIDEO_UNAVAILABLE",
      error: "NVIDIA Cosmos is not configured (set COSMOS_INFERENCE_URL).",
    });
  }
  const text =
    typeof prompt === "string" && prompt.trim()
      ? prompt.trim().slice(0, 2000)
      : fallbackVideoPrompt({ name: stone?.name || "luxury stone" });

  const job = jobs.create(userIdOf(req));
  const buffer = decodeImage(image).buffer;
  const useSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1_000_000);
  jobs.run(job, () => runCosmos(buffer, text, useSeed));
  return res.status(202).json({ success: true, jobId: job.id });
});

router.get("/status/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId, userIdOf(req));
  if (!job) return res.status(404).json({ success: false, code: "NOT_FOUND", error: "Unknown job" });
  return res.json({
    success: true,
    status: job.status,
    videoUrl: job.result?.videoPath,
    error: job.error,
  });
});

export default router;
