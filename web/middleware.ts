import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

/**
 * Refreshes the Supabase session cookie so server routes (the payment flow)
 * read a fresh session. Reintroduced in Phase 2 — Phase 1 had no server-side
 * session consumer so it was intentionally omitted.
 *
 * The matcher below excludes the auth-free hot paths (/api/predict = Python
 * inference, /api/fx = FX rate) and static assets, so this never adds latency
 * there. It DOES run on /api/pay/* and pages, which need a live session.
 */
export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Revalidates + refreshes the token. No redirects/gating here.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything EXCEPT static assets, image files, and the auth-free API
    // hot paths (/api/predict, /api/fx).
    "/((?!_next/static|_next/image|favicon.ico|api/predict|api/fx|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
