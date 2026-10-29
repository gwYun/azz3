/**
 * LoL Worlds pipeline — one call per cron run:
 *
 *   1) ingest: Naver schedule months → lol_matches (Worlds + every training league,
 *      current and previous month; scripts/backfill-lol.ts loads history once);
 *   2) fit the rating model on every finished series (model.ts);
 *   3) predictions: every not-yet-started Worlds series with both sides drawn is
 *      re-predicted into lol_predictions; series that have started are never
 *      rewritten, so each row is frozen at its last pre-start prediction;
 *   4) report: publish/refresh the match-day report (articles.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOL_LEAGUES, WORLDS_TOP_LEAGUE } from "./leagues";
import { fetchMonths, monthRange, type NaverLolMatch } from "./naver";
import { buildRegionMap, toTrainSeries, type LolMatchRow } from "./data";
import { fitLol, mapWinProb, seriesOutcomes, type LolFit } from "./model";

export const MODEL_VERSION = "lol-bt-v1";
export const WORLDS_SEASON = 2026;
export const WORLDS_LEAGUE_ID = `world_championship_${WORLDS_SEASON}`;

const ROW_COLS =
  "game_id, top_league, league_id, start_at, title, status, best_of, home_team, away_team, home_name, away_name, home_code, away_code, home_score, away_score, stadium";

export function toRow(m: NaverLolMatch) {
  return {
    game_id: m.gameId,
    top_league: m.topLeagueId,
    league_id: m.leagueId,
    start_at: new Date(m.startDate).toISOString(),
    title: m.title ?? null,
    status: m.matchStatus,
    best_of: m.maxMatchCount,
    home_team: m.homeTeam?.teamId ?? "TBD",
    away_team: m.awayTeam?.teamId ?? "TBD",
    home_name: m.homeTeam?.name ?? null,
    away_name: m.awayTeam?.name ?? null,
    home_code: m.homeTeam?.nameEngAcronym ?? null,
    away_code: m.awayTeam?.nameEngAcronym ?? null,
    home_score: m.homeScore ?? 0,
    away_score: m.awayScore ?? 0,
    stadium: m.stadium ?? null,
    raw: { winner: m.winner ?? null, homeImage: m.homeTeam?.imageUrl ?? null, awayImage: m.awayTeam?.imageUrl ?? null },
    updated_at: new Date().toISOString(),
  };
}

export async function upsertMatches(admin: SupabaseClient, matches: NaverLolMatch[]): Promise<number> {
  const rows = [...new Map(matches.map((m) => [m.gameId, toRow(m)])).values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("lol_matches").upsert(rows.slice(i, i + 500), { onConflict: "game_id" });
    if (error) throw new Error(`lol_matches upsert: ${error.message}`);
  }
  return rows.length;
}

/** Ingest the current + previous month for every league (Worlds also next month, for the bracket). */
export async function ingestRecent(admin: SupabaseClient, now = new Date()): Promise<number> {
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const months = monthRange(ym(prev), ym(now));
  const domestic = await fetchMonths(LOL_LEAGUES.filter((l) => l.id !== WORLDS_TOP_LEAGUE).map((l) => l.id), months);
  const worlds = await fetchMonths([WORLDS_TOP_LEAGUE], monthRange(ym(prev), ym(next)));
  return upsertMatches(admin, [...domestic, ...worlds]);
}

export async function loadMatches(admin: SupabaseClient): Promise<LolMatchRow[]> {
  const out: LolMatchRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("lol_matches").select(ROW_COLS).order("start_at").range(from, from + 999);
    if (error) throw new Error(`lol_matches read: ${error.message}`);
    out.push(...((data ?? []) as LolMatchRow[]));
    if (!data || data.length < 1000) return out;
  }
}

export function fitAll(rows: LolMatchRow[], asOf = Date.now()): LolFit {
  return fitLol(toTrainSeries(rows), buildRegionMap(rows, asOf), asOf);
}

export interface SeriesPred {
  pMap: number;
  pHome: number;                                  // 0..1
  scores: { a: number; b: number; p: number }[];  // home = a
}

export function predictSeries(fit: LolFit, home: string, away: string, bestOf: number): SeriesPred {
  const pMap = mapWinProb(fit, home, away);
  const o = seriesOutcomes(pMap, bestOf);
  return { pMap, pHome: o.pA, scores: o.scores };
}

/**
 * Walk-forward predictions for FINISHED Worlds series that have none (played
 * before the pipeline went live): each is predicted from a fit on data strictly
 * before its start, and tagged `<model>-walkforward` so reports can label them
 * as reconstructions rather than records. Insert-only — never overwrites a real
 * pre-match prediction.
 */
export async function backfillWalkForward(admin: SupabaseClient, rows: LolMatchRow[]): Promise<number> {
  const { data, error } = await admin.from("lol_predictions").select("game_id").eq("league_id", WORLDS_LEAGUE_ID);
  if (error) throw new Error(`lol_predictions read: ${error.message}`);
  const have = new Set(((data ?? []) as { game_id: string }[]).map((r) => r.game_id));
  const due = rows.filter(
    (m) => m.league_id === WORLDS_LEAGUE_ID && m.status === "RESULT" && m.home_team !== "TBD" && !have.has(m.game_id),
  );
  const out = [];
  for (const m of due) {
    const asOf = Date.parse(m.start_at);
    const p = predictSeries(fitAll(rows, asOf), m.home_team, m.away_team, m.best_of);
    out.push({
      game_id: m.game_id, league_id: m.league_id, start_at: m.start_at, home_team: m.home_team, away_team: m.away_team,
      best_of: m.best_of, p_map: p.pMap, p_home: p.pHome, scores: p.scores, model: `${MODEL_VERSION}-walkforward`,
      predicted_at: new Date().toISOString(),
    });
  }
  if (out.length) {
    const { error: upErr } = await admin.from("lol_predictions").upsert(out, { onConflict: "game_id", ignoreDuplicates: true });
    if (upErr) throw new Error(`lol_predictions backfill: ${upErr.message}`);
  }
  return out.length;
}

/** Re-predict every not-yet-started Worlds series with both sides known. */
export async function writePredictions(
  admin: SupabaseClient,
  rows: LolMatchRow[],
  fit: LolFit,
  now = new Date(),
): Promise<number> {
  const due = rows.filter(
    (m) => m.league_id === WORLDS_LEAGUE_ID && m.status === "BEFORE" && m.home_team !== "TBD" && m.away_team !== "TBD"
      && Date.parse(m.start_at) > now.getTime(),
  );
  if (!due.length) return 0;
  const out = due.map((m) => {
    const p = predictSeries(fit, m.home_team, m.away_team, m.best_of);
    return {
      game_id: m.game_id, league_id: m.league_id, start_at: m.start_at, home_team: m.home_team, away_team: m.away_team,
      best_of: m.best_of, p_map: p.pMap, p_home: p.pHome, scores: p.scores, model: MODEL_VERSION,
      predicted_at: now.toISOString(),
    };
  });
  const { error } = await admin.from("lol_predictions").upsert(out, { onConflict: "game_id" });
  if (error) throw new Error(`lol_predictions upsert: ${error.message}`);
  return out.length;
}
