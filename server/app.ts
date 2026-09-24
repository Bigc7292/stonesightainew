/**
 * Express application factory (no `listen`, so tests can mount it directly).
 *
 * Routes
 *   GET  /api/health                → provider capability report (public)
 *   POST /api/analyze               → Claude / NVIDIA VLM scene analysis   (auth)
 *   POST /api/image/generate        → NVIDIA FLUX.1 Kontext stone edit     (auth)
 *   POST /api/video/generate        → NVIDIA Cosmos walkthrough job        (auth)
 *   GET  /api/video/status/:jobId   → job status                           (auth)
 *   GET  /images/*, /videos/*       → generated assets
 */
import "./lib/env";
import express from "express";
import cors from "cors";
import path from "path";
import { authenticate } from "./middleware/auth";
import { config } from "./lib/env";
import { PUBLIC_DIR } from "./lib/images";
import analyzeRoutes from "./routes/analyze";
import imageRoutes from "./routes/image";
import videoRoutes from "./routes/video";
import healthRoutes from "./routes/health";

export function createApp() {
  const app = express();

  const allowed = config.clientUrl();
  app.use(cors(allowed ? { origin: allowed.split(",").map((s) => s.trim()) } : undefined));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // Photos arrive as data URLs; 25 MB comfortably covers a 12 MP JPEG + swatch.
  app.use(express.json({ limit: "25mb" }));

  app.use((req, _res, next) => {
    if (req.path.startsWith("/api/")) console.log(`[REQUEST] ${req.method} ${req.path}`);
    next();
  });

  app.use("/images", express.static(path.join(PUBLIC_DIR, "images")));
  app.use("/videos", express.static(path.join(PUBLIC_DIR, "videos")));

  app.use("/api/health", healthRoutes);
  app.use("/api/analyze", authenticate, analyzeRoutes);
  app.use("/api/image", authenticate, imageRoutes);
  app.use("/api/video", authenticate, videoRoutes);

  app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ success: false, code: "PAYLOAD_TOO_LARGE", error: "Image is too large" });
    }
    console.error("[SERVER] unhandled error", err);
    return res.status(500).json({ success: false, code: "INTERNAL", error: "Internal server error" });
  });

  return app;
}
