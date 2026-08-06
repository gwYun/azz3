import { describe, it, expect } from "vitest";
import fx from "./__fixtures__/markov-parity.json";
import {
  markovExpectedRuns, negBinomPmf, winProbExact, matchupDist, rateVec, bullpenForGame,
  type Rates, type Reliever, type Segment,
} from "./matchup-sim";

const HOME_FACTOR = 1.086; // baked into the Python reference that produced the fixture (pooled-recalibrated)

// Cross-language parity: the TS engine must reproduce the Python reference μ
// (kbo/src/matchup_export.markov_expected_runs) to floating-point precision.
describe("markov parity with python reference", () => {
  for (const c of fx.cases) {
    it(`matches python μ for ${c.label}`, () => {
      const mu = markovExpectedRuns(
        c.order as Rates[], c.sp as Rates, c.pen as Rates, fx.lg_event as Rates,
        c.sp_innings, c.home, (c.elite as Rates | null), c.calib, HOME_FACTOR,
      );
      expect(mu).toBeCloseTo(c.mu, 6);
    });
  }
});

describe("engine properties", () => {
  const lg = fx.lg_event as Rates;

  it("negBinom PMF is a valid distribution", () => {
    const pmf = negBinomPmf(4.8, 3.70, 25);
    const sum = Array.from(pmf).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(Array.from(pmf).every((p) => p >= 0)).toBe(true);
  });

  it("win probability is in [0,1] and complementary", () => {
    const p = winProbExact(5.2, 4.3, 3.70);
    expect(p).toBeGreaterThan(0.5); // higher-scoring team favored
    expect(p).toBeLessThan(1);
    const q = winProbExact(4.3, 5.2, 3.70);
    expect(p + q).toBeCloseTo(1, 6);
  });

  it("even matchup is a coin flip", () => {
    expect(winProbExact(4.7, 4.7, 3.70)).toBeCloseTo(0.5, 6);
  });

  it("log5 suppresses HR share vs a tougher pitcher", () => {
    const b = rateVec(lg), l = rateVec(lg);
    const tough = rateVec(lg); tough[4] *= 0.4;
    expect(matchupDist(b, tough, l)[4]).toBeLessThan(matchupDist(b, rateVec(lg), l)[4]);
  });
});

describe("bullpen availability model", () => {
  const lg = fx.lg_event as Rates;
  const arms: Reliever[] = [0, 1, 2, 3, 4, 5].map((i) => ({ name: `r${i}`, fip: 3 + i * 0.3, ip: 20, war: 0, rates: lg }));
  const fallback: Segment = { fip: 4.5, rates: lg };

  it("all arms available for game 1", () => {
    const s = bullpenForGame(arms, 0, fallback);
    expect(s.down.length).toBe(0);
    expect(s.available.length).toBe(arms.length);
    expect(s.eliteRates).toEqual(arms[0].rates);       // closer available
  });

  it("top arms rest on game 2 (excludes the previous game's bullpen)", () => {
    const s = bullpenForGame(arms, 1, fallback);
    expect(s.down.length).toBeGreaterThan(0);
    expect(s.down.map((a) => a.name)).toContain("r0"); // closer threw game 1 → resting
  });

  it("empty arms fall back to the static composite", () => {
    const s = bullpenForGame([], 3, fallback);
    expect(s.rates).toEqual(fallback.rates);
  });
});
