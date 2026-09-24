/**
 * Environment loading and provider configuration for the StoneSight backend.
 *
 * `.env` files are loaded from `server/.env` first, then the project root
 * `.env`. Values that already exist in `process.env` always win, so real
 * deployment environment variables are never overridden by a stray file.
 *
 * Only two AI providers are supported, by design:
 *   - Anthropic Claude  → scene analysis + prompt planning (vision)
 *   - NVIDIA NIM        → pixel generation (FLUX.1 Kontext image edit, Cosmos video),
 *                         and optionally a hosted VLM for scene analysis
 *
 * Config is read through functions (not module constants) so tests and
 * long-running processes always see the current environment.
 */
import dotenv from "dotenv";
import path from "path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });
}

loadEnv();

const str = (name: string, fallback = ""): string =>
  (process.env[name] ?? "").trim() || fallback;

/** Default NVIDIA-hosted FLUX.1 Kontext endpoint (build.nvidia.com). */
export const NVIDIA_HOSTED_KONTEXT_URL =
  "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev";

export const config = {
  port: () => Number(str("PORT", "5000")),
  clientUrl: () => str("CLIENT_URL"),
  testMode: () => str("MCP_TEST_MODE") === "true",

  // --- Anthropic Claude -----------------------------------------------------
  anthropicApiKey: () => str("ANTHROPIC_API_KEY"),
  claudeModel: () => str("CLAUDE_MODEL", "claude-opus-5"),
  /** low | medium | high | xhigh | max — geometry work benefits from high. */
  claudeEffort: () =>
    str("CLAUDE_EFFORT", "high") as "low" | "medium" | "high" | "xhigh" | "max",

  /**
   * Number of "look at your outlines on the photo and correct them" passes
   * after the first analysis (0 disables). Each pass is one more Claude call.
   */
  claudeRefinePasses: () => Math.max(0, Math.min(3, Number(str("CLAUDE_REFINE_PASSES", "1")) || 0)),

  // --- NVIDIA ---------------------------------------------------------------
  nvidiaApiKey: () => str("NVIDIA_API_KEY"),
  /** OpenAI-compatible NVIDIA API used for the optional VLM scene analyser. */
  nvidiaBaseUrl: () => str("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
  /** Ordered, comma-separated list of NVIDIA vision models; tried in turn. */
  nvidiaVlmModels: () =>
    str("NVIDIA_VLM_MODEL", "meta/llama-3.2-90b-vision-instruct,meta/llama-3.2-11b-vision-instruct")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  /** Self-hosted / tunnelled FLUX.1 Kontext NIM, e.g. http://gpu-box:8001/v1/infer */
  fluxInferenceUrl: () => str("FLUX_INFERENCE_URL"),
  /** Hosted Kontext endpoint (only used when NVIDIA_API_KEY is set). */
  nvidiaHostedImageUrl: () => str("NVIDIA_IMAGE_EDIT_URL", NVIDIA_HOSTED_KONTEXT_URL),
  /** Set to "false" to skip the hosted Kontext endpoint entirely. */
  nvidiaHostedImageEnabled: () => str("NVIDIA_HOSTED_IMAGE", "true") !== "false",
  /** Cosmos video NIM (self-hosted, tunnelled or an NVCF-hosted invoke URL). */
  cosmosInferenceUrl: () => str("COSMOS_INFERENCE_URL"),
  /** Optional JSON merged into the Cosmos request body for model-specific params. */
  cosmosExtraParams: (): Record<string, unknown> => {
    const raw = str("COSMOS_EXTRA_PARAMS");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      console.warn("[CONFIG] COSMOS_EXTRA_PARAMS is not valid JSON — ignored");
      return {};
    }
  },
};

/** Masks a secret for logs: first 6 chars + length. Never log full keys. */
export function maskSecret(value: string): string {
  return value ? `${value.slice(0, 6)}… (${value.length} chars)` : "ABSENT";
}
