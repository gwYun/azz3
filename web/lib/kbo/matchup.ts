/**
 * Matchup ingredient builder — TS port of kbo/src/matchup_export.py.
 *
 * Aggregates the box-score season totals (full rosters, from kbo_boxscore_*_totals)
 * into per-player event rates, a modeled 5-man rotation + bullpen, a heuristic
 * projected lineup, and a per-team mu_calib scalar — the ingredients the in-browser
 * base-out Markov engine (matchup-sim.ts) consumes. Batter 2B/3B splits use the
 * leaderboard's real values where available (kbo_hitter_stats), else the league
 * non-HR hit split — same fallback the Python pitcher_rates uses.
 *
 * markovExpectedRuns is reused from matchup-sim.ts (the deterministic engine), so
 * mu_calib is computed against the exact model the client runs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { markovExpectedRuns, type Rates, type Segment, type MatchupData } from "../matchup-sim";
import { DISPERSION_K, HOME_FACTOR, DEFAULT_SHRINK } from "./season-sim";
import { fip as fipFn, pitchingWar, wrcPlus, battingWar, type Constants, type BatLine, type PitLine } from "./sabermetrics";
import { TEAM_NAMES, FRANCHISES, type Franchise } from "./franchise";

const EVENTS = ["bb", "b1", "b2", "b3", "hr", "out"] as const;
const K_BAT = 120.0;
const K_PIT = 180.0;
const POOL_SIZE = 14;
const ROTATION = 5;
const BULLPEN_ARMS = 8;

const r6 = (x: number) => Number(x.toFixed(6));
const z = (v: number | null | undefined) => (v == null ? 0 : v);

export interface BatterAgg {
  player_id: string; team: string | null; player_name: string | null; g: number;
  ab: number; hit: number; hr: number; bb: number; kk: number; sb: number; run: number; rbi: number;
}
export interface PitcherAgg {
  player_id: string; team: string | null; player_name: string | null; g: number; gs: number;
  ip: number; bf: number; hit: number; hr: number; r: number; er: number; bb: number; bbhp: number; kk: number;
}
export interface Split { h2: number; h3: number; hbp: number }

export interface LeagueRates {
  event: Rates;
  hit_split_nonhr: { b1: number; b2: number; b3: number };
}

interface TeamRow {
  team: string | null; games: number | null; o_run: number | null; d_r: number | null;
  o_ab: number | null; o_hit: number | null; o_h2: number | null; o_h3: number | null;
  o_hr: number | null; o_bbhp: number | null;
}

// --------------------------------------------------------------------------- //
// League rates (from team-season totals).                                     //
// --------------------------------------------------------------------------- //
export function leagueEventRates(teams: TeamRow[]): LeagueRates {
  const S = (f: (t: TeamRow) => number | null) => teams.reduce((a, t) => a + z(f(t)), 0);
  const AB = S((t) => t.o_ab), H = S((t) => t.o_hit), H2 = S((t) => t.o_h2);
  const H3 = S((t) => t.o_h3), HR = S((t) => t.o_hr), BBHP = S((t) => t.o_bbhp);
  const B1 = Math.max(0, H - H2 - H3 - HR);
  const pa = AB + BBHP; // + SF/SH ≈ 0
  const event: Rates = {
    bb: BBHP / pa, b1: B1 / pa, b2: H2 / pa, b3: H3 / pa, hr: HR / pa, out: 0,
  };
  event.out = 1 - (event.bb + event.b1 + event.b2 + event.b3 + event.hr);
  const nonhr = B1 + H2 + H3 || 1;
  return {
    event: { bb: r6(event.bb), b1: r6(event.b1), b2: r6(event.b2), b3: r6(event.b3), hr: r6(event.hr), out: r6(event.out) },
    hit_split_nonhr: { b1: r6(B1 / nonhr), b2: r6(H2 / nonhr), b3: r6(H3 / nonhr) },
  };
}

function shrink(raw: Rates, n: number, lg: Rates, k: number): Rates {
  const b = (e: keyof Rates) => r6((raw[e] * n + lg[e] * k) / (n + k));
  return { bb: b("bb"), b1: b("b1"), b2: b("b2"), b3: b("b3"), hr: b("hr"), out: b("out") };
}

// --------------------------------------------------------------------------- //
// Player rates.                                                               //
// --------------------------------------------------------------------------- //
function batLine(agg: BatterAgg, sp?: Split): BatLine {
  const hbp = sp?.hbp ?? 0;
  const pa = z(agg.ab) + z(agg.bb) + hbp;
  const hr = z(agg.hr);
  const nonHr = Math.max(0, z(agg.hit) - hr);
  let b1: number, b2: number, b3: number;
  if (sp && (sp.h2 > 0 || sp.h3 > 0)) {
    b2 = sp.h2; b3 = sp.h3; b1 = Math.max(0, z(agg.hit) - b2 - b3 - hr);
  } else {
    // league split provided via caller through the lg object is not here; use even
    // fallback only if no leaderboard split (rare bench). Caller supplies lg split.
    b1 = nonHr; b2 = 0; b3 = 0;
  }
  return { PA: pa, AB: z(agg.ab), B1: b1, B2: b2, B3: b3, HR: hr, BB: z(agg.bb), IBB: 0, HBP: hbp, SF: 0 };
}

export function batterRates(agg: BatterAgg, lg: LeagueRates, sp?: Split): Rates | null {
  const hbp = sp?.hbp ?? 0;
  const pa = z(agg.ab) + z(agg.bb) + hbp;
  if (pa <= 0) return null;
  const hr = z(agg.hr);
  const nonHr = Math.max(0, z(agg.hit) - hr);
  let b1: number, b2: number, b3: number;
  if (sp && (sp.h2 > 0 || sp.h3 > 0)) {
    b2 = sp.h2; b3 = sp.h3; b1 = Math.max(0, z(agg.hit) - b2 - b3 - hr);
  } else {
    const s = lg.hit_split_nonhr;
    b1 = nonHr * s.b1; b2 = nonHr * s.b2; b3 = nonHr * s.b3;
  }
  const raw: Rates = {
    bb: (z(agg.bb) + hbp) / pa, b1: b1 / pa, b2: b2 / pa, b3: b3 / pa, hr: hr / pa, out: 0,
  };
  raw.out = Math.max(0, 1 - (raw.bb + raw.b1 + raw.b2 + raw.b3 + raw.hr));
  return shrink(raw, pa, lg.event, K_BAT);
}

export function pitcherRates(agg: PitcherAgg, lg: LeagueRates): Rates | null {
  const ip = z(agg.ip);
  const bf = z(agg.bf) > 0 ? z(agg.bf) : 3 * ip + z(agg.hit) + z(agg.bbhp);
  if (bf <= 0) return null;
  const hr = z(agg.hr) / bf;
  const bb = z(agg.bbhp) / bf;
  const hits = z(agg.hit) / bf;
  const nonhr = Math.max(0, hits - hr);
  const sp = lg.hit_split_nonhr;
  const raw: Rates = {
    bb, b1: nonhr * sp.b1, b2: nonhr * sp.b2, b3: nonhr * sp.b3, hr, out: Math.max(0, 1 - bb - hits),
  };
  const s = EVENTS.reduce((a, e) => a + raw[e], 0) || 1;
  for (const e of EVENTS) raw[e] = raw[e] / s;
  return shrink(raw, bf, lg.event, K_PIT);
}

function pitcherFip(agg: PitcherAgg, c: Constants): number {
  const line: PitLine = { IP: z(agg.ip), HR: z(agg.hr), BB: z(agg.bbhp), HBP: 0, SO: z(agg.kk) };
  return fipFn(line, c) ?? c.lg_FIP;
}

function compositeRates(pit: { ip: number; rates: Rates; fip: number }[], lg: LeagueRates, lgFip: number): Segment {
  if (pit.length === 0) return { fip: Number(lgFip.toFixed(2)), rates: { ...lg.event } };
  const w = pit.map((p) => Math.max(p.ip, 1e-6));
  const wsum = w.reduce((a, b) => a + b, 0);
  const rates = {} as Rates;
  for (const e of EVENTS) rates[e] = r6(pit.reduce((a, p, i) => a + w[i] * p.rates[e], 0) / wsum);
  const fip = pit.reduce((a, p, i) => a + w[i] * p.fip, 0) / wsum;
  return { fip: Number(fip.toFixed(2)), rates };
}

// --------------------------------------------------------------------------- //
// Staff + lineup construction.                                                //
// --------------------------------------------------------------------------- //
interface StaffPitcher extends PitcherAgg { rates: Rates; fip: number; war: number; ipg: number }

export function classifyStaff(pitAggs: PitcherAgg[], lg: LeagueRates, c: Constants, lgFip: number) {
  const p: StaffPitcher[] = pitAggs
    .filter((a) => z(a.ip) > 0)
    .map((a) => {
      const rates = pitcherRates(a, lg);
      return rates ? { ...a, rates, fip: pitcherFip(a, c), war: pitchingWar({ IP: z(a.ip), HR: z(a.hr), BB: z(a.bbhp), HBP: 0, SO: z(a.kk) }, c) ?? 0, ipg: z(a.ip) / Math.max(z(a.g), 1) } : null;
    })
    .filter((x): x is StaffPitcher => x != null);

  const byIpDesc = (a: StaffPitcher, b: StaffPitcher) => b.ip - a.ip;
  const cand = p.filter((x) => x.ipg >= 3.0 && x.ip >= 20).sort(byIpDesc);
  let rot = cand.slice(0, ROTATION);
  if (rot.length < ROTATION) {
    const have = new Set(rot.map((x) => x.player_id));
    const extra = p.filter((x) => !have.has(x.player_id)).sort(byIpDesc).slice(0, ROTATION - rot.length);
    rot = [...rot, ...extra];
  }
  const rotIds = new Set(rot.map((x) => x.player_id));
  const pen = p.filter((x) => !rotIds.has(x.player_id));
  const elite = pen.filter((x) => x.ip >= 10).sort((a, b) => a.fip - b.fip).slice(0, 3);

  let armPool = pen.filter((x) => x.ip >= 10);
  if (armPool.length < 4) armPool = [...pen].sort(byIpDesc).slice(0, BULLPEN_ARMS);
  const arms = [...armPool].sort((a, b) => a.fip - b.fip).slice(0, BULLPEN_ARMS);

  const rotation = rot.map((x) => ({
    name: String(x.player_name ?? ""), gs: Math.round(z(x.gs) || z(x.g)),
    sp_innings: Number(Math.min(Math.max(x.ipg, 4.5), 6.5).toFixed(2)),
    fip: Number(x.fip.toFixed(2)), rates: x.rates,
  }));
  const bullpen_arms = arms.map((x) => ({
    name: String(x.player_name ?? ""), ip: Number(x.ip.toFixed(1)),
    fip: Number(x.fip.toFixed(2)), war: Number(x.war.toFixed(1)), rates: x.rates,
  }));
  return {
    rotation,
    bullpen_arms,
    bullpen: compositeRates(pen.map((x) => ({ ip: x.ip, rates: x.rates, fip: x.fip })), lg, lgFip),
    bullpen_elite: compositeRates((elite.length ? elite : pen).map((x) => ({ ip: x.ip, rates: x.rates, fip: x.fip })), lg, lgFip),
  };
}

interface PoolBatter { name: string; pa: number; wrc_plus: number; war: number; rates: Rates }

export function battingOrder(pool: PoolBatter[]): number[] {
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const onbase: Record<number, number> = {}, power: Record<number, number> = {}, value: Record<number, number> = {};
  for (const i of idx) {
    onbase[i] = 1 - pool[i].rates.out;
    power[i] = pool[i].rates.b2 + 2 * pool[i].rates.b3 + 3 * pool[i].rates.hr;
    value[i] = pool[i].wrc_plus;
  }
  const rem = new Set(idx);
  const take = (metric: Record<number, number>): number => {
    let best = -1, bv = -Infinity;
    for (const i of rem) if (metric[i] > bv) { bv = metric[i]; best = i; }
    rem.delete(best);
    return best;
  };
  const lead = take(onbase), cleanup = take(power), three = take(value), two = take(onbase), five = take(power);
  const rest = [...rem].sort((a, b) => value[b] - value[a]);
  return [lead, two, three, cleanup, five, ...rest];
}

// --------------------------------------------------------------------------- //
// Team + payload assembly.                                                    //
// --------------------------------------------------------------------------- //
function teamRatings(teams: TeamRow[]) {
  const withGames = teams.filter((t) => t.team && z(t.games) > 0);
  const rs = withGames.map((t) => z(t.o_run) / z(t.games));
  const ra = withGames.map((t) => z(t.d_r) / z(t.games));
  const lgRg = (rs.reduce((a, b) => a + b, 0) + ra.reduce((a, b) => a + b, 0)) / (2 * withGames.length || 1);
  const out = new Map<string, { rs_per_game: number; ra_per_game: number; off_rating: number; def_rating: number }>();
  withGames.forEach((t, i) => {
    const rss = lgRg + DEFAULT_SHRINK * (rs[i] - lgRg);
    const ras = lgRg + DEFAULT_SHRINK * (ra[i] - lgRg);
    out.set(t.team as string, {
      rs_per_game: Number(rss.toFixed(2)), ra_per_game: Number(ras.toFixed(2)),
      off_rating: Math.round((100 * rss) / lgRg), def_rating: Math.round((100 * lgRg) / ras),
    });
  });
  return out;
}

function buildTeam(
  code: Franchise, rating: { rs_per_game: number; ra_per_game: number; off_rating: number; def_rating: number },
  batAggs: BatterAgg[], pitAggs: PitcherAgg[], lg: LeagueRates, c: Constants, lgFip: number, splits: Map<string, Split>,
) {
  const withPa = batAggs
    .map((a) => ({ a, pa: z(a.ab) + z(a.bb) + (splits.get(a.player_id)?.hbp ?? 0) }))
    .filter((x) => x.pa > 0)
    .sort((x, y) => y.pa - x.pa)
    .slice(0, POOL_SIZE);

  const pool: PoolBatter[] = [];
  for (const { a } of withPa) {
    const sp = splits.get(a.player_id);
    const rates = batterRates(a, lg, sp);
    if (!rates) continue;
    const line = batLine(a, sp);
    if ((!sp || (sp.h2 === 0 && sp.h3 === 0))) {
      // league-split the non-HR hits for wRC+/WAR line too (keep consistent w/ rates)
      const nonHr = Math.max(0, line.AB > 0 ? z(a.hit) - z(a.hr) : 0);
      line.B1 = nonHr * lg.hit_split_nonhr.b1; line.B2 = nonHr * lg.hit_split_nonhr.b2; line.B3 = nonHr * lg.hit_split_nonhr.b3;
    }
    pool.push({
      name: String(a.player_name ?? ""), pa: Math.round(line.PA),
      wrc_plus: Math.round(wrcPlus(line, c) ?? 100), war: Number((battingWar(line, c) ?? 0).toFixed(1)), rates,
    });
  }
  const order = pool.length >= 9 ? battingOrder(pool) : pool.map((_, i) => i);
  const staff = classifyStaff(pitAggs, lg, c, lgFip);

  const orderVecs = order.slice(0, 9).map((i) => pool[i].rates);
  const base = orderVecs.length === 9
    ? markovExpectedRuns(orderVecs, lg.event, lg.event, lg.event, 6, false, null, 1.0, HOME_FACTOR)
    : 0;
  const mu_calib = base > 0 ? Number((rating.rs_per_game / base).toFixed(4)) : 1.0;

  const meta = TEAM_NAMES[code];
  return {
    code, ko: meta.ko, en: meta.en, park: meta.park,
    rs_per_game: rating.rs_per_game, ra_per_game: rating.ra_per_game,
    off_rating: rating.off_rating, def_rating: rating.def_rating,
    mu_calib, batters: pool, lineup_projected: order,
    rotation: staff.rotation, bullpen_arms: staff.bullpen_arms,
    bullpen: staff.bullpen, bullpen_elite: staff.bullpen_elite,
  };
}

export function buildMatchupPayload(
  teamRows: TeamRow[], batterAggs: BatterAgg[], pitcherAggs: PitcherAgg[],
  splits: Map<string, Split>, c: Constants,
  opts: { season: number; runId: string; modelCommit?: string | null },
): MatchupData {
  const lg = leagueEventRates(teamRows);
  const lgFip = c.lg_FIP;
  const ratings = teamRatings(teamRows);

  const batByTeam = new Map<string, BatterAgg[]>();
  const pitByTeam = new Map<string, PitcherAgg[]>();
  for (const b of batterAggs) if (b.team) (batByTeam.get(b.team) ?? batByTeam.set(b.team, []).get(b.team)!).push(b);
  for (const p of pitcherAggs) if (p.team) (pitByTeam.get(p.team) ?? pitByTeam.set(p.team, []).get(p.team)!).push(p);

  const teams = FRANCHISES.filter((code) => ratings.has(code) && batByTeam.has(code))
    .map((code) => buildTeam(code, ratings.get(code)!, batByTeam.get(code) ?? [], pitByTeam.get(code) ?? [], lg, c, lgFip, splits))
    .sort((a, b) => b.off_rating - a.off_rating);

  return {
    version: "v2-live-boxscore",
    season: String(opts.season),
    method: "박스스코어 집계 전체 로스터 → base-out Markov 기대득점(타순 반영) → NegBinom 맞대결",
    league: {
      lg_R_per_G: c.lg_R_per_G, k: DISPERSION_K, home_factor: HOME_FACTOR,
      event: lg.event, hit_split_nonhr: lg.hit_split_nonhr,
    },
    teams,
    caveat: "Naver 박스스코어 전 경기 집계(전 구단 전체 로스터). 타순·로테이션은 모델링(예고선발/실라인업은 미제공). 포지션 미제공 → 라인업은 출전·가치순.",
    run_id: opts.runId,
    model_commit: opts.modelCommit ?? undefined,
  };
}

// --------------------------------------------------------------------------- //
// DB-backed build (reads the aggregate views) → store snapshot.               //
// --------------------------------------------------------------------------- //
export async function buildAndStoreMatchup(
  admin: SupabaseClient, season: number, teamRows: TeamRow[], c: Constants,
  opts: { runId: string; modelCommit?: string | null },
): Promise<{ teams: number } | null> {
  const [{ data: bat }, { data: pit }, { data: lb }] = await Promise.all([
    admin.from("kbo_boxscore_batter_totals").select("*").eq("season", season),
    admin.from("kbo_boxscore_pitcher_totals").select("*").eq("season", season),
    admin.from("kbo_hitter_stats").select("player_id, h2, h3, hp").eq("season", season),
  ]);
  if (!bat || bat.length === 0) return null; // no box scores yet — keep static

  const splits = new Map<string, Split>();
  for (const h of lb ?? []) splits.set(String(h.player_id), { h2: z(h.h2), h3: z(h.h3), hbp: z(h.hp) });

  const payload = buildMatchupPayload(
    teamRows, bat as unknown as BatterAgg[], (pit ?? []) as unknown as PitcherAgg[], splits, c,
    { season, runId: opts.runId, modelCommit: opts.modelCommit },
  );

  const { error } = await admin.from("kbo_sim_snapshots").upsert(
    { season, kind: "matchup", payload, run_id: opts.runId, model_commit: opts.modelCommit ?? null, generated_at: opts.runId },
    { onConflict: "season,kind" },
  );
  if (error) throw new Error(`upsert matchup snapshot: ${error.message}`);
  return { teams: payload.teams.length };
}
