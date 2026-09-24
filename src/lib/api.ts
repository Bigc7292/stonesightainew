/**
 * Typed client for the StoneSight backend (see docs/backend.md).
 * Every call carries the user's Supabase access token.
 */
import type { SceneAnalysis } from "../../shared/scene";
import type { Stone } from "../types";

export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:5000";

/** Resolves a server-relative asset path (e.g. /videos/x.mp4) to an absolute URL. */
export function apiAsset(pathOrUrl: string): string {
  return /^(https?:|data:|blob:)/.test(pathOrUrl) ? pathOrUrl : `${API_URL}${pathOrUrl}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, token: string | null | undefined, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(`Cannot reach the StoneSight server at ${API_URL}. Is it running (npm run server)?`, 0, "NETWORK");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new ApiError(body?.details || body?.error || `Request failed (${res.status})`, res.status, body?.code || "HTTP_ERROR");
  }
  return body as T;
}

export interface Capabilities {
  analysis: "claude" | "nvidia-vlm" | null;
  image: string[];
  video: string[];
  /** False when the StoneSight server could not be reached at all. */
  reachable?: boolean;
}

export async function getCapabilities(): Promise<Capabilities> {
  try {
    const body = await request<{ providers: Capabilities }>("/api/health", null);
    return { ...body.providers, reachable: true };
  } catch {
    return { analysis: null, image: [], video: [], reachable: false };
  }
}

const stonePayload = (stone: Stone) => ({
  name: stone.name,
  category: stone.category,
  tone: stone.tone,
  description: stone.description,
});

export async function analyzeRoom(token: string | null | undefined, image: string, swatch: string | null, stone: Stone) {
  return request<{ analysis: SceneAnalysis; analyzer: string; model: string }>("/api/analyze", token, {
    method: "POST",
    body: JSON.stringify({ image, swatch, stone: stonePayload(stone) }),
  });
}

export async function editImage(
  token: string | null | undefined,
  image: string,
  prompt: string,
  stone: Stone,
  extras: { swatch?: string | null; scene?: SceneAnalysis | null } = {},
) {
  return request<{ image: string; localPath: string; provider: string; model?: string; composited?: boolean }>(
    "/api/image/generate",
    token,
    {
      method: "POST",
      body: JSON.stringify({ image, prompt, stone: stonePayload(stone), swatch: extras.swatch ?? undefined, scene: extras.scene ?? undefined }),
    },
  );
}

export async function startVideoJob(token: string | null | undefined, image: string, prompt: string, stone: Stone) {
  return request<{ jobId: string }>("/api/video/generate", token, {
    method: "POST",
    body: JSON.stringify({ image, prompt, stone: stonePayload(stone) }),
  });
}

export async function getVideoJob(token: string | null | undefined, jobId: string) {
  return request<{ status: "queued" | "running" | "succeeded" | "failed"; videoUrl?: string; error?: string }>(
    `/api/video/status/${encodeURIComponent(jobId)}`,
    token,
  );
}

/** Polls a Cosmos job until it finishes (default: up to 20 minutes). */
export async function waitForVideo(
  token: string | null | undefined,
  jobId: string,
  { intervalMs = 5000, timeoutMs = 20 * 60_000, signal }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ApiError("cancelled", 0, "CANCELLED");
    const job = await getVideoJob(token, jobId);
    if (job.status === "succeeded" && job.videoUrl) return apiAsset(job.videoUrl);
    if (job.status === "failed") throw new ApiError(job.error || "Video generation failed", 502, "NVIDIA_VIDEO_FAILED");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new ApiError("Video generation timed out", 504, "NVIDIA_VIDEO_TIMEOUT");
}
