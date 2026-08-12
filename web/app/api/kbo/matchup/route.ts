import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import staticMatchup from "@/public/kbo-matchup.json";

/**
 * Matchup engine ingredients for the /matchup page. Serves the LIVE box-score-built
 * rosters (kbo_sim_snapshots kind='matchup', written by /api/cron/kbo-daily) — a
 * self-contained MatchupData payload, so no merge is needed. Falls back to the
 * static kbo-matchup.json whenever Supabase is unconfigured, empty, or errors.
 */
export const revalidate = 1800;

const SEASON = 2026;
type Any = Record<string, unknown>;

export async function GET() {
  const base = staticMatchup as unknown as Any;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("kbo_sim_snapshots")
      .select("payload")
      .eq("season", SEASON)
      .eq("kind", "matchup")
      .maybeSingle();

    const live = data?.payload as Any | undefined;
    if (error || !live || !Array.isArray(live.teams) || live.teams.length < 2) {
      return NextResponse.json(base, { headers: { "x-kbo-source": "static-fallback" } });
    }
    return NextResponse.json(live, { headers: { "x-kbo-source": "live" } });
  } catch {
    return NextResponse.json(base, { headers: { "x-kbo-source": "static-fallback" } });
  }
}
