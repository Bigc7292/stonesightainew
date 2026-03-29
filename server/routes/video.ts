import { Router, Request, Response } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { generateVideo } from '../utils/genai';

const router = Router();

/**
 * @route POST /api/video/generate
 * @description Generate a video using Google Veo
 * @access Private
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, image } = req.body;
    
    if (!prompt || !image) {
      return res.status(400).json({ 
        error: 'Missing required fields: prompt and image' 
      });
    }

    // Extract base64 data (remove data:image/png;base64, prefix if present)
    const imageBase64 = image.split(',')[1] || image;
    
    // Generate video using the server-side GenAI instance
    const videoUrl = await generateVideo(
      (req as any).genAI,
      prompt,
      imageBase64
    );
    
    res.status(200).json({
      success: true,
      video: videoUrl
    });
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate video',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
  
  // This line should never be reached, but added to satisfy TypeScript
  return res.status(500).json({ error: 'Internal server error' });
});

export default router;