import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSoccerArticles } from "@/lib/soccer/articles";
import { kstDate } from "@/lib/soccer/predictions";

/**
 * Soccer match reports — one per team, the day after each of its matches.
 * Triggered by Vercel Cron (web/vercel.json) AFTER /api/cron/soccer-daily has
 * ingested results and refreshed predictions + the season sim.
 *
 * Scheduled twice: a heavy matchday can mean ~100 reports (one LLM call each),
 * more than one 300 s invocation; work stops at a time budget and the second run
 * picks up whatever is still due (lib/soccer/articles.ts is idempotent).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (cron or manual). `?leagues=epl,…`
 * scopes a manual run.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const leagues = params.get("leagues")?.split(",").map((s) => s.trim()).filter(Boolean);
  const now = new Date();
  try {
    const results = await generateSoccerArticles(createAdminClient(), {
      leagues,
      now,
      budgetMs: 240_000,
      runId: `soccer-articles-${kstDate(now)}`,
    });
    return NextResponse.json({ ok: true, date: kstDate(now), results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[soccer-articles] failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
