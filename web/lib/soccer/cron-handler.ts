/**
 * Shared handler for the soccer daily cron routes (/api/cron/soccer-daily and
 * /api/cron/soccer-daily/[group]); see the route docs for the pipeline.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyIngest } from "@/lib/soccer/ingest";
import { runDailyPredictions } from "@/lib/soccer/predictions";
import { LEAGUE_CODES } from "@/lib/soccer/leagues";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleSoccerDaily(request: Request, leaguesOverride?: string[]) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const trigger = params.get("trigger") ?? "cron";
  const leagues = leaguesOverride ?? params.get("leagues")?.split(",").map((s) => s.trim()).filter(Boolean);
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
