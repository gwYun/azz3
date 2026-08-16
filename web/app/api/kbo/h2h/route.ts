import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRANCHISES } from "@/lib/kbo/franchise";

/**
 * Actual head-to-head results between two teams this season — the /matchup page
 * shows these real games (with real scores) alongside its prediction, so games
 * that already happened read as fact, not forecast. Reads kbo_games (public).
 */
export const dynamic = "force-dynamic";

const SEASON = 2026;
const ok = (c: string | null): c is string => !!c && (FRANCHISES as readonly string[]).includes(c);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const a = searchParams.get("a");
  const b = searchParams.get("b");
  // Validate against the franchise allowlist (also blocks PostgREST filter injection).
  if (!ok(a) || !ok(b) || a === b) {
    return NextResponse.json({ error: "invalid teams" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("kbo_games")
      .select("game_id, game_date, home_team, away_team, home_score, away_score, winner, status")
      .eq("season", SEASON)
      .or(`and(home_team.eq.${a},away_team.eq.${b}),and(home_team.eq.${b},away_team.eq.${a})`)
      .order("game_date", { ascending: true });
    if (error) throw error;

    const games = (data ?? []).filter((g) => !!g.game_date);
    const isPlayed = (g: (typeof games)[number]) =>
      g.status === "RESULT" && g.home_score != null && g.away_score != null;
    // Record from team a's perspective (across both venues), over played games only.
    let aw = 0, bw = 0, tie = 0;
    for (const g of games) {
      if (!isPlayed(g)) continue;
      const aHome = g.home_team === a;
      const as = (aHome ? g.home_score : g.away_score) as number;
      const bs = (aHome ? g.away_score : g.home_score) as number;
      if (as > bs) aw++; else if (bs > as) bw++; else tie++;
    }

    return NextResponse.json(
      { a, b, record: { a: aw, b: bw, tie }, played: aw + bw + tie, games },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (e) {
    // Degrade quietly — the page just hides the section.
    return NextResponse.json({ a, b, record: null, played: 0, games: [], error: e instanceof Error ? e.message : "err" });
  }
}
