import dotenv from 'dotenv';
import path from 'path';

// 1. LOAD ENVIRONMENT VARIABLES ABSOLUTELY FIRST BEFORE ANY ROUTE IMPORTS
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

import express from 'express';
import cors from 'cors';
import imageRoutes from './routes/image';
import videoRoutes from './routes/video';
import threeDRoutes from './routes/3d';
import threeDFreeRoutes from './routes/3d-free';
import { authenticate } from './middleware/auth';

// 2. DIAGNOSTIC VERIFICATION
console.log("========================================");
console.log(`[DIAGNOSTIC] API Keys Check: ${JSON.stringify({ 
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY ? `${process.env.NVIDIA_API_KEY.substring(0, 8)}...` : 'ABSENT',
  TRIPO_API_KEY: process.env.TRIPO_API_KEY ? `${process.env.TRIPO_API_KEY.substring(0, 8)}...` : 'ABSENT',
  FAL_API_KEY: process.env.FAL_API_KEY ? `${process.env.FAL_API_KEY.substring(0, 8)}...` : 'ABSENT',
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

// DEBUG: Log the static files path
const publicPath = path.join(__dirname, '..', 'public');
console.log(`[DEBUG] Serving static files from: ${publicPath}`);
// REQUEST LOGGING FOR DEBUGGING
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});
// TEST ROUTE TO VERIFY FILE ACCESS
app.get('/test-file', (req, res) => {
  const filePath = path.join(publicPath, 'logo.jpg');
  console.log(`[TEST-FILE] Attempting to serve: ${filePath}`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.log(`[TEST-FILE] Error: ${err}`);
      res.status(500).send('Error serving file');
    } else {
      console.log(`[TEST-FILE] File sent successfully`);
    }
  });
});
// STATIC FILE MIDDLEWARE WITH DEBUGGING
app.use((req, res, next) => {
  if (req.method === 'GET' && req.url.startsWith('/') && !req.url.startsWith('/api/') && !req.url.startsWith('/videos/') && !req.url.startsWith('/images/') && !req.url.startsWith('/test-file')) {
    const potentialFilePath = path.join(publicPath, req.url.substring(1));
    console.log(`[STATIC-DEBUG] Checking for file: ${potentialFilePath}`);
    const fs = require('fs');
    fs.access(potentialFilePath, fs.constants.F_OK, (err) => {
      if (!err) {
        console.log(`[STATIC-DEBUG] File FOUND, serving via express.static`);
      } else {
        console.log(`[STATIC-DEBUG] File NOT found: ${err}`);
      }
      next();
    });
  } else {
    next();
  }
});
// SERVE STATIC FILES FROM PUBLIC DIRECTORY
app.use(express.static(publicPath));

// SERVE GENERATED VIDEOS AND IMAGES FROM PUBLIC STATIC DIRECTORY
app.use('/videos', express.static(path.join(__dirname, '..', 'public', 'videos')));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

// REQUEST CONTEXT ENHANCEMENT
app.use((req: any, res, next) => {
  req.meta = {
    requestOrigin: req.headers.origin || 'localhost',
    envVersion: process.env.NODE_ENV,
    timestamp: Date.now()
  };
  next();
});

// ROUTING GATING
app.use('/api/video', authenticate, videoRoutes);
app.use('/api/image', authenticate, imageRoutes);
app.use('/api/3d', authenticate, threeDRoutes);
app.use('/api/3d-free', authenticate, threeDFreeRoutes);

// BIND AND LISTEN TO PORT
app.listen(PORT, () => {
  console.log(`🚀 Stone Sight AI Server actively running on port ${PORT}`);
});

export default app;