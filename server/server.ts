/**
 * StoneSight AI backend entry point.
 *
 * AI providers are strictly Anthropic Claude (scene analysis) and NVIDIA NIM
 * (image editing, video, optional VLM analysis). The server starts even when
 * keys are missing and reports what is available at GET /api/health, so the
 * frontend can fall back to its local renderers.
 */
import "./lib/env";
import { config, maskSecret } from "./lib/env";
import { createApp } from "./app";
import { availableAnalyzers } from "./lib/analyzers";
import { imageEditProviders } from "./lib/imageEditor";

const analyzers = availableAnalyzers();
console.log("========================================");
console.log("[DIAGNOSTIC] Provider configuration", {
  ANTHROPIC_API_KEY: maskSecret(config.anthropicApiKey()),
  CLAUDE_MODEL: config.claudeModel(),
  NVIDIA_API_KEY: maskSecret(config.nvidiaApiKey()),
  FLUX_INFERENCE_URL: config.fluxInferenceUrl() || "unset",
  COSMOS_INFERENCE_URL: config.cosmosInferenceUrl() || "unset",
  analysis: analyzers.join(", ") || "NONE",
  imageEdit: imageEditProviders().join(", ") || "NONE (local Claude-guided renderer)",
  video: config.cosmosInferenceUrl() ? "nvidia-cosmos" : "NONE (browser-rendered walkthrough)",
  authBypass: config.testMode(),
});
if (analyzers.length === 0) {
  console.warn("[DIAGNOSTIC] No scene analyser configured — set ANTHROPIC_API_KEY (recommended) or NVIDIA_API_KEY.");
}
console.log("========================================");

const app = createApp();
const port = config.port();
app.listen(port, () => {
  console.log(`🚀 StoneSight AI server running on port ${port}`);
});

export default app;
