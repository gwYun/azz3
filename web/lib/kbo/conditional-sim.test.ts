import { describe, it, expect } from "vitest";
import { simulateRemaining, type CondTeam } from "./conditional-sim";

const CODES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function teams(overrides: Record<string, Partial<CondTeam>> = {}): CondTeam[] {
  return CODES.map((c) => ({ team: c, wins: 50, losses: 50, rsRate: 5, raRate: 5, ...overrides[c] }));
}

/** remainingHome[i][j] = g games (i hosts j), 0 on the diagonal. */
const remAll = (g: number): number[][] =>
  CODES.map((_, i) => CODES.map((_, j) => (i === j ? 0 : g)));

describe("simulateRemaining", () => {
  it("conserves the 5 playoff spots (Σ playoff ≈ 500, Σ first ≈ 100)", () => {
    const res = simulateRemaining(teams(), remAll(2), { sims: 4000, seed: 42 });
    const vals = [...res.values()];
    expect(vals.reduce((a, r) => a + r.playoff, 0)).toBeCloseTo(500, 0);
    expect(vals.reduce((a, r) => a + r.first, 0)).toBeCloseTo(100, 0);
  });

  it("a big current lead ⇒ near-certain playoff; a big deficit ⇒ near-zero", () => {
    const res = simulateRemaining(
      teams({ A: { wins: 90, losses: 10 }, J: { wins: 10, losses: 90 } }),
      remAll(2),
      { sims: 4000, seed: 1 },
    );
    expect(res.get("A")!.playoff).toBeGreaterThan(99);
    expect(res.get("J")!.playoff).toBeLessThan(1);
  });

  it("no remaining games ⇒ standings frozen (top 5 by record clinch)", () => {
    // Strictly decreasing win% so the ranking is unambiguous.
    const t: CondTeam[] = CODES.map((c, i) => ({
      team: c,
      wins: 60 - i * 3,
      losses: 40 + i * 3,
      rsRate: 5,
      raRate: 5,
    }));
    const res = simulateRemaining(t, remAll(0), { sims: 1000, seed: 3 });
    for (const c of ["A", "B", "C", "D", "E"]) expect(res.get(c)!.playoff).toBe(100);
    for (const c of ["F", "G", "H", "I", "J"]) expect(res.get(c)!.playoff).toBe(0);
  });

  it("is deterministic for a fixed seed", () => {
    const a = simulateRemaining(teams(), remAll(3), { sims: 1500, seed: 7 });
    const b = simulateRemaining(teams(), remAll(3), { sims: 1500, seed: 7 });
    expect(a).toEqual(b);
  });
});
