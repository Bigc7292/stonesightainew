import dotenv from 'dotenv';
import path from 'path';

// 1. LOAD ENVIRONMENT VARIABLES ABSOLUTELY FIRST BEFORE ANY ROUTE IMPORTS
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import express from 'express';
import cors from 'cors';
import imageRoutes from './routes/image';
import videoRoutes from './routes/video';
import { authenticate } from './middleware/auth';

// 2. DIAGNOSTIC VERIFICATION
console.log("========================================");
console.log(`[DIAGNOSTIC] API Keys Check: ${JSON.stringify({ 
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY ? `${process.env.NVIDIA_API_KEY.substring(0, 8)}...` : 'ABSENT'
})}`);
console.log("========================================");

// 3. CORE SERVICES INITIALIZATION
const API_KEY = process.env.NVIDIA_API_KEY || process.env.NEW_VEO_KEY;

if (!API_KEY) {
  console.error("CRITICAL FAILURE: NVIDIA_API_KEY missing in environment (.env)");
  process.exit(1);
}

// SERVER INFRASTRUCTURE
const app = express();
const PORT = process.env.PORT || 5000;

// CROSS-ORIGIN RESOURCE SHARING
app.use(cors());

// SECURITY HEADERS
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://googlesvc.eduvention-videos.io"
  );
  next();
});

// OPTIMIZED MIDDLEWARE CHAIN
app.use(express.json({ 
  limit: '100MB',
  strict: true 
}));
app.use(express.urlencoded({ 
  extended: true,
  limit: '100MB',
  parameterLimit: 100000 
}));

// SERVE GENERATED VIDEOS FROM PUBLIC STATIC DIRECTORY
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos')));

// REQUEST CONTEXT ENHANCEMENT
app.use((req: any, res, next) => {
  req.metadata = {
    requestOrigin: req.headers.origin || 'localhost',
    envVersion: process.env.NODE_ENV,
    timestamp: Date.now()
  };
  next();
});

// ROUTING GATING
app.use('/api/video', authenticate, videoRoutes);
app.use('/api/image', authenticate, imageRoutes);

// BIND AND LISTEN TO PORT
app.listen(PORT, () => {
  console.log(`🚀 Stone Sight AI Server actively running on port ${PORT}`);
});

export default app;