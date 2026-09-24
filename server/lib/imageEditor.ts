/**
 * NVIDIA FLUX.1 Kontext image editing (true image-to-image: the room photo is
 * edited in place, not regenerated from text).
 *
 * Resolution order:
 *   1. FLUX_INFERENCE_URL — self-hosted / tunnelled Kontext NIM (any image).
 *   2. NVIDIA-hosted Kontext (build.nvidia.com) with NVIDIA_API_KEY. Large
 *      inputs are sent as NVCF assets. Some hosted preview deployments only
 *      accept NVIDIA's example images; when that is detected the hosted path
 *      is switched off for the rest of the process to avoid wasted calls.
 *
 * If neither path succeeds the caller returns a structured error and the
 * frontend falls back to the Claude-guided local stone renderer.
 */
import { config } from "./env";
import { extractImageBase64, nvidiaInvoke, NvidiaError, uploadNvcfAsset } from "./nvidia";
import { sniffImageMime, toJpeg } from "./images";

export type ImageProvider = "nvidia-kontext-self-hosted" | "nvidia-kontext-hosted";

export interface EditResult {
  buffer: Buffer;
  mime: string;
  provider: ImageProvider;
}

const INLINE_LIMIT_BYTES = 180_000;
let hostedRejectsCustomImages = false;

export function imageEditProviders(): ImageProvider[] {
  const list: ImageProvider[] = [];
  if (config.fluxInferenceUrl()) list.push("nvidia-kontext-self-hosted");
  if (config.nvidiaApiKey() && config.nvidiaHostedImageEnabled() && !hostedRejectsCustomImages) {
    list.push("nvidia-kontext-hosted");
  }
  return list;
}

/** Test helper. */
export function resetHostedImageMemo() {
  hostedRejectsCustomImages = false;
}

function kontextBody(prompt: string, image: string, seed: number) {
  return {
    prompt,
    image,
    aspect_ratio: "match_input_image",
    steps: 30,
    cfg_scale: 3.5,
    seed,
  };
}

export async function editWithKontext(photo: Buffer, prompt: string, seed?: number): Promise<EditResult> {
  const providers = imageEditProviders();
  if (providers.length === 0) {
    throw new NvidiaError("No NVIDIA image-editing endpoint configured", 503);
  }
  // Kontext works natively around 1 megapixel.
  const input = await toJpeg(photo, 1024, 92);
  const useSeed = seed ?? Math.floor(Math.random() * 2_147_483_647);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      let data: Record<string, unknown>;
      if (provider === "nvidia-kontext-self-hosted") {
        data = await nvidiaInvoke(
          config.fluxInferenceUrl(),
          kontextBody(prompt, `data:image/jpeg;base64,${input.buffer.toString("base64")}`, useSeed),
          { apiKey: config.nvidiaApiKey() || undefined, timeoutMs: 4 * 60_000 },
        );
      } else {
        const apiKey = config.nvidiaApiKey();
        let image = `data:image/jpeg;base64,${input.buffer.toString("base64")}`;
        const headers: Record<string, string> = {};
        if (input.buffer.length > INLINE_LIMIT_BYTES) {
          const assetId = await uploadNvcfAsset(apiKey, input.buffer, "image/jpeg");
          image = `data:image/jpeg;asset_id,${assetId}`;
          headers["NVCF-INPUT-ASSET-REFERENCES"] = assetId;
        }
        data = await nvidiaInvoke(config.nvidiaHostedImageUrl(), kontextBody(prompt, image, useSeed), {
          apiKey,
          headers,
          timeoutMs: 4 * 60_000,
        });
      }

      const b64 = extractImageBase64(data as Record<string, any>);
      if (!b64) throw new Error(`unexpected response keys: ${Object.keys(data).join(", ")}`);
      const buffer = Buffer.from(b64, "base64");
      console.log("[IMAGE] Kontext edit succeeded", { provider, bytes: buffer.length });
      return { buffer, mime: sniffImageMime(buffer), provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        provider === "nvidia-kontext-hosted" &&
        error instanceof NvidiaError &&
        error.status === 422 &&
        /example_id/i.test(error.body)
      ) {
        hostedRejectsCustomImages = true;
        console.warn(
          "[IMAGE] Hosted Kontext only accepts NVIDIA example images on this key — disabling hosted path. Deploy the Kontext NIM and set FLUX_INFERENCE_URL.",
        );
      }
      console.error("[IMAGE] Kontext provider failed", { provider, message });
      errors.push(`${provider}: ${message}`);
    }
  }
  throw new NvidiaError(errors.join(" | "), 502);
}
