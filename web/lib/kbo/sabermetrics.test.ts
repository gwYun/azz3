import { describe, it, expect } from "vitest";
import fx from "./__fixtures__/sabermetrics-parity.json";
import {
  woba, wraa, wrcPlus, battingWar, fip, pitchingWar, constantsFromTotals,
  type Constants, type BatLine, type PitLine,
  type LeagueBatTotals, type LeaguePitTotals,
} from "./sabermetrics";

// The fixture was produced by the Python reference (kbo/src/sabermetrics +
// league_constants). Given identical inputs + constants, the TS port must match.
const C = fx.constants as unknown as Constants;

describe("constantsFromTotals — matches Python league_constants", () => {
  const lt = fx.league_totals;
  const got = constantsFromTotals(
    2026,
    lt.bat as LeagueBatTotals,
    lt.pit as LeaguePitTotals,
    lt.team_games_total,
  );
  const keys: (keyof Constants)[] = [
    "lg_wOBA", "wOBA_scale", "lg_OBP", "lg_R_per_PA", "lg_R_per_G",
    "lg_ERA", "lg_FIP", "FIP_const", "RPW",
  ];
  for (const k of keys) {
    it(`${k}`, () => {
      expect(got[k]).toBeCloseTo(C[k] as number, 4);
    });
  }
});

describe("batting metrics — parity with Python", () => {
  for (const b of fx.batters) {
    const line = b.in as unknown as BatLine;
    it(`${b.label}: wOBA`, () => {
      const v = woba(line, C);
      if (b.woba == null) expect(v).toBeNull();
      else expect(v!).toBeCloseTo(b.woba, 8);
    });
    it(`${b.label}: wRAA / wRC+ / WAR`, () => {
      if (b.war == null) {
        expect(wraa(line, C)).toBeNull();
        expect(wrcPlus(line, C)).toBeNull();
        expect(battingWar(line, C)).toBeNull();
        return;
      }
      expect(wraa(line, C)!).toBeCloseTo(b.wraa!, 6);
      expect(wrcPlus(line, C)!).toBeCloseTo(b.wrc_plus!, 6);
      expect(battingWar(line, C)!).toBeCloseTo(b.war, 6);
    });
  }
});

describe("pitching metrics — parity with Python", () => {
  for (const p of fx.pitchers) {
    const line = p.in as unknown as PitLine;
    it(`${p.label}: FIP / WAR`, () => {
      if (p.fip == null) {
        expect(fip(line, C)).toBeNull();
        expect(pitchingWar(line, C)).toBeNull();
        return;
      }
      expect(fip(line, C)!).toBeCloseTo(p.fip, 8);
      expect(pitchingWar(line, C)!).toBeCloseTo(p.war!, 6);
    });
  }
});
