import { describe, expect, it } from "vitest";
import { fitModel, lambdas, outcomeProbs, type TrainGame } from "./match-model";
import { buildTable, rankTable, simulateSeason } from "./season-sim";
import { kickoffMs } from "./predictions";
import { kickoffLabel, predictionHit, teamView } from "./articles";
import { renderSoccerArticle, buildTitle } from "./article-template";
import { fallbackSoccerProse } from "./llm";
import type { SoccerBrief } from "./article-types";

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(l: number, r: () => number) {
  let k = 0, p = 1;
  const L = Math.exp(-l);
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

/** Synthetic league: true log-rate = 0.25 + 0.2 (home) + 0.3·r_home − 0.2·r_away. */
function synthetic(nRounds = 12): TrainGame[] {
  const r = mulberry(7);
  const teams = Array.from({ length: 10 }, (_, i) => ({ code: `T${i}`, rating: (i - 4.5) / 3 }));
  const out: TrainGame[] = [];
  let day = 0;
  for (let k = 0; k < nRounds; k++) {
    for (const h of teams) for (const a of teams) {
      if (h === a) continue;
      const lh = Math.exp(0.25 + 0.2 + 0.3 * h.rating - 0.2 * a.rating);
      const la = Math.exp(0.25 + 0.3 * a.rating - 0.2 * h.rating);
      const date = new Date(Date.UTC(2025, 0, 1) + (day++ % 300) * 86_400_000).toISOString().slice(0, 10);
      out.push({ home: h.code, away: a.code, hs: poisson(lh, r), as: poisson(la, r), date, rHome: h.rating, rAway: a.rating });
    }
  }
  return out;
}

describe("soccer match model", () => {
  it("recovers home advantage and value coefficients from synthetic data", () => {
    const fit = fitModel(synthetic(), "hybrid", "2026-01-01", { xi: 0 });
    expect(fit.home).toBeCloseTo(0.2, 1);
    expect(fit.betaA).toBeGreaterThan(0.2);
    expect(fit.betaA).toBeLessThan(0.4);
    expect(fit.betaD).toBeGreaterThan(0.1);
    expect(fit.betaD).toBeLessThan(0.3);
  });

  it("results model ignores ratings; unseen teams fall back to league average", () => {
    const fit = fitModel(synthetic(4), "results", "2026-01-01");
    expect(fit.betaA).toBe(0);
    const [lh, la] = lambdas(fit, "NEW1", "NEW2", 5, -5);
    expect(lh / la).toBeCloseTo(Math.exp(fit.home), 6);
  });

  it("outcome probabilities sum to 1 and favour the stronger side", () => {
    const p = outcomeProbs(2.0, 0.8, -0.1);
    expect(p.pHome + p.pDraw + p.pAway).toBeCloseTo(1, 9);
    expect(p.pHome).toBeGreaterThan(p.pAway);
    const even = outcomeProbs(1.3, 1.3, 0);
    expect(even.pHome).toBeCloseTo(even.pAway, 9);
  });
});

describe("soccer season sim", () => {
  it("fixes banked points and returns consistent distributions", () => {
    const table = buildTable(["A", "B", "C"], [
      { home: "A", away: "B", hs: 3, as: 0 },
      { home: "B", away: "C", hs: 1, as: 1 },
    ]);
    // B and C both have 1 pt; C ranks higher on goal difference (0 vs −3).
    expect(rankTable([...table.values()]).map((r) => r.team)).toEqual(["A", "C", "B"]);
    const sim = simulateSeason(table, [{ home: "C", away: "A", lh: 1.2, la: 1.2 }], { top: 1, bottom: 1 }, { sims: 4000 });
    const a = sim.get("A")!;
    expect(a.rankDist.reduce((x, y) => x + y, 0)).toBeCloseTo(100, 0);
    expect(a.title).toBeGreaterThan(sim.get("B")!.title); // A is 3 pts clear with one game left
    expect(sim.get("B")!.title).toBe(0); // B has no games left and trails A
  });
});

describe("soccer season sim — split format", () => {
  it("ranks teams inside their post-split group", () => {
    const teams = Array.from({ length: 12 }, (_, i) => `T${i}`);
    // T0..T5 far ahead on points: the top group is fixed before the split.
    const results = teams.slice(0, 6).flatMap((h, i) =>
      teams.slice(6).map((a) => ({ home: h, away: a, hs: 2 + (i % 2), as: 0 })),
    );
    const table = buildTable(teams, results);
    const sim = simulateSeason(table, [], { top: 4, bottom: 1 }, {
      sims: 2000,
      split: { groupSize: 6, lam: () => [1.3, 1.1] },
    });
    for (const t of teams.slice(6)) {
      expect(sim.get(t)!.rankDist.slice(0, 6).reduce((a, b) => a + b, 0)).toBe(0); // never above 7th
    }
    for (const t of teams.slice(0, 6)) expect(sim.get(t)!.bottom).toBe(0);
  });
});

describe("soccer report helpers", () => {
  it("undoes the KST-as-UTC kickoff storage", () => {
    // Man Utd v Fulham 2024-08-16 20:00 BST = 19:00 UTC, stored as 04:00+00 (KST wall clock).
    const ms = kickoffMs({ kickoff: "2024-08-17T04:00:00+00:00", game_date: "2024-08-17" });
    expect(new Date(ms).toISOString()).toBe("2024-08-16T19:00:00.000Z");
    expect(kickoffLabel({ kickoff: "2024-08-17T04:00:00+00:00", game_date: "2024-08-17" })).toBe("08/17(토) 04:00");
  });

  it("re-expresses a prediction from the away side", () => {
    const row = { game_id: "g", home_team: "H", p_home: 0.5, p_draw: 0.3, p_away: 0.2, xg_home: 1.6, xg_away: 0.9, top_score: "2-1" };
    const away = teamView(row, "A");
    expect(away).toMatchObject({ win: 20, draw: 30, loss: 50, xgFor: 0.9, xgAgainst: 1.6, topScore: "1-2" });
    expect(predictionHit(away, "L")).toBe(true);
    expect(predictionHit(away, "W")).toBe(false);
  });
});

const brief: SoccerBrief = {
  league: "epl", leagueKo: "프리미어리그", season: 2026, date: "2026-10-07", team: "1", ko: "아스널<script>",
  model: "hybrid", zones: { top: 4, bottom: 3 }, remainingFixtures: 330,
  standings: { rank: 2, played: 7, w: 5, d: 1, l: 1, gf: 14, ga: 6, pts: 16, gapLeader: 2, lastFive: "WWDWL" },
  review: { gameId: "r", date: "2026-10-05", opp: "첼시", oppCode: "2", home: true, teamScore: 2, oppScore: 1, result: "W",
    pred: { win: 55.1, draw: 24.0, loss: 20.9, xgFor: 1.7, xgAgainst: 1.0, topScore: "1-0" }, hit: true },
  preview: { gameId: "n", date: "2026-10-18", kickoffKst: "10/18(일) 23:00", opp: "리버풀", oppCode: "3", home: false,
    pred: { win: 33.3, draw: 26.0, loss: 40.7, xgFor: 1.2, xgAgainst: 1.5, topScore: "1-1" }, oppRank: 1, oppPts: 18, oppLastFive: "WWWWD" },
  sim: { title: 21.4, top: 77.7, bottom: 0.4, expPts: 74.2, trendTop: 3.1, trendBottom: -0.2 },
  value: { rank: 3, of: 20 }, seasonStats: { xg: 13.2, xga: 6.9, possession: 56 },
  topPlayers: [{ name: "사카", position: "FW", goals: 5, assists: 3, xg: 4.1 }],
  table: [{ rank: 1, code: "3", name: "리버풀", played: 7, pts: 18, gd: 10, top: 85, bottom: 0.1 }],
};

describe("soccer report render", () => {
  it("keeps model numbers out of the public title/teaser and escapes text", () => {
    const r = renderSoccerArticle(brief, fallbackSoccerProse(brief));
    expect(buildTitle(brief)).not.toMatch(/%/);
    expect(JSON.stringify(r.teaser)).not.toMatch(/%/);
    expect(r.bodyHtml).toContain("33.3");
    expect(r.bodyHtml).not.toContain("<script>");
    expect(r.bodyHtml).toContain("예측 적중");
  });
});
