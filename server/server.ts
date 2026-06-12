import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import imageRoutes from "./routes/image";
import videoRoutes from "./routes/video";
import { authenticate } from "./middleware/auth";

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// DIAGNOSTIC
console.log("========================================");
console.log("[Diagnostic] NEW_VEO_KEY:", process.env.NEW_VEO_KEY ? `YES (${process.env.NEW_VEO_KEY.substring(0, 5)}...)` : "NO");
console.log("[Diagnostic] GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? `YES (${process.env.GEMINI_API_KEY.substring(0, 5)}...)` : "NO");
console.log("========================================");

const API_KEY = process.env.NEW_VEO_KEY || process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("CRITICAL: No API key found in .env!");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  process.env.APP_URL, // This will be https://stonesightai.xyz in production
].filter((origin): origin is string => !!origin);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve generated videos statically
app.use("/videos", express.static(path.join(__dirname, "public", "videos")));

// Initialize Google GenAI (server-side only)
const genAI = new GoogleGenAI({ apiKey: API_KEY! });

// Attach genAI instance to request for route handlers
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as any).genAI = genAI;
  next();
});

// Routes
app.use("/api/image", authenticate, imageRoutes);
app.use("/api/video", authenticate, videoRoutes);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler
app.use("*", (req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
