import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./env";

/**
 * Server-side Supabase client (Route Handlers / Server Components).
 *
 * Phase 1 uses this in exactly two places:
 *   - app/auth/callback/route.ts — exchange the OAuth code, which SETS the
 *     session cookies via setAll.
 *   - app/auth/signout/route.ts  — clear the session.
 *
 * There is intentionally no middleware in Phase 1 (no server-side session
 * reads yet). See docs/kakao-auth-payment-plan.md §5.
 */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a context without a mutable cookie store (e.g. a
          // Server Component). Safe to ignore — only route handlers write.
        }
      },
    },
  });
}
