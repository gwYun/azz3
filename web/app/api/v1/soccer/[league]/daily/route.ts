import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLeague, LEAGUE_CODES } from "@/lib/soccer/leagues";
import { envelope, parseLimit, parseDateRange } from "@/lib/api-v1/serialize";

/**
 * Soccer daily digest — the card-news generator's source for the leagues that
 * have DATA but no generated articles yet. Everything here is composed from the
 * public soccer_* tables (results, table, leaders), shaped so Claude can write
 * scoreline / standings / top-scorer cards without touching Naver directly.
 *
 *   GET /api/v1/soccer/epl/daily
 *   GET /api/v1/soccer/epl/daily?date=2026-09-27&limit=8
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamMeta = { name: string | null; short_name: string | null; emblem_url: string | null };

export async function GET(
  request: Request,
  { params }: { params: { league: string } },
) {
  const auth = await authenticateRequest(request, "reports:read");
  if (!auth.ok) return auth.response;

  const league = params.league;
  const def = getLeague(league);
  if (!def) {
    return NextResponse.json(
      { error: "invalid_league", detail: `league must be one of: ${LEAGUE_CODES.join(", ")}` },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const range = parseDateRange(url.searchParams);
  if (!range.ok) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }
  const { from: gte, to: lte } = range.range;
  const limit = parseLimit(url.searchParams.get("limit"), 10, 50);
  const admin = createAdminClient();

  try {
    // Resolve the current season from the most recent game we've ingested.
    const { data: latest } = await admin
      .from("soccer_games")
      .select("season")
      .eq("league", league)
      .order("game_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const season = (latest as { season?: number } | null)?.season;
    if (!season) {
      return NextResponse.json(
        envelope(
          { league, results: [], upcoming: [], standings: [], scorers: [], assisters: [] },
          { league_ko: def.ko, league_en: def.en, note: "no data ingested yet" },
        ),
      );
    }

    // Team name lookup for standings (games already denormalize home/away names).
    const { data: teamRows } = await admin
      .from("soccer_teams")
      .select("team_code, name, short_name, emblem_url")
      .eq("league", league);
    const teams = new Map<string, TeamMeta>(
      (teamRows ?? []).map((t: { team_code: string } & TeamMeta) => [
        t.team_code,
        { name: t.name, short_name: t.short_name, emblem_url: t.emblem_url },
      ]),
    );
    const teamName = (code: string) =>
      teams.get(code)?.short_name ?? teams.get(code)?.name ?? code;

    // Finished results — within [from, to] if given, else the most recent `limit`.
    let resultsQuery = admin
      .from("soccer_games")
      .select("game_id, game_date, status, round, home_name, away_name, home_score, away_score, winner")
      .eq("league", league)
      .eq("season", season)
      .eq("status", "RESULT");
    if (gte) resultsQuery = resultsQuery.gte("game_date", gte);
    if (lte) resultsQuery = resultsQuery.lte("game_date", lte);
    const { data: resultRows } = await resultsQuery
      .order("game_date", { ascending: false })
      .limit(limit);

    // Next fixtures — scoped to the range when one is given, else the soonest N.
    let upcomingQuery = admin
      .from("soccer_games")
      .select("game_id, game_date, kickoff, round, home_name, away_name")
      .eq("league", league)
      .eq("season", season)
      .eq("status", "BEFORE");
    if (gte) upcomingQuery = upcomingQuery.gte("game_date", gte);
    if (lte) upcomingQuery = upcomingQuery.lte("game_date", lte);
    const { data: upcomingRows } = await upcomingQuery
      .order("game_date", { ascending: true })
      .limit(limit);

    // Full standings table.
    const { data: standingRows } = await admin
      .from("soccer_standings")
      .select("team_code, rank, matches, wins, draws, losses, points, goals_for, goals_against, goal_diff, last_five")
      .eq("league", league)
      .eq("season", season)
      .order("rank", { ascending: true });

    // Leaders.
    const { data: scorerRows } = await admin
      .from("soccer_player_stats")
      .select("player_name, team_code, goals, assists, matches")
      .eq("league", league)
      .eq("season", season)
      .order("goals", { ascending: false })
      .limit(10);
    const { data: assistRows } = await admin
      .from("soccer_player_stats")
      .select("player_name, team_code, assists, goals, matches")
      .eq("league", league)
      .eq("season", season)
      .order("assists", { ascending: false })
      .limit(10);

    const results = (resultRows ?? []).map((g: Record<string, unknown>) => ({
      date: g.game_date,
      round: g.round,
      home: g.home_name,
      away: g.away_name,
      score: `${g.home_score ?? "-"}-${g.away_score ?? "-"}`,
      home_score: g.home_score,
      away_score: g.away_score,
      winner: g.winner,
    }));

    const upcoming = (upcomingRows ?? []).map((g: Record<string, unknown>) => ({
      date: g.game_date,
      kickoff: g.kickoff,
      round: g.round,
      home: g.home_name,
      away: g.away_name,
    }));

    const standings = (standingRows ?? []).map((s: Record<string, unknown>) => ({
      rank: s.rank,
      team: teamName(s.team_code as string),
      played: s.matches,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      points: s.points,
      goals_for: s.goals_for,
      goals_against: s.goals_against,
      goal_diff: s.goal_diff,
      form: s.last_five,
    }));

    const scorers = (scorerRows ?? []).map((p: Record<string, unknown>) => ({
      player: p.player_name,
      team: teamName(p.team_code as string),
      goals: p.goals,
      assists: p.assists,
      matches: p.matches,
    }));

    const assisters = (assistRows ?? []).map((p: Record<string, unknown>) => ({
      player: p.player_name,
      team: teamName(p.team_code as string),
      assists: p.assists,
      goals: p.goals,
      matches: p.matches,
    }));

    return NextResponse.json(
      envelope(
        { league, results, upcoming, standings, scorers, assisters },
        {
          league_ko: def.ko,
          league_en: def.en,
          country: def.country,
          season,
          ...(gte || lte ? { from: gte, to: lte } : {}),
        },
      ),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "server_error", detail: e instanceof Error ? e.message : "err" },
      { status: 500 },
    );
  }
}
