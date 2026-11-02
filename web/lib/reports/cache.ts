import { NextResponse } from "next/server";

/**
 * JSON response for the public report LIST routes, cached at the Vercel CDN.
 *
 * `export const revalidate` does nothing for these handlers: they read
 * `request.url` (query params), which makes Next treat them as dynamic, so every
 * request used to run the function + hit Supabase. An explicit s-maxage makes the
 * CDN cache each URL (query string included) instead. Counts (views/replies) may
 * trail by up to `S_MAXAGE`; stale copies are served while refreshing in the
 * background. Error payloads are never cached.
 */
const S_MAXAGE = 120;
const SWR = 3600;

export function publicListJson(body: unknown, ok = true) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": ok
        ? `public, s-maxage=${S_MAXAGE}, stale-while-revalidate=${SWR}`
        : "no-store",
    },
  });
}
