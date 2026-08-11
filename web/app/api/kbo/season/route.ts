import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import staticSeason from "@/public/kbo.json";

/**
 * Season forecast for the KBO page. Serves the LIVE daily sim (kbo_sim_snapshots,
 * written by /api/cron/kbo-daily) overlaid on the static kbo.json's salary +
 * backtest context, which the lean live pipeline doesn't regenerate. Falls back
 * to the static file whenever Supabase is unconfigured, empty, or errors — so the
 * page never breaks.
 *
 * Cached for 30 min (the cron refreshes ~daily); `x-kbo-source` says which won.
 */
export const revalidate = 1800;

const SEASON = 2026;

// Loose views over the JSON payloads (shapes are validated by the pages, not here).
type Any = Record<string, unknown>;

export async function GET() {
  const base = staticSeason as unknown as Any;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("kbo_sim_snapshots")
      .select("payload")
      .eq("season", SEASON)
      .eq("kind", "season")
      .maybeSingle();

    const live = data?.payload as Any | undefined;
    if (error || !live || !Array.isArray(live.teams) || live.teams.length === 0) {
      return NextResponse.json(base, { headers: { "x-kbo-source": "static-fallback" } });
    }

    // Carry salary/payroll from the static file (matched by team ko / player name).
    const staticTeam = new Map((base.teams as Any[]).map((t) => [t.ko, t]));
    const staticPlayer = new Map((base.players as Any[]).map((p) => [p.name, p]));

    const teams = (live.teams as Any[]).map((t) => ({
      ...t,
      payroll_ok: (staticTeam.get(t.ko as string)?.payroll_ok as number) ?? null,
    }));
    const players = (live.players as Any[]).map((p) => {
      const s = staticPlayer.get(p.name as string);
      return {
        ...p,
        salary_ok: (s?.salary_ok as number) ?? null,
        real_salary_ok: (s?.real_salary_ok as number) ?? null,
      };
    });

    const merged = {
      ...base, // backtest, seed, params, salary_diagnostics, caveat, method fallbacks
      season: live.season,
      n_sims: live.n_sims,
      run_id: live.run_id,
      generated_at: live.generated_at,
      version: live.version,
      source: live.source ?? "naver-live",
      method: live.method ?? base.method,
      title_pick: live.title_pick ?? base.title_pick,
      teams,
      players,
      live: true,
    };
    return NextResponse.json(merged, { headers: { "x-kbo-source": "live" } });
  } catch {
    return NextResponse.json(base, { headers: { "x-kbo-source": "static-fallback" } });
  }
}
