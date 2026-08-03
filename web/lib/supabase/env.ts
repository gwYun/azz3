/**
 * Browser-safe Supabase credentials, resolved once and shared by the server +
 * client factories.
 *
 * Prefers the new publishable key (`sb_publishable_…`); falls back to the
 * legacy `anon` key so a project that hasn't minted publishable keys yet still
 * works. Both are browser-safe. Supabase deprecates the legacy JWT keys at the
 * end of 2026 — new projects should set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/** True once the Supabase env is present. Lets the UI hide login pre-config. */
export const isSupabaseConfigured =
  Boolean(SUPABASE_URL) && Boolean(SUPABASE_PUBLISHABLE_KEY);
