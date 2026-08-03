import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./env";

export { isSupabaseConfigured } from "./env";

/**
 * Browser Supabase client (Client Components).
 *
 * Manages its own session in cookies and auto-refreshes the access token while
 * a page is open, so Phase 1 needs no session-refresh middleware. Used by
 * components/AuthButton.tsx to read the session and start the OAuth flow.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
