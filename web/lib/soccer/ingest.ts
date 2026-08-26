/**
 * Soccer daily ingest — orchestrates the nightly refresh the Vercel cron
 * (/api/cron/soccer-daily) drives. Sibling of web/lib/kbo/ingest.ts.
 *
 * Pipeline (per league):
 *   1) resolve current season (seasonCode + window)
 *   2) fetch full-season games → upsert soccer_games (+ team registry)
 *   3) fetch standings → upsert soccer_standings (+ team registry)
 *   4) fetch players (paginated) → upsert soccer_player_stats
 *
 * Everything writes through the service-role admin client (RLS-bypassing); this
 * module never runs in the browser. Each league is independent: one league's
 * upstream failure is logged and skipped, it does not sink the others.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUES, LEAGUE_CODES, getLeague, type LeagueDef } from "./leagues";
import {
  resolveSeason,
  fetchSeasonGames,
  fetchStandings,
  fetchPlayers,
  type NaverGame,
  type NaverStandingRow,
  type NaverPlayerRow,
  type ResolvedSeason,
} from "./naver";

/** Coerce a possibly-missing numeric to a finite number or null. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}
/** Coerce to an integer or null. */
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
};

const nowIso = () => new Date().toISOString();

export interface LeagueResult {
  league: string;
  season: number;
  gamesUpserted: number;
  teamsUpserted: number;
  standingsUpserted: number;
  playersUpserted: number;
  error?: string;
}

export interface IngestResult {
  season: number;
  leagues: string[];
  gamesUpserted: number;
  standingsUpserted: number;
  playersUpserted: number;
  perLeague: LeagueResult[];
  detail: Record<string, unknown>;
}

// --------------------------------------------------------------------------- //
// Naver row → Supabase row mappers.                                           //
// --------------------------------------------------------------------------- //

export function mapGame(g: NaverGame, league: string, season: number) {
  if (!g.gameId || !g.homeTeamCode || !g.awayTeamCode) return null;
  const hs = int(g.homeTeamScore);
  const as = int(g.awayTeamScore);
  let winner = g.winner ?? null;
  if (!winner && g.statusCode === "RESULT" && hs != null && as != null) {
    winner = hs > as ? "HOME" : as > hs ? "AWAY" : null; // null = draw
  }
  return {
    game_id: g.gameId,
    league,
    season,
    game_date: g.gameDate,
    kickoff: g.gameDateTime ?? null,
    status: g.statusCode ?? "UNKNOWN",
    round: g.roundName ?? null,
    home_team: g.homeTeamCode,
    away_team: g.awayTeamCode,
    home_name: g.homeTeamName ?? null,
    away_name: g.awayTeamName ?? null,
    home_score: hs,
    away_score: as,
    winner,
    cancel: Boolean(g.cancel),
    suspended: Boolean(g.suspended),
    updated_at: nowIso(),
  };
}

/** Team-registry rows harvested from a games list (code → name + emblem). */
export function teamsFromGames(games: NaverGame[], league: string) {
  const by = new Map<string, Record<string, unknown>>();
  for (const g of games) {
    if (g.homeTeamCode && !by.has(g.homeTeamCode)) {
      by.set(g.homeTeamCode, {
        league, team_code: g.homeTeamCode, name: g.homeTeamName ?? null,
        short_name: g.homeTeamName ?? null, emblem_url: g.homeTeamEmblemUrl ?? null,
        updated_at: nowIso(),
      });
    }
    if (g.awayTeamCode && !by.has(g.awayTeamCode)) {
      by.set(g.awayTeamCode, {
        league, team_code: g.awayTeamCode, name: g.awayTeamName ?? null,
        short_name: g.awayTeamName ?? null, emblem_url: g.awayTeamEmblemUrl ?? null,
        updated_at: nowIso(),
      });
    }
  }
  return [...by.values()];
}

/** Richer team-registry rows from the standings feed (keyword + short name). */
export function teamFromStanding(t: NaverStandingRow, league: string) {
  if (!t.teamId) return null;
  return {
    league,
    team_code: t.teamId,
    name: t.teamName ?? null,
    short_name: t.teamShortName ?? null,
    keyword: t.keyword ?? null,
    emblem_url: t.teamEmblemUrl ?? null,
    updated_at: nowIso(),
  };
}

export function mapStanding(t: NaverStandingRow, league: string, season: number) {
  if (!t.teamId) return null;
  return {
    league,
    season,
    team_code: t.teamId,
    rank: int(t.rank),
    rank_status: t.rankStatus ?? null,
    matches: int(t.matchesPlayed),
    wins: int(t.wins),
    draws: int(t.draws),
    losses: int(t.losses),
    points: int(t.points),
    goals_for: int(t.goals),
    goals_against: int(t.goalsConceded),
    goal_diff: int(t.goalsDifference),
    xg: num(t.expectedGoals),
    xga: num(t.expectedGoalsConceded),
    possession: num(t.possession),
    shots: int(t.shots),
    shots_on_target: int(t.shotsOnTarget),
    passes: int(t.passes),
    pass_accuracy: num(t.passesAccuracy),
    corners: int(t.cornerKicks),
    fouls: int(t.fouls),
    yellow_cards: int(t.yellowCards),
    red_cards: int(t.redCards),
    clean_sheets: int(t.cleanSheets),
    last_five: t.lastFiveGames ?? null,
    naver_pred:
      t.rankPrediction || t.finalRankDistribution
        ? { rankPrediction: t.rankPrediction ?? null, finalRankDistribution: t.finalRankDistribution ?? null }
        : null,
    raw: t,
    updated_at: nowIso(),
  };
}

