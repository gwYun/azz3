/**
 * KBO daily ingest — orchestrates the nightly refresh that the Vercel cron
 * (/api/cron/kbo-daily) drives.
 *
 * Pipeline (built out across phases):
 *   P1  fetch Naver → upsert kbo_games, kbo_team_stats, kbo_hitter/pitcher_stats
 *   P2  recompute wOBA/wRC+/FIP/WAR/ERA in-house over the fresh raw stats
 *   P3  team ratings → reduced-draw season Monte-Carlo → kbo_sim_snapshots
 *
 * Everything writes through the service-role admin client (RLS-bypassing); this
 * module never runs in the browser.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveFranchise } from "./franchise";
import { kboIpToDecimal, num } from "./util";
import {
  fetchSeasonGames,
  fetchTeamStats,
  fetchAllHitters,
  fetchAllPitchers,
  type NaverGame,
  type NaverTeamStat,
  type NaverHitter,
  type NaverPitcher,
} from "./naver";
import {
  woba, wrcPlus, battingWar, fip, pitchingWar, constantsFromTotals,
  type Constants, type BatLine, type PitLine,
} from "./sabermetrics";
import { buildSeasonPayload } from "./season-payload";

// Reduced-draw Monte-Carlo count for the in-cron season sim (see season-sim.ts).
const SIM_DRAWS = 40000;

/** Nulls → 0 for counting stats we sum/feed into formulas. */
const z = (v: number | null | undefined): number => (v == null ? 0 : v);

export const CURRENT_SEASON = 2026;

export interface IngestResult {
  season: number;
  gamesUpserted: number;
  hittersUpserted: number;
  pitchersUpserted: number;
  teamsUpserted: number;
  simGenerated: boolean;
  detail: Record<string, unknown>;
}

// --------------------------------------------------------------------------- //
// Naver row → Supabase row mappers.                                           //
// --------------------------------------------------------------------------- //

export function mapGame(g: NaverGame, season: number) {
  const home = resolveFranchise(g.homeTeamCode ?? g.homeTeamName);
  const away = resolveFranchise(g.awayTeamCode ?? g.awayTeamName);
  if (!home || !away) return null; // all-star / exhibition / unknown
  const hs = num(g.homeTeamScore);
  const as = num(g.awayTeamScore);
  let winner = g.winner ?? null;
  if (!winner && g.statusCode === "RESULT" && hs != null && as != null) {
    winner = hs > as ? "HOME" : as > hs ? "AWAY" : null;
  }
  return {
    game_id: g.gameId,
    season,
    game_date: g.gameDate,
    status: g.statusCode ?? "UNKNOWN",
    stadium: g.stadium ?? null,
    away_team: away,
    home_team: home,
    away_score: as,
    home_score: hs,
    winner,
    cancel: Boolean(g.cancel),
    suspended: Boolean(g.suspended),
    updated_at: new Date().toISOString(),
  };
}

