import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyIngest, CURRENT_SEASON } from "@/lib/kbo/ingest";
import { generateDailyArticles } from "@/lib/kbo/articles";

/**
 * Nightly KBO refresh — triggered by Vercel Cron (see web/vercel.json).
 *
 * Pulls robots-clean Naver stats, recomputes the in-house sabermetrics, reruns
 * the season sim, and writes everything to Supabase so the site updates without
 * a redeploy.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations.
 * We reject anything without it, so the endpoint can't be run by the public.
 * The same header works for a manual trigger (curl with the secret) during dev.
 *
 * Runs on the Node runtime (supabase-js + the sim need it) and asks for a long
 * budget — the fetch + Monte-Carlo can take a couple of minutes. maxDuration is
 * honored on plans with Fluid compute; Hobby caps lower, in which case run the
 * sim less often or move it offline.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: no secret configured means nobody is authorized.
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const trigger =
    new URL(request.url).searchParams.get("trigger") ?? "cron";
  const admin = createAdminClient();

  // Open a run-log row so a failed/slow run is visible in kbo_ingest_runs.
  const { data: run } = await admin
    .from("kbo_ingest_runs")
    .insert({ season: CURRENT_SEASON, trigger, status: "running" })
    .select("id")
    .single();
  const runId = run?.id ?? null;

  try {
    const result = await runDailyIngest(admin, { trigger });

    // Daily team articles — from the fresh snapshot the ingest just wrote. Best
    // effort: a failure here is logged into the run detail but never fails the
    // data refresh above (the site still updates even if prose generation breaks).
    let articles: Awaited<ReturnType<typeof generateDailyArticles>> | null = null;
    let articlesError: string | null = null;
    try {
      articles = await generateDailyArticles(admin, CURRENT_SEASON, {
        runId: new Date().toISOString(),
      });
    } catch (e) {
      articlesError = e instanceof Error ? e.message : "unknown";
      console.error("[kbo-daily] article generation failed:", e);
    }

    if (runId != null) {
      await admin
        .from("kbo_ingest_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          games_upserted: result.gamesUpserted,
          hitters_upserted: result.hittersUpserted,
          pitchers_upserted: result.pitchersUpserted,
          detail: {
            ...result.detail,
            articlesUpserted: articles?.articlesUpserted ?? 0,
            articleModels: articles?.models ?? null,
            articlesError,
          },
        })
        .eq("id", runId);
    }

    return NextResponse.json({ ok: true, ...result, articles, articlesError });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (runId != null) {
      await admin
        .from("kbo_ingest_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error: message,
        })
        .eq("id", runId);
    }
    // Log full detail server-side; return a terse message to the caller.
    console.error("[kbo-daily] ingest failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
