import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyIngest } from "@/lib/soccer/ingest";
import { runDailyPredictions } from "@/lib/soccer/predictions";
import { LEAGUE_CODES } from "@/lib/soccer/leagues";

/**
 * Nightly soccer refresh — triggered by Vercel Cron (see web/vercel.json).
 * Sibling of /api/cron/kbo-daily.
 *
 * Pulls robots-clean Naver Sports football feeds (games, standings, player
 * stats) for the major leagues and writes them to Supabase so the site updates
 * without a redeploy.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations;
 * the same header works for a manual trigger (curl with the secret). Query
 * params `?leagues=epl,primera`, `?withPlayers=0` and `?predict=0` scope a
 * manual run. After ingest it refits the match model, freezes pre-kickoff
 * predictions, and refreshes the season sim (lib/soccer/predictions.ts); the
 * match reports run separately in /api/cron/soccer-articles.
 *
 * Node runtime + long budget: fetching 7 leagues' full schedules + paginated
 * player feeds takes a while. maxDuration is honored on Fluid-compute plans.
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
  const trigger = params.get("trigger") ?? "cron";
  const leagues = params.get("leagues")?.split(",").map((s) => s.trim()).filter(Boolean);
  const withPlayers = params.get("withPlayers") !== "0";
  const admin = createAdminClient();

  const { data: run } = await admin
    .from("soccer_ingest_runs")
    .insert({ trigger, status: "running", leagues: leagues ?? LEAGUE_CODES })
    .select("id")
    .single();
  const runId = run?.id ?? null;

  try {
    const result = await runDailyIngest(admin, { leagues, trigger, withPlayers });

    // Predictions + season sim from the fresh results. Best-effort: a model
    // failure is logged in the run detail but never fails the ingest itself.
    let predictions: Awaited<ReturnType<typeof runDailyPredictions>> | null = null;
    let predictionsError: string | null = null;
    if (params.get("predict") !== "0") {
      try {
        predictions = await runDailyPredictions(admin, { leagues });
      } catch (e) {
        predictionsError = e instanceof Error ? e.message : "unknown";
        console.error("[soccer-daily] predictions failed:", e);
      }
    }
    result.detail = { ...result.detail, predictions, predictionsError };

    if (runId != null) {
      await admin
        .from("soccer_ingest_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          season: result.season,
          leagues: result.leagues,
          games_upserted: result.gamesUpserted,
          standings_upserted: result.standingsUpserted,
          players_upserted: result.playersUpserted,
          detail: result.detail,
        })
        .eq("id", runId);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (runId != null) {
      await admin
        .from("soccer_ingest_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), error: message })
        .eq("id", runId);
    }
    console.error("[soccer-daily] ingest failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
