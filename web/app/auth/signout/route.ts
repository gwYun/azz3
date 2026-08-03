import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST-only signout. POST (not GET) is deliberate CSRF hardening: a GET
 * endpoint could be triggered by an <img>/prefetch and log users out silently.
 * Next.js returns 405 automatically for unexported methods (GET/PUT/…).
 *
 * Redirects with 303 so the browser issues a GET on the target after the POST.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
