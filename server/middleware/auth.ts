import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { ParamsDictionary } from 'express-serve-static-core';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    // Initialize Supabase client for auth verification (inside function to ensure env vars are loaded)
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Get the Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    
    // Attach user info to request for use in route handlers
    (req as any).user = {
      id: user.id,
      email: user.email || '',
      // You could fetch additional user metadata here if needed
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
  
  // This line should never be reached, but added to satisfy TypeScript
  return res.status(500).json({ error: 'Internal server error' });
}