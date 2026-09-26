import { Request, Response, NextFunction } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let clientKey = "";

function supabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!client || clientKey !== `${url}|${anonKey}`) {
    client = createClient(url, anonKey, { auth: { persistSession: false } });
    clientKey = `${url}|${anonKey}`;
  }
  return client;
}

/**
 * Authenticates API requests with the user's Supabase session token
 * (`Authorization: Bearer <access_token>`) and attaches `req.user`.
 *
 * `MCP_TEST_MODE=true` bypasses auth for local development and automated
 * tests — never enable it in production.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    if (process.env.MCP_TEST_MODE === "true") {
      (req as any).user = { id: "test-user", email: "test@stonesight.ai" };
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized: No token provided" });
    }

    // Accept VITE_-prefixed keys so a single root .env serves both apps.
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[AUTH] Supabase configuration missing: set SUPABASE_URL and SUPABASE_ANON_KEY in .env");
      return res.status(500).json({ success: false, code: "AUTH_CONFIG", error: "Internal server configuration error" });
    }

    const {
      data: { user },
      error,
    } = await supabaseClient(supabaseUrl, supabaseAnonKey).auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized: Invalid or expired token" });
    }

    (req as any).user = { id: user.id, email: user.email || "" };
    return next();
  } catch (error) {
    console.error("[AUTH] middleware error:", error);
    return res.status(500).json({
      success: false,
      code: "AUTH_ERROR",
      error: "Internal server error during authentication",
    });
  }
}
