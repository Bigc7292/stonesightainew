/**
 * Minimal NVIDIA NIM / NVCF client used for FLUX.1 Kontext (image editing)
 * and Cosmos (image-to-video).
 *
 * Handles the three behaviours of NVIDIA endpoints that the previous code
 * missed:
 *   - Hosted NVCF functions answer long jobs with `202 Accepted` + an
 *     `NVCF-REQID` header; the result must be polled from
 *     `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/{reqId}`.
 *   - Hosted functions reject large inline base64 payloads; images are
 *     uploaded as NVCF assets and referenced as `data:<mime>;asset_id,<id>`.
 *   - Responses come in several shapes (`artifacts[0].base64`, `b64_json`,
 *     `image`, `b64_video`, `video`, …).
 */

export const NVCF_STATUS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status";
export const NVCF_ASSETS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/assets";

export class NvidiaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body = "",
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export interface InvokeOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  /** Total time budget including NVCF polling. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/** POSTs JSON to a NIM / NVCF endpoint and resolves the final JSON body. */
export async function nvidiaInvoke(
  url: string,
  body: unknown,
  options: InvokeOptions = {},
): Promise<Record<string, unknown>> {
  const doFetch = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
  const auth: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};

  let res = await doFetch(url, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });

  while (res.status === 202) {
    const reqId = res.headers.get("nvcf-reqid");
    if (!reqId) throw new NvidiaError("NVIDIA returned 202 without an NVCF-REQID header", 502);
    if (Date.now() > deadline) throw new NvidiaError(`NVIDIA job ${reqId} timed out`, 504);
    await sleep(options.pollIntervalMs ?? 3000);
    res = await doFetch(`${NVCF_STATUS_URL}/${reqId}`, {
      headers: { ...auth, Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NvidiaError(`NVIDIA request failed with status ${res.status}: ${truncate(text)}`, res.status, text);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Uploads a binary input as an NVCF asset (used for hosted endpoints, whose
 * inline payload limit is ~180 KB). Returns the asset id.
 */
export async function uploadNvcfAsset(
  apiKey: string,
  data: Buffer,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const description = "stonesight-input";
  const create = await fetchImpl(NVCF_ASSETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ contentType, description }),
  });
  if (!create.ok) {
    throw new NvidiaError(`NVCF asset creation failed (${create.status})`, create.status, await create.text());
  }
  const { uploadUrl, assetId } = (await create.json()) as { uploadUrl: string; assetId: string };
  const put = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-amz-meta-nvcf-asset-description": description },
    body: new Uint8Array(data),
  });
  if (!put.ok) throw new NvidiaError(`NVCF asset upload failed (${put.status})`, put.status);
  return assetId;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) if (typeof c === "string" && c.length > 0) return c;
  return undefined;
}

/** Pulls a base64 image out of any known NIM response shape. */
export function extractImageBase64(data: Record<string, any>): string | undefined {
  const b64 = firstString(
    data?.artifacts?.[0]?.base64,
    data?.data?.[0]?.b64_json,
    data?.b64_json,
    data?.image,
    data?.images?.[0],
    data?.b64_output,
    data?.outputs?.[0],
  );
  return b64?.replace(/^data:[^,]+,/, "");
}

/** Pulls a base64 MP4 (or a URL) out of any known Cosmos response shape. */
export function extractVideo(data: Record<string, any>): { base64?: string; url?: string } {
  const b64 = firstString(data?.b64_video, data?.video_b64, data?.artifacts?.[0]?.base64);
  if (b64) return { base64: b64.replace(/^data:[^,]+,/, "") };
  const other = firstString(data?.video, data?.outputs?.[0], data?.video?.url);
  if (!other) return {};
  return /^https?:\/\//.test(other) ? { url: other } : { base64: other.replace(/^data:[^,]+,/, "") };
}
