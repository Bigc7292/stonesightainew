/**
 * POST /api/analyze — Claude (or NVIDIA VLM) scene analysis.
 *
 * Body: { image: dataURL, swatch?: dataURL, stone: { name, category?, tone?, description? } }
 * 200:  { success: true, analysis: SceneAnalysis, analyzer, model }
 * 4xx/5xx: { success: false, code, error }
 */
import { Router, Request, Response } from "express";
import { analyzeScene, AnalyzerError } from "../lib/analyzers";
import { decodeImage } from "../lib/images";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { image, swatch, stone } = req.body ?? {};
  if (typeof image !== "string" || !image || !stone || typeof stone.name !== "string") {
    return res.status(400).json({
      success: false,
      code: "BAD_REQUEST",
      error: "Required: image (data URL) and stone.name",
    });
  }

  try {
    const result = await analyzeScene({
      photo: decodeImage(image).buffer,
      swatch: typeof swatch === "string" && swatch ? decodeImage(swatch).buffer : undefined,
      stone: {
        name: String(stone.name).slice(0, 120),
        category: typeof stone.category === "string" ? stone.category : undefined,
        tone: typeof stone.tone === "string" ? stone.tone : undefined,
        description: typeof stone.description === "string" ? stone.description.slice(0, 1200) : undefined,
      },
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AnalyzerError) {
      return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    }
    console.error("[ANALYZE] unexpected failure", error);
    return res.status(500).json({
      success: false,
      code: "ANALYZE_FAILED",
      error: error instanceof Error ? error.message : "Scene analysis failed",
    });
  }
});

export default router;
