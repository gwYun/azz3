import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fitAll, ingestRecent, loadMatches, writePredictions } from "@/lib/lol/pipeline";
import { generateLolArticle } from "@/lib/lol/articles";
import { kstDate } from "@/lib/soccer/predictions";

/**
 * LoL Worlds — ingest → refit → re-predict upcoming series → match-day report.
 *
 * Worlds runs in North America, so a match day is ~02:00–11:00 KST. One run
 * a day at 13:00 KST (web/vercel.json): by then the day's last series is final,
 * so the report goes out the same afternoon and the next day's predictions are
 * written before its 02:00 start. Pairings drawn after 13:00 are picked up by
 * the next day's run (a day with TBD pairings previews only what is known).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. `?force=1` regenerates the report.
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
  const force = new URL(request.url).searchParams.get("force") === "1";
  const now = new Date();
  const admin = createAdminClient();
  try {
    const ingested = await ingestRecent(admin, now);
    const rows = await loadMatches(admin);
    const fit = fitAll(rows, now.getTime());
    const predicted = await writePredictions(admin, rows, fit, now);
    const report = await generateLolArticle(admin, rows, fit, { now, force, runId: `lol-worlds-${now.toISOString()}` });
    return NextResponse.json({ ok: true, date: kstDate(now), ingested, predicted, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lol-worlds] failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
