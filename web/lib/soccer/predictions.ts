/**
 * Daily soccer predictions — runs in /api/cron/soccer-daily right after ingest.
 *
 * Per league:
 *   1) fit the match model (match-model.ts) on every finished league game of the
 *      last 3 seasons + this one, each tagged with its club's pre-season value
 *      rating (soccer_club_ratings; absent for K League → 0 → results model);
 *   2) upsert 1X2 + expected goals for every not-yet-started fixture into
 *      soccer_match_predictions. Games that have kicked off are never rewritten,
 *      so each row ends up FROZEN at its last pre-kickoff prediction;
 *   3) Monte-Carlo the rest of the season → soccer_sim_snapshots (kind 'season').
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAGUES, getLeague, type LeagueDef } from "./leagues";
import { fitModel, lambdas, outcomeProbs, type FitResult, type TrainGame } from "./match-model";
import { buildTable, rankTable, simulateSeason } from "./season-sim";

const HISTORY_SEASONS = 3;
const SIM_DRAWS = 20000;
export const MODEL_VERSION = "v1";

export interface GameRow {
  game_id: string;
  league: string;
  season: number;
  game_date: string;
  kickoff: string | null;
  status: string;
  home_team: string;
  away_team: string;
  home_name: string | null;
  away_name: string | null;
  home_score: number | null;
  away_score: number | null;
  cancel: boolean;
}

/**
 * soccer_games.kickoff holds Naver's gameDateTime, which is KST WALL-CLOCK time
 * without an offset — Postgres stored it as if it were UTC. Undo that here.
 */
export function kickoffMs(g: Pick<GameRow, "kickoff" | "game_date">): number {
  const raw = g.kickoff ?? `${g.game_date}T00:00:00Z`;
  return Date.parse(raw) - 9 * 3600 * 1000;
}

/** KST calendar date (YYYY-MM-DD), shifted by offsetDays. */
export function kstDate(base: Date, offsetDays = 0): string {
  return new Date(base.getTime() + 9 * 3600 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function selectAll<T>(q: () => any, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await q().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) return out;
  }
}

export async function loadLeagueGames(admin: SupabaseClient, league: string, minSeason: number) {
  return selectAll<GameRow>(() =>
    admin
      .from("soccer_games")
      .select("game_id, league, season, game_date, kickoff, status, home_team, away_team, home_name, away_name, home_score, away_score, cancel")
      .eq("league", league)
      .gte("season", minSeason)
      .order("game_id"),
  );
}

export async function loadRatings(admin: SupabaseClient, league: string) {
  const rows = await selectAll<{ season: number; team_code: string; rating: number }>(() =>
    admin.from("soccer_club_ratings").select("season, team_code, rating").eq("league", league),
  );
  const m = new Map<string, number>();
  for (const r of rows) m.set(`${r.season}|${r.team_code}`, Number(r.rating));
  return m;
}

export interface LeagueModel {
  def: LeagueDef;
  season: number;
  fit: FitResult;
  games: GameRow[]; // all loaded games (history + current)
  rating: (season: number, team: string) => number;
}

/** Fit one league as of `asof` (KST date): history + current season, finished games only. */
export async function fitLeague(admin: SupabaseClient, def: LeagueDef, asof: string): Promise<LeagueModel | null> {
  const recent = await admin.from("soccer_games").select("season").eq("league", def.code)
    .order("season", { ascending: false }).limit(1).maybeSingle();
  const season = recent.data?.season as number | undefined;
  if (season == null) return null;
  const games = await loadLeagueGames(admin, def.code, season - HISTORY_SEASONS);
  const ratings = def.model === "hybrid" ? await loadRatings(admin, def.code) : new Map<string, number>();
  const rating = (s: number, t: string) => ratings.get(`${s}|${t}`) ?? 0;

  const train: TrainGame[] = games
    .filter((g) => g.status === "RESULT" && !g.cancel && g.home_score != null && g.away_score != null && g.game_date < asof)
    .map((g) => ({
      home: g.home_team, away: g.away_team, hs: g.home_score!, as: g.away_score!, date: g.game_date,
      rHome: rating(g.season, g.home_team), rAway: rating(g.season, g.away_team),
    }));
  if (train.length < 50) return null;
  // A league with no ratings at all runs as the results model regardless of def.
  const kind = def.model === "hybrid" && ratings.size > 0 ? "hybrid" : "results";
  return { def, season, fit: fitModel(train, kind, asof), games, rating };
}

export function predictGame(m: LeagueModel, g: GameRow) {
  const [lh, la] = lambdas(m.fit, g.home_team, g.away_team, m.rating(g.season, g.home_team), m.rating(g.season, g.away_team));
  return { lh, la, ...outcomeProbs(lh, la, m.fit.rho) };
}

export interface PredictionResult {
  league: string;
  season: number;
  model: string;
  trainGames: number;
  predictionsUpserted: number;
  error?: string;
}

