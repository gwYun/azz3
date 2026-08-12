/**
 * Box-score ingest — the full-roster feed for the live /matchup engine.
 *
 * Fetches per-game player lines from Naver (schedule/games/{id}/record) for RESULT
 * games not yet stored, and upserts them into kbo_boxscore_batters/pitchers. Marks
 * kbo_games.boxscore_ingested so the daily run only touches new games (the first
 * backfill is capped per run / run locally). Aggregated later into per-player season
 * totals by matchup.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGameRecord, type NaverBoxBatter, type NaverBoxPitcher } from "./naver";
import { kboIpToDecimal, num } from "./util";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapBoxBatter(gameId: string, season: number, team: string | null, b: NaverBoxBatter) {
  return {
    game_id: gameId,
    player_id: String(b.playerCode ?? ""),
    season,
    team,
    player_name: b.name ?? null,
    bat_order: num(b.batOrder),
    pos: b.pos ?? null,
    ab: num(b.ab), hit: num(b.hit), hr: num(b.hr), bb: num(b.bb), hbp: null,
    kk: num(b.kk), sb: num(b.sb), run: num(b.run), rbi: num(b.rbi),
    updated_at: new Date().toISOString(),
  };
}

export function mapBoxPitcher(
  gameId: string, season: number, team: string | null, p: NaverBoxPitcher, started: boolean,
) {
  const inn = p.inn == null ? null : kboIpToDecimal(Number(p.inn));
  return {
    game_id: gameId,
    player_id: String(p.pcode ?? ""),
    season,
    team,
    player_name: p.name ?? null,
    started,
    ip: inn, bf: num(p.bf), ab: num(p.ab), hit: num(p.hit), hr: num(p.hr),
    r: num(p.r), er: num(p.er), bb: num(p.bb), bbhp: num(p.bbhp), kk: num(p.kk),
    updated_at: new Date().toISOString(),
  };
}

export interface BoxIngestResult {
  gamesIngested: number;
  batterRows: number;
  pitcherRows: number;
  remaining: boolean; // true if the per-run cap was hit (more games await)
}

/**
 * Ingest box scores for up to `cap` un-ingested RESULT games this run. Idempotent:
 * each game's rows upsert on (game_id, player_id) and the game is flagged done.
 */
export async function ingestBoxScores(
  admin: SupabaseClient,
  season: number,
  opts: { cap?: number; delayMs?: number } = {},
): Promise<BoxIngestResult> {
  const cap = opts.cap ?? 220;
  const delayMs = opts.delayMs ?? 200;

  const { data: games, error } = await admin
    .from("kbo_games")
    .select("game_id, home_team, away_team")
    .eq("season", season)
    .eq("status", "RESULT")
    .eq("boxscore_ingested", false)
    .order("game_date", { ascending: true })
    .limit(cap);
  if (error) throw new Error(`boxscore: list games: ${error.message}`);

  let gamesIngested = 0, batterRows = 0, pitcherRows = 0;
  for (const g of games ?? []) {
    const rec = await fetchGameRecord(g.game_id as string);
    if (!rec) continue; // no record yet — leave unmarked, retry next run
    const batters = [
      ...rec.away.batters.map((b) => mapBoxBatter(g.game_id as string, season, g.away_team as string, b)),
      ...rec.home.batters.map((b) => mapBoxBatter(g.game_id as string, season, g.home_team as string, b)),
    ].filter((r) => r.player_id);
    const pitchers = [
      ...rec.away.pitchers.map((p, i) => mapBoxPitcher(g.game_id as string, season, g.away_team as string, p, i === 0)),
      ...rec.home.pitchers.map((p, i) => mapBoxPitcher(g.game_id as string, season, g.home_team as string, p, i === 0)),
    ].filter((r) => r.player_id);

    if (batters.length) {
      const { error: e } = await admin.from("kbo_boxscore_batters").upsert(batters, { onConflict: "game_id,player_id" });
      if (e) throw new Error(`boxscore batters upsert: ${e.message}`);
    }
    if (pitchers.length) {
      const { error: e } = await admin.from("kbo_boxscore_pitchers").upsert(pitchers, { onConflict: "game_id,player_id" });
      if (e) throw new Error(`boxscore pitchers upsert: ${e.message}`);
    }
    await admin.from("kbo_games").update({ boxscore_ingested: true }).eq("game_id", g.game_id);
    gamesIngested++; batterRows += batters.length; pitcherRows += pitchers.length;
    await sleep(delayMs);
  }
  return { gamesIngested, batterRows, pitcherRows, remaining: (games?.length ?? 0) >= cap };
}
