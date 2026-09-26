/**
 * GET /api/health — public capability report (never exposes secrets).
 * The frontend uses it to decide which pipelines to run and what to tell the
 * user (e.g. "video will be rendered in your browser").
 */
import { Router } from "express";
import { config } from "../lib/env";
import { availableAnalyzers } from "../lib/analyzers";
import { imageEditProviders } from "../lib/imageEditor";

const router = Router();

router.get("/", (_req, res) => {
  const analyzers = availableAnalyzers();
  res.json({
    ok: true,
    providers: {
      analysis: analyzers[0] ?? null,
      analysisModels: {
        claudeCode: analyzers.includes("claude-code") ? "claude-code-session" : null,
        claude: analyzers.includes("claude") ? config.claudeModel() : null,
        nvidiaVlm: analyzers.includes("nvidia-vlm") ? config.nvidiaVlmModels() : null,
      },
      image: imageEditProviders(),
      video: config.cosmosInferenceUrl() ? ["nvidia-cosmos"] : [],
    },
  });
});

export default router;