async function runLeague(admin: SupabaseClient, def: LeagueDef, now: Date): Promise<PredictionResult> {
  const asof = kstDate(now);
  const m = await fitLeague(admin, def, asof);
  if (!m) return { league: def.code, season: 0, model: "none", trainGames: 0, predictionsUpserted: 0 };
  const cur = m.games.filter((g) => g.season === m.season);

  // 2) Pre-kickoff predictions (never touch a game that has started).
  const upcoming = cur.filter((g) => g.status === "BEFORE" && !g.cancel && kickoffMs(g) > now.getTime());
  const rows = upcoming.map((g) => {
    const p = predictGame(m, g);
    return {
      game_id: g.game_id, league: def.code, season: g.season, game_date: g.game_date,
      kickoff: new Date(kickoffMs(g)).toISOString(), home_team: g.home_team, away_team: g.away_team,
      model: `${m.fit.kind}-${MODEL_VERSION}`,
      p_home: Number(p.pHome.toFixed(4)), p_draw: Number(p.pDraw.toFixed(4)), p_away: Number(p.pAway.toFixed(4)),
      xg_home: Number(p.lh.toFixed(3)), xg_away: Number(p.la.toFixed(3)), top_score: p.topScore,
      predicted_at: now.toISOString(),
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("soccer_match_predictions").upsert(rows.slice(i, i + 500), { onConflict: "game_id" });
    if (error) throw new Error(`predictions upsert: ${error.message}`);
  }

  // 3) Season sim over the remaining published fixtures.
  const teams = [...new Set(cur.flatMap((g) => [g.home_team, g.away_team]))];
  const names = new Map<string, string>();
  for (const g of cur) {
    if (g.home_name) names.set(g.home_team, g.home_name);
    if (g.away_name) names.set(g.away_team, g.away_name);
  }
  const done = cur.filter((g) => g.status === "RESULT" && g.home_score != null && g.away_score != null)
    .map((g) => ({ home: g.home_team, away: g.away_team, hs: g.home_score!, as: g.away_score! }));
  const table = buildTable(teams, done);
  const remaining = cur.filter((g) => g.status === "BEFORE" && !g.cancel).map((g) => {
    const p = predictGame(m, g);
    return { home: g.home_team, away: g.away_team, lh: p.lh, la: p.la };
  });
  // Split leagues: synthesize the post-split group games only while they are
  // still unpublished (published schedule ends at the split round).
  // Full season = (rounds + groupSize − 1) × N / 2 games (K League 1: 38 × 12 / 2 =
  // 228). Clearly short of that ⇒ the post-split block isn't published yet.
  const scheduled = done.length + remaining.length;
  const fullSeason = def.split ? ((def.split.rounds + def.split.groupSize - 1) * teams.length) / 2 : 0;
  const needsSplit = def.split != null && teams.length > 0 && scheduled < 0.95 * fullSeason;
  const split = needsSplit
    ? {
        groupSize: def.split!.groupSize,
        lam: (h: string, a: string) => lambdas(m.fit, h, a, m.rating(m.season, h), m.rating(m.season, a)),
      }
    : undefined;
  const sim = simulateSeason(table, remaining, def.zones, { sims: SIM_DRAWS, split });
  const ranked = rankTable([...table.values()]);
  const payload = {
    generatedAt: now.toISOString(),
    asof,
    model: `${m.fit.kind}-${MODEL_VERSION}`,
    sims: SIM_DRAWS,
    zones: def.zones,
    remainingFixtures: remaining.length,
    splitSimulated: needsSplit,
    fit: { homeAdv: m.fit.home, betaA: m.fit.betaA, betaD: m.fit.betaD, rho: m.fit.rho, trainGames: m.fit.nGames },
    teams: ranked.map((r, i) => ({
      rank: i + 1, name: names.get(r.team) ?? r.team,
      played: r.played, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts,
      rating: m.rating(m.season, r.team),
      ...sim.get(r.team)!,
    })),
  };
  const { error } = await admin.from("soccer_sim_snapshots").upsert(
    { league: def.code, season: m.season, kind: "season", payload, run_id: asof, sims: SIM_DRAWS, generated_at: now.toISOString() },
    { onConflict: "league,season,kind" },
  );
  if (error) throw new Error(`sim snapshot upsert: ${error.message}`);

  return { league: def.code, season: m.season, model: m.fit.kind, trainGames: m.fit.nGames, predictionsUpserted: rows.length };
}

/** Predictions + season sim for every tracked league (one league's failure doesn't sink the rest). */
export async function runDailyPredictions(
  admin: SupabaseClient,
  opts: { leagues?: string[]; now?: Date } = {},
): Promise<PredictionResult[]> {
  const now = opts.now ?? new Date();
  const defs = (opts.leagues?.length ? opts.leagues.map(getLeague) : LEAGUES).filter((d): d is LeagueDef => !!d);
  const out: PredictionResult[] = [];
  for (const def of defs) {
    try {
      out.push(await runLeague(admin, def, now));
    } catch (e) {
      console.error(`[soccer-predict] ${def.code} failed:`, e);
      out.push({ league: def.code, season: 0, model: "error", trainGames: 0, predictionsUpserted: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