export function mapTeam(t: NaverTeamStat, season: number) {
  const team = resolveFranchise(t.teamId);
  if (!team) return null;
  return {
    season,
    team,
    ranking: num(t.ranking),
    games: num(t.gameCount),
    win: num(t.winGameCount),
    lose: num(t.loseGameCount),
    draw: num(t.drawnGameCount),
    wra: num(t.wra),
    game_behind: num(t.gameBehind),
    last_five: t.lastFiveGames ?? null,
    streak: t.continuousGameResult ?? null,
    o_run: num(t.offenseRun), o_rbi: num(t.offenseRbi), o_ab: num(t.offenseAb),
    o_hit: num(t.offenseHit), o_h2: num(t.offenseH2), o_h3: num(t.offenseH3),
    o_hr: num(t.offenseHr), o_sb: num(t.offenseSb), o_bbhp: num(t.offenseBbhp),
    o_kk: num(t.offenseKk), o_obp: num(t.offenseObp), o_slg: num(t.offenseSlg),
    o_ops: num(t.offenseOps), o_hra: num(t.offenseHra),
    d_era: num(t.defenseEra), d_r: num(t.defenseR), d_er: num(t.defenseEr),
    d_inning: kboIpToDecimal(num(t.defenseInning)),
    d_hit: num(t.defenseHit), d_hr: num(t.defenseHr), d_kk: num(t.defenseKk),
    d_bbhp: num(t.defenseBbhp), d_err: num(t.defenseErr), d_whip: num(t.defenseWhip),
    d_qs: num(t.defenseQs), d_save: num(t.defenseSave), d_hold: num(t.defenseHold),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Batting line for the in-house formulas, built from the Naver counts. Naver's
 * player feed lacks IBB/SF/SH, so those are approximated to 0 — disclosed; the
 * effect on wOBA/WAR is small and the cross-check vs Naver's own WAR catches drift.
 */
function batLine(h: {
  ab: number | null; hit: number | null; h2: number | null; h3: number | null;
  hr: number | null; bb: number | null; hp: number | null;
}): BatLine {
  const ab = z(h.ab), hit = z(h.hit), h2 = z(h.h2), h3 = z(h.h3), hr = z(h.hr);
  const bb = z(h.bb), hp = z(h.hp);
  return {
    AB: ab, B1: Math.max(0, hit - h2 - h3 - hr), B2: h2, B3: h3, HR: hr,
    BB: bb, IBB: 0, HBP: hp, SF: 0,
    PA: ab + bb + hp, // + SF + SH ≈ 0 (not in the Naver feed)
  };
}

function round(v: number | null, d: number): number | null {
  return v == null || !isFinite(v) ? null : Number(v.toFixed(d));
}

export function mapHitter(h: NaverHitter, season: number, c?: Constants) {
  const team = resolveFranchise(h.teamId);
  const row = {
    player_id: h.playerId,
    season,
    player_name: h.playerName ?? null,
    team,
    games: num(h.hitterGameCount), ab: num(h.hitterAb), hit: num(h.hitterHit),
    h2: num(h.hitterH2), h3: num(h.hitterH3), hr: num(h.hitterHr),
    bb: num(h.hitterBb), hp: num(h.hitterHp), kk: num(h.hitterKk),
    sb: num(h.hitterSb), cs: num(h.hitterCs), rbi: num(h.hitterRbi),
    run: num(h.hitterRun), gd: num(h.hitterGd),
    obp: null as number | null, slg: null as number | null, ops: null as number | null,
    woba: null as number | null, wrc_plus: null as number | null, war: null as number | null,
    naver_woba: num(h.hitterWoba), naver_wrc_plus: num(h.hitterWrcPlus),
    naver_war: num(h.hitterWar),
    is_qualified: h.isQualified ?? null,
    source: "naver_players",
    updated_at: new Date().toISOString(),
  };
  if (c) {
    const b = batLine(row);
    const denObp = b.AB + b.BB + b.HBP + b.SF;
    if (b.AB > 0) {
      row.obp = round((z(row.hit) + b.BB + b.HBP) / denObp, 4);
      row.slg = round((b.B1 + 2 * b.B2 + 3 * b.B3 + 4 * b.HR) / b.AB, 4);
      row.ops = row.obp != null && row.slg != null ? round(row.obp + row.slg, 4) : null;
    }
    row.woba = round(woba(b, c), 4);
    row.wrc_plus = round(wrcPlus(b, c), 1);
    row.war = round(battingWar(b, c), 3);
  }
  return row;
}

export function mapPitcher(p: NaverPitcher, season: number, c?: Constants) {
  const team = resolveFranchise(p.teamId);
  const ip = kboIpToDecimal(num(p.pitcherInning));
  const row = {
    player_id: p.playerId,
    season,
    player_name: p.playerName ?? null,
    team,
    games: num(p.pitcherGameCount), gs: num(p.pitcherStart),
    inning: ip, bf: null,
    hit: num(p.pitcherHit), hr: num(p.pitcherHr), r: num(p.pitcherR), er: num(p.pitcherEr),
    bb: num(p.pitcherBb), hp: num(p.pitcherHp), kk: num(p.pitcherKk),
    win: num(p.pitcherWin), lose: num(p.pitcherLose), save: num(p.pitcherSave),
    hold: num(p.pitcherHold), qs: num(p.pitcherQs), pitch_count: num(p.pitcherPitchCount),
    era: null as number | null, whip: null as number | null,
    fip: null as number | null, war: null as number | null,
    naver_era: num(p.pitcherEra), naver_war: num(p.pitcherWar),
    is_qualified: p.isQualified ?? null,
    source: "naver_players",
    updated_at: new Date().toISOString(),
  };
  if (c && ip && ip > 0) {
    const line: PitLine = { IP: ip, HR: z(row.hr), BB: z(row.bb), HBP: z(row.hp), SO: z(row.kk) };
    row.era = round((z(row.er) * 9) / ip, 3);
    row.whip = round((z(row.bb) + z(row.hit)) / ip, 3);
    row.fip = round(fip(line, c), 3);
    row.war = round(pitchingWar(line, c), 3);
  }
  return row;
}

/**
 * League constants for the season, derived live from the mapped team totals
 * (mirrors league_constants.constants_from_totals). Naver only exposes the
 * combined bbhp at team level, so BB/HBP are folded into one term — the FIP
 * kernel uses (BB+HBP) together anyway, and the wOBA-numerator weight gap
 * (0.69 vs 0.72) is negligible. IBB/SF approximated 0.
 */
export function leagueConstants(teamRows: ReturnType<typeof mapTeam>[], season: number): Constants {
  const sum = (f: (t: NonNullable<ReturnType<typeof mapTeam>>) => number | null) =>
    teamRows.reduce((a, t) => a + (t ? z(f(t)) : 0), 0);
  const AB = sum((t) => t.o_ab), H = sum((t) => t.o_hit);
  const H2 = sum((t) => t.o_h2), H3 = sum((t) => t.o_h3), HR = sum((t) => t.o_hr);
  const BBHP = sum((t) => t.o_bbhp), R = sum((t) => t.o_run);
  const teamGames = sum((t) => t.games);
  const bat = {
    PA: AB + BBHP, AB, H, B1: Math.max(0, H - H2 - H3 - HR), B2: H2, B3: H3, HR,
    BB: BBHP, IBB: 0, HBP: 0, SF: 0, R, // BB/HBP folded (see docstring)
  };
  const pit = {
    IP: sum((t) => t.d_inning), ER: sum((t) => t.d_er), HR: sum((t) => t.d_hr),
    BB: sum((t) => t.d_bbhp), HBP: 0, SO: sum((t) => t.d_kk),
  };
  return constantsFromTotals(season, bat, pit, teamGames);
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
  const { error } = await admin.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
  return rows.length;
}

/**
 * Run the full daily refresh. Returns per-stage counts for the run log.
 * P1: games + team stats + player raw stats. P2 recomputes metrics; P3 sims.
 */
export async function runDailyIngest(
  admin: SupabaseClient,
  opts: { season?: number; trigger?: string; throughMonth?: number } = {},
): Promise<IngestResult> {
  const season = opts.season ?? CURRENT_SEASON;
  // Default to the current KBO month so daily runs cover the whole season so far
  // (idempotent upserts; unplayed months are cheap misses). Overridable in tests.
  const throughMonth = opts.throughMonth ?? new Date().getUTCMonth() + 1;

  // 1) Games (매치·득점).
  const games = await fetchSeasonGames(season, throughMonth);
  const gameRows = games.map((g) => mapGame(g, season)).filter((r): r is NonNullable<typeof r> => r != null);
  const gamesUpserted = await upsert(admin, "kbo_games", gameRows, "game_id");

  // 2) Team season stats + standings → also the live league constants.
  const teams = await fetchTeamStats(season);
  const teamRows = teams.map((t) => mapTeam(t, season)).filter((r): r is NonNullable<typeof r> => r != null);
  const teamsUpserted = await upsert(admin, "kbo_team_stats", teamRows, "season,team");
  const constants = teamRows.length > 0 ? leagueConstants(teamRows, season) : undefined;

  // 3) Player raw stats (union of leaderboards to beat the 50-row cap), with the
  // in-house metrics (wOBA/wRC+/WAR, FIP/ERA) recomputed from the fresh counts.
  const hitters = await fetchAllHitters(season);
  const hitterRows = hitters.map((h) => mapHitter(h, season, constants));
  const hittersUpserted = await upsert(admin, "kbo_hitter_stats", hitterRows, "player_id,season");

  const pitchers = await fetchAllPitchers(season);
  const pitcherRows = pitchers.map((p) => mapPitcher(p, season, constants));
  const pitchersUpserted = await upsert(admin, "kbo_pitcher_stats", pitcherRows, "player_id,season");

  // 4) Season forecast — lean team-rating Monte-Carlo over the fresh rates.
  const runId = new Date().toISOString();
  let simGenerated = false;
  let titlePick: unknown = null;
  if (teamRows.length >= 2) {
    const payload = buildSeasonPayload(teamRows, hitterRows, pitcherRows, {
      season, sims: SIM_DRAWS, runId, modelCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
    const { error } = await admin.from("kbo_sim_snapshots").upsert(
      { season, kind: "season", payload, run_id: runId, sims: SIM_DRAWS,
        model_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, generated_at: runId },
      { onConflict: "season,kind" },
    );
    if (error) throw new Error(`upsert kbo_sim_snapshots: ${error.message}`);
    simGenerated = true;
    titlePick = payload.title_pick;
  }

  return {
    season,
    gamesUpserted,
    teamsUpserted,
    hittersUpserted,
    pitchersUpserted,
    simGenerated,
    detail: {
      phase: "p3-full",
      trigger: opts.trigger ?? "unknown",
      throughMonth,
      gamesFetched: games.length,
      hittersFetched: hitters.length,
      pitchersFetched: pitchers.length,
      titlePick,
    },
  };
}
