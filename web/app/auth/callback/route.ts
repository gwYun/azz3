import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Supabase redirects the browser here after Kakao auth with
 * one of three shapes — all three end on a redirect, never a crash:
 *
 *   ?code=…      success  → exchange for a session, then go to `next` (or /)
 *   ?error=…     canceled → user declined consent / provider error
 *   (neither)    malformed→ safe fallback
 *
 * The `?auth=` notice on the fallback redirects is surfaced as a toast by
 * components/AuthNotice.tsx.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const next = safeNext(searchParams.get("next"));

  // User declined consent on the Kakao dialog, or the provider errored.
  if (error) {
    return NextResponse.redirect(`${origin}/?auth=canceled`);
  }

  // No code and no error — malformed callback. Don't touch the exchange.
  if (!code) {
    return NextResponse.redirect(`${origin}/?auth=error`);
  }

  const supabase = createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // Expired or forged code — land home with a notice instead of a 500.
    return NextResponse.redirect(`${origin}/?auth=error`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/**
 * Only allow same-origin path redirects (a single leading slash). Blocks
 * open-redirects via a crafted `?next=//evil.com` or `?next=https://…`.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
