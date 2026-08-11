import { describe, it, expect } from "vitest";
import { simulateSeason, expectedRuns, HOME_FACTOR, type TeamRate } from "./season-sim";

// One clearly-strong team; the rest league-average.
const TEAMS: TeamRate[] = [
  { team: "STRONG", rsRate: 6.0, raRate: 4.0 },
  ...["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((t) => ({
    team: t, rsRate: 5.0, raRate: 5.0,
  })),
];

describe("expectedRuns — log5 + home factor", () => {
  it("matches rs*ra/lg with home boost", () => {
    expect(expectedRuns(6, 4, 5, true)).toBeCloseTo((6 * 4) / 5 * HOME_FACTOR, 6);
    expect(expectedRuns(6, 4, 5, false)).toBeCloseTo((6 * 4) / 5, 6);
  });
});

describe("simulateSeason", () => {
  const res = simulateSeason(TEAMS, { sims: 6000, seed: 42 });

  it("ranks the strong team first with the best odds", () => {
    expect(res[0].team).toBe("STRONG");
    expect(res[0].proj_wins).toBeGreaterThan(res[1].proj_wins);
    expect(res[0].championship).toBeGreaterThan(res[1].championship);
    expect(res[0].off_rating).toBeGreaterThan(100);
    expect(res[0].def_rating).toBeGreaterThan(100);
  });

  it("probabilities conserve across the league", () => {
    const sum = (k: "first" | "playoff" | "championship" | "pennant") =>
      res.reduce((a, r) => a + r[k], 0);
    expect(sum("first")).toBeCloseTo(100, 0); // exactly one 1st per sim
    expect(sum("playoff")).toBeCloseTo(500, 0); // 5 postseason spots
    expect(sum("championship")).toBeCloseTo(100, 0);
    expect(sum("pennant")).toBeCloseTo(200, 0); // 2 KS participants
  });

  it("projected wins are in a sane 144-game range", () => {
    for (const r of res) {
      expect(r.proj_wins).toBeGreaterThan(30);
      expect(r.proj_wins).toBeLessThan(120);
    }
    const totalWins = res.reduce((a, r) => a + r.proj_wins, 0);
    expect(totalWins).toBeGreaterThan(600); // ~720 minus ties
    expect(totalWins).toBeLessThan(720);
  });

  it("is deterministic for a fixed seed", () => {
    const a = simulateSeason(TEAMS, { sims: 1500, seed: 7 });
    const b = simulateSeason(TEAMS, { sims: 1500, seed: 7 });
    expect(a).toEqual(b);
  });
});