export function mapPlayer(p: NaverPlayerRow, league: string, season: number) {
  if (!p.playerId) return null;
  const passes = int(p.passes);
  const accurate = int(p.accuratePasses);
  const passAcc = passes && passes > 0 && accurate != null
    ? Number(((accurate / passes) * 100).toFixed(1))
    : null;
  return {
    league,
    season,
    player_id: p.playerId,
    player_name: p.playerName ?? null,
    short_name: p.shortName ?? null,
    team_code: p.teamId ?? null,
    position: p.position ?? null,
    back_number: p.backNumber != null ? String(p.backNumber) : null,
    country_id: p.countryId ?? null,
    matches: int(p.matchesPlayed),
    starts: int(p.matchesPlayedStarts),
    minutes: int(p.minsPlayed),
    goals: int(p.goals),
    assists: int(p.assists),
    xg: num(p.expectedGoals),
    xa: num(p.expectedAssists),
    shots: int(p.shots),
    shots_on_target: int(p.shotsOnTarget),
    key_passes: int(p.keyPasses),
    passes,
    pass_accuracy: passAcc,
    yellow_cards: int(p.yellowCards),
    red_cards: int(p.redCards),
    saves: int(p.saves),
    clean_sheets: int(p.cleanSheets),
    goals_conceded: int(p.goalsConceded),
    index_score: num(p.indexScore),
    raw: p,
    updated_at: nowIso(),
  };
}

// --------------------------------------------------------------------------- //
// Orchestrator.                                                               //
// --------------------------------------------------------------------------- //

async function upsert(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  // Chunk to keep request bodies sane (players can be a few hundred rows w/ raw jsonb).
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await admin.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    total += slice.length;
  }
  return total;
}

/** Run one league end-to-end. Throws only on this league's own failure. */
export async function ingestLeague(
  admin: SupabaseClient,
  league: LeagueDef,
  opts: { withPlayers?: boolean } = {},
): Promise<LeagueResult> {
  const season: ResolvedSeason = await resolveSeason(league);
  const year = season.year;

  // 1) Games (full-season window → played + scheduled fixtures, idempotent).
  const games = await fetchSeasonGames(league, season.startDate, season.endDate);
  const gameRows = games
    .map((g) => mapGame(g, league.code, year))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const gamesUpserted = await upsert(admin, "soccer_games", gameRows, "game_id");

  // Team registry from games (baseline), refined by standings below.
  let teamsUpserted = await upsert(
    admin, "soccer_teams", teamsFromGames(games, league.code), "league,team_code",
  );

  // 2) Standings + rich team-season stats.
  const standings = await fetchStandings(league, season.seasonCode);
  const standingRows = standings
    .map((t) => mapStanding(t, league.code, year))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const standingsUpserted = await upsert(admin, "soccer_standings", standingRows, "league,season,team_code");
  const teamRows = standings
    .map((t) => teamFromStanding(t, league.code))
    .filter((r): r is NonNullable<typeof r> => r != null);
  teamsUpserted += await upsert(admin, "soccer_teams", teamRows, "league,team_code");

  // 3) Player season stats (paginated for full coverage).
  let playersUpserted = 0;
  if (opts.withPlayers !== false) {
    const players = await fetchPlayers(league, season.seasonCode);
    const playerRows = players
      .map((p) => mapPlayer(p, league.code, year))
      .filter((r): r is NonNullable<typeof r> => r != null);
    playersUpserted = await upsert(admin, "soccer_player_stats", playerRows, "league,season,player_id");
  }

  return {
    league: league.code, season: year,
    gamesUpserted, teamsUpserted, standingsUpserted, playersUpserted,
  };
}

/**
 * Run the full daily refresh across the requested leagues (default: all).
 * Returns per-league + aggregate counts for the run log.
 */
export async function runDailyIngest(
  admin: SupabaseClient,
  opts: { leagues?: string[]; trigger?: string; withPlayers?: boolean } = {},
): Promise<IngestResult> {
  const codes = opts.leagues?.length ? opts.leagues : LEAGUE_CODES;
  const defs = codes.map(getLeague).filter((d): d is LeagueDef => d != null);

  const perLeague: LeagueResult[] = [];
  for (const def of defs) {
    try {
      perLeague.push(await ingestLeague(admin, def, { withPlayers: opts.withPlayers }));
    } catch (e) {
      const error = e instanceof Error ? e.message : "unknown";
      console.error(`[soccer-daily] league ${def.code} failed:`, e);
      perLeague.push({
        league: def.code, season: 0,
        gamesUpserted: 0, teamsUpserted: 0, standingsUpserted: 0, playersUpserted: 0, error,
      });
    }
  }

  const sum = (f: (r: LeagueResult) => number) => perLeague.reduce((a, r) => a + f(r), 0);
  const season = perLeague.find((r) => r.season > 0)?.season ?? 0;
  return {
    season,
    leagues: defs.map((d) => d.code),
    gamesUpserted: sum((r) => r.gamesUpserted),
    standingsUpserted: sum((r) => r.standingsUpserted),
    playersUpserted: sum((r) => r.playersUpserted),
    perLeague,
    detail: {
      trigger: opts.trigger ?? "unknown",
      leaguesRequested: codes,
      errors: perLeague.filter((r) => r.error).map((r) => ({ league: r.league, error: r.error })),
    },
  };
}

export { LEAGUES };
