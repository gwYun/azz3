import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Server-only admin client using the Supabase Secret key (sb_secret_…, formerly
 * service_role). BYPASSES Row Level Security — use ONLY in server routes for
 * order / payment / entitlement writes. Never import this in client code, and
 * never expose SUPABASE_SECRET_KEY as a NEXT_PUBLIC_ var.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set (server-only)");
  }
  return createClient(SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
