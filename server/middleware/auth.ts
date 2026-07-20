import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

/**
 * Middleware to authenticate requests using Supabase Auth
 * Verifies the Bearer token in the Authorization header
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (process.env.MCP_TEST_MODE === 'true') {
      (req as any).user = { id: 'test-user', email: 'test@stonesight.ai' };
      return next();
    }

    // Use VITE_ prefixed keys from .env if the standard ones aren't set
    const supabaseUrl =
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey =
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(
        "Supabase configuration missing: ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env",
      );
      return res
        .status(500)
        .json({ error: "Internal server configuration error" });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Get the Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Token malformed" });
    }

    // Verify the token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error("Supabase auth error:", error?.message);
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or expired token" });
    }

    // Attach user info to request for use in route handlers
    (req as any).user = {
      id: user.id,
      email: user.email || "",
    };

    // Correctly call next() and return to prevent further execution in this handler
    return next();
  } catch (error) {
    console.error("Authentication middleware error:", error);
    return res.status(500).json({
      error: "Internal server error during authentication",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
