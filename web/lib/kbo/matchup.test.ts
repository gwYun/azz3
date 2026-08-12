import { describe, it, expect } from "vitest";
import { mapTeam, leagueConstants } from "./ingest";
import type { NaverTeamStat } from "./naver";
import {
  leagueEventRates, batterRates, pitcherRates, classifyStaff, battingOrder,
  buildMatchupPayload, type BatterAgg, type PitcherAgg, type Split,
} from "./matchup";

const TEAM_TOTALS = {
  offenseRun: 365, offenseAb: 2500, offenseHit: 675, offenseH2: 130,
  offenseH3: 12, offenseHr: 72, offenseBbhp: 292,
  defenseEr: 335, defenseInning: 645.0, defenseHr: 72, defenseBbhp: 292, defenseKk: 490,
};
const TEAMS: NaverTeamStat[] = [
  { teamId: "KT", gameCount: 72, ...TEAM_TOTALS },
  { teamId: "LG", gameCount: 72, ...TEAM_TOTALS },
];
const teamRows = TEAMS.map((t) => mapTeam(t, 2026)).filter((r): r is NonNullable<typeof r> => r != null);
const C = leagueConstants(teamRows, 2026);
const LG = leagueEventRates(teamRows);

const sum6 = (r: { bb: number; b1: number; b2: number; b3: number; hr: number; out: number }) =>
  r.bb + r.b1 + r.b2 + r.b3 + r.hr + r.out;

describe("leagueEventRates", () => {
  it("event rates form a simplex; hit split sums to 1", () => {
    expect(sum6(LG.event)).toBeCloseTo(1, 5);
    const s = LG.hit_split_nonhr;
    expect(s.b1 + s.b2 + s.b3).toBeCloseTo(1, 5);
    expect(LG.event.hr).toBeGreaterThan(0);
    expect(LG.event.out).toBeGreaterThan(0.5);
  });
});

describe("batterRates / pitcherRates", () => {
  const bat: BatterAgg = {
    player_id: "1", team: "KT", player_name: "슬러거", g: 100,
    ab: 400, hit: 140, hr: 30, bb: 60, kk: 90, sb: 3, run: 80, rbi: 95,
  };
  it("batter rates are a valid simplex and respond to leaderboard splits", () => {
    const rWithSplit = batterRates(bat, LG, { h2: 30, h3: 2, hbp: 5 })!;
    expect(sum6(rWithSplit)).toBeCloseTo(1, 5);
    expect(rWithSplit.hr).toBeGreaterThan(0.03); // 30 HR / ~465 PA, shrunk
    const rLeagueSplit = batterRates(bat, LG)!; // no split → league fallback
    expect(sum6(rLeagueSplit)).toBeCloseTo(1, 5);
  });
  it("returns null for a zero-PA batter", () => {
    expect(batterRates({ ...bat, ab: 0, bb: 0 }, LG)).toBeNull();
  });
  it("pitcher rates are a valid simplex", () => {
    const p: PitcherAgg = {
      player_id: "9", team: "KT", player_name: "에이스", g: 20, gs: 20,
      ip: 130, bf: 540, hit: 120, hr: 12, r: 45, er: 42, bb: 35, bbhp: 40, kk: 140,
    };
    const r = pitcherRates(p, LG)!;
    expect(sum6(r)).toBeCloseTo(1, 5);
    expect(r.out).toBeGreaterThan(0.6);
  });
});

describe("classifyStaff", () => {
  const pitchers: PitcherAgg[] = [
    // 5 starters (high ipg)
    ...[1, 2, 3, 4, 5].map((i) => ({
      player_id: `s${i}`, team: "KT", player_name: `SP${i}`, g: 20, gs: 20,
      ip: 130 - i * 8, bf: 540 - i * 30, hit: 120, hr: 12, r: 50, er: 46, bb: 35, bbhp: 40, kk: 120,
    })),
    // 6 relievers (low ipg)
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      player_id: `r${i}`, team: "KT", player_name: `RP${i}`, g: 50, gs: 0,
      ip: 55 - i * 5, bf: 230 - i * 20, hit: 45, hr: 4, r: 20, er: 18, bb: 18, bbhp: 20, kk: 60,
    })),
  ];
  const staff = classifyStaff(pitchers, LG, C, C.lg_FIP);
  it("builds a 5-man rotation and a valid bullpen composite", () => {
    expect(staff.rotation.length).toBe(5);
    expect(staff.rotation.every((r) => r.sp_innings >= 4.5 && r.sp_innings <= 6.5)).toBe(true);
    expect(sum6(staff.bullpen.rates)).toBeCloseTo(1, 4);
    expect(staff.bullpen_arms.length).toBeGreaterThan(0);
    // starters should be the high-IP arms
    expect(staff.rotation[0].name.startsWith("SP")).toBe(true);
  });
});

describe("battingOrder", () => {
  it("returns a permutation of 0..8", () => {
    const pool = Array.from({ length: 9 }, (_, i) => ({
      name: `b${i}`, pa: 400 - i, wrc_plus: 150 - i * 10, war: 3 - i * 0.2,
      rates: { bb: 0.1, b1: 0.15, b2: 0.04, b3: 0.005, hr: 0.03 + i * 0.001, out: 0.665 - i * 0.001 },
    }));
    const order = battingOrder(pool);
    expect(order.length).toBe(9);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("buildMatchupPayload (end-to-end)", () => {
  const batAggs: BatterAgg[] = Array.from({ length: 14 }, (_, i) => ({
    player_id: `b${i}`, team: "KT", player_name: `타자${i}`, g: 100 - i,
    ab: 450 - i * 25, hit: 130 - i * 6, hr: 25 - i, bb: 55 - i * 2, kk: 90, sb: 2, run: 70, rbi: 70 - i * 3,
  }));
  const pitAggs: PitcherAgg[] = [
    ...[1, 2, 3, 4, 5].map((i) => ({
      player_id: `sp${i}`, team: "KT", player_name: `선발${i}`, g: 20, gs: 20,
      ip: 130 - i * 8, bf: 540 - i * 30, hit: 120, hr: 12, r: 50, er: 46, bb: 35, bbhp: 40, kk: 120,
    })),
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      player_id: `rp${i}`, team: "KT", player_name: `불펜${i}`, g: 50, gs: 0,
      ip: 55 - i * 5, bf: 230 - i * 20, hit: 45, hr: 4, r: 20, er: 18, bb: 18, bbhp: 20, kk: 60,
    })),
  ];
  const splits = new Map<string, Split>([["b0", { h2: 28, h3: 2, hbp: 6 }]]);
  const payload = buildMatchupPayload(teamRows, batAggs, pitAggs, splits, C, { season: 2026, runId: "test" });

  it("produces a MatchupData with a fully-formed KT team", () => {
    expect(payload.teams.length).toBeGreaterThanOrEqual(1);
    const kt = payload.teams.find((t) => t.code === "KT")!;
    expect(kt).toBeTruthy();
    expect(kt.batters.length).toBeGreaterThanOrEqual(9);
    expect(kt.lineup_projected.length).toBe(9);
    expect(kt.rotation.length).toBe(5);
    expect(kt.bullpen_arms.length).toBeGreaterThan(0);
    expect(kt.mu_calib).toBeGreaterThan(0);
    expect(Number.isFinite(kt.mu_calib)).toBe(true);
    expect(kt.park).toBe("수원");
    expect(sum6(payload.league.event)).toBeCloseTo(1, 5);
  });
});
