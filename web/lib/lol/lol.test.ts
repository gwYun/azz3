import { describe, expect, it } from "vitest";
import { fitLol, seriesOutcomes, mapWinProb } from "./model";
import type { LolMatchRow } from "./data";
import { simulateWorlds, stageOf, swissBestOf } from "./worlds-sim";
import { reportDay } from "./articles";

const row = (o: Partial<LolMatchRow> & { game_id: string; start_at: string }): LolMatchRow => ({
  top_league: "world_championship", league_id: "world_championship_2026", title: "스위스 1R", status: "RESULT",
  best_of: 1, home_team: "A", away_team: "B", home_name: null, away_name: null, home_code: null, away_code: null,
  home_score: 1, away_score: 0, stadium: null, ...o,
});

describe("seriesOutcomes", () => {
  it("Bo1 is the map probability", () => {
    expect(seriesOutcomes(0.7, 1).pA).toBeCloseTo(0.7, 10);
  });
  it("Bo3/Bo5 match the closed forms and sum to 1", () => {
    const p = 0.6;
    const bo3 = seriesOutcomes(p, 3);
    expect(bo3.pA).toBeCloseTo(p * p * (3 - 2 * p), 10);
    expect(bo3.scores.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 10);
    const bo5 = seriesOutcomes(p, 5);
    expect(bo5.pA).toBeCloseTo(p ** 3 * (1 + 3 * (1 - p) + 6 * (1 - p) ** 2), 10);
    expect(bo5.scores).toHaveLength(6);
  });
  it("continues from a live score", () => {
    expect(seriesOutcomes(0.5, 5, { a: 2, b: 0 }).pA).toBeCloseTo(7 / 8, 10);
    expect(seriesOutcomes(0.5, 5, { a: 3, b: 1 }).pA).toBe(1);
  });
});

describe("fitLol", () => {
  it("ranks the team that wins more maps higher and stays finite", () => {
    const series = Array.from({ length: 20 }, (_, i) => ({ t: i * 86_400_000, home: "X", away: "Y", homeMaps: 2, awayMaps: i % 3 === 0 ? 1 : 0 }));
    const fit = fitLol(series, new Map([["X", "LCK"], ["Y", "LCK"]]), 30 * 86_400_000);
    const p = mapWinProb(fit, "X", "Y");
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThan(0.99);
  });
});

describe("worlds sim", () => {
  it("parses stages and Swiss best-of", () => {
    expect(stageOf("스위스 3R")).toEqual({ kind: "swiss", round: 3 });
    expect(stageOf("8강").kind).toBe("qf");
    expect(stageOf("결승전").kind).toBe("final");
    expect(swissBestOf(3, 1, 1)).toBe(1);
    expect(swissBestOf(3, 2, 0)).toBe(3);
  });

  it("produces a coherent bracket from R1 alone", () => {
    const teams = Array.from({ length: 16 }, (_, i) => `T${i}`);
    const r1 = Array.from({ length: 8 }, (_, i) =>
      row({ game_id: `g${i}`, start_at: `2026-10-23T1${i % 10}:00:00Z`, home_team: teams[2 * i], away_team: teams[2 * i + 1] }));
    const res = simulateWorlds(r1, () => 0.5, { sims: 2000 });
    const sum = (k: "advance" | "semis" | "final" | "champion") => res.teams.reduce((s, t) => s + t[k], 0);
    expect(sum("advance")).toBeCloseTo(800, 0);
    expect(sum("semis")).toBeCloseTo(400, 0);
    expect(sum("final")).toBeCloseTo(200, 0);
    expect(sum("champion")).toBeCloseTo(100, 0);
    // R1 winners (1-0) must advance more often than R1 losers.
    const w = res.teams.find((t) => t.team === "T0")!;
    const l = res.teams.find((t) => t.team === "T1")!;
    expect(w.advance).toBeGreaterThan(l.advance);
  });
});

describe("reportDay", () => {
  const day1a = row({ game_id: "a", start_at: "2026-10-25T17:00:00Z" }); // 10-26 02:00 KST
  const day1b = row({ game_id: "b", start_at: "2026-10-25T22:00:00Z", status: "BEFORE", home_score: 0, away_score: 0 });
  const day2 = row({ game_id: "c", start_at: "2026-10-26T17:00:00Z", status: "BEFORE", home_score: 0, away_score: 0 });

  it("waits while the day's last series is still to come", () => {
    expect(reportDay([day1a, day1b, day2], new Date("2026-10-25T23:00:00Z"))).toBeNull();
  });
  it("reports the day as soon as its last series is final", () => {
    const done = { ...day1b, status: "RESULT", home_score: 2, away_score: 1 };
    expect(reportDay([day1a, done, day2], new Date("2026-10-26T01:00:00Z"))).toBe("2026-10-26");
    // Next KST day has begun on the calendar but no series has started → still the previous day.
    expect(reportDay([day1a, done, day2], new Date("2026-10-26T16:00:00Z"))).toBe("2026-10-26");
  });
});
