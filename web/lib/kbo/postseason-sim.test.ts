import { describe, expect, it } from "vitest";
import { gameWinProb, hostOf, seriesStates, simulatePostseason, type PsTeam } from "./postseason-sim";
import { postseasonRound, isRegularSeasonGame } from "./postseason-ids";
import { buildPsTeaser, buildPsTitle, fallbackPsProse, renderPs, type PsBrief } from "./postseason-articles";

const seeds = ["KT", "SS", "HT", "LG", "OB"];
const even: PsTeam[] = seeds.map((team) => ({ team, rsRate: 5, raRate: 5 }));
const LG = 5;

describe("postseason ids", () => {
  it("maps Naver round prefixes and tells regular-season ids apart", () => {
    expect(postseasonRound("44441014OBLG02026")).toBe("WC");
    expect(postseasonRound("77771026HHLG02025")).toBe("KS");
    expect(postseasonRound("20261004WOHH02026")).toBeNull();
    expect(isRegularSeasonGame("20261004WOHH02026", 2026)).toBe(true);
    expect(isRegularSeasonGame("44441014OBLG02026", 2026)).toBe(false);
  });
});

describe("postseason sim", () => {
  it("gives seed 4 the wild-card edge: 1 − (1 − p)²", () => {
    const res = simulatePostseason(seeds, even, LG, [], { sims: 40000 });
    const p = gameWinProb(even[3], even[4], LG);
    expect(res.series[0].pHigher).toBeCloseTo(100 * (1 - (1 - p) ** 2), 0);
    const total = res.teams.reduce((a, t) => a + t.champion, 0);
    expect(total).toBeGreaterThan(99.5);
    expect(total).toBeLessThan(100.5);
  });

  it("fixes decided series and continues a live one from its real state", () => {
    const games = [
      { round: "WC" as const, home: "LG", away: "OB", homeScore: 2, awayScore: 5 },
      { round: "WC" as const, home: "LG", away: "OB", homeScore: 1, awayScore: 3 }, // OB wins both → advances
      { round: "SPO" as const, home: "HT", away: "OB", homeScore: 6, awayScore: 1 },
    ];
    const states = seriesStates(seeds, games);
    expect(states[0].winner).toBe("OB");
    expect(states[1]).toMatchObject({ higher: "HT", lower: "OB", higherWins: 1, lowerWins: 0, winner: null });
    const res = simulatePostseason(seeds, even, LG, games, { sims: 20000 });
    const lg = res.teams.find((t) => t.team === "LG")!;
    expect(lg.alive).toBe(false);
    expect(lg.champion).toBe(0);
    expect(res.teams.find((t) => t.team === "OB")!.reachSPO).toBe(100);
    expect(res.series[1].pHigher).toBeGreaterThan(55); // up 1-0 in a best-of-5
  });

  it("follows the 2-2-1 / 2-3-2 home patterns", () => {
    expect([0, 1, 2, 3, 4].map((n) => hostOf("SPO", n, "H", "L"))).toEqual(["H", "H", "L", "L", "H"]);
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => hostOf("KS", n, "H", "L"))).toEqual(["H", "H", "L", "L", "L", "H", "H"]);
  });
});

const brief: PsBrief = {
  season: 2026, date: "2026-10-15", round: "WC", roundKo: "와일드카드 결정전", format: "최대 2경기 · 4위 1승 어드밴티지",
  higher: { code: "LG", ko: "LG<b>", seed: 4, wins: 0, needs: 1 },
  lower: { code: "OB", ko: "두산", seed: 5, wins: 1, needs: 1 },
  winner: null,
  review: { gameId: "g1", date: "2026-10-14", gameNo: 1, home: "LG", away: "OB", homeKo: "LG", awayKo: "두산", homeScore: 2, awayScore: 5,
    winnerKo: "두산", pred: { homeWin: 50.8, projHome: 4.9, projAway: 4.7 }, hit: false },
  today: { gameId: "g2", gameNo: 2, home: "LG", away: "OB", homeKo: "LG", awayKo: "두산", stadium: "잠실", pred: { homeWin: 50.8, projHome: 4.9, projAway: 4.7 } },
  seriesProb: { higher: 50.8, lower: 49.2 },
  bracket: [{ round: "WC", roundKo: "와일드카드 결정전", higherKo: "LG", lowerKo: "두산", higherWins: 0, lowerWins: 1, winnerKo: null }],
  teams: [{ code: "LG", ko: "LG", seed: 4, reachKS: 9.1, champion: 3.1, alive: true }],
  ratings: { LG: { off: 101, def: 99, record: "78승 65패 1무" }, OB: { off: 98, def: 102, record: "73승 66패 5무" } },
};

describe("postseason report render", () => {
  it("keeps probabilities out of public title/teaser and escapes names", () => {
    const r = renderPs(brief, fallbackPsProse(brief));
    expect(buildPsTitle(brief)).not.toMatch(/%/);
    expect(JSON.stringify(buildPsTeaser(brief))).not.toMatch(/%/);
    expect(r.bodyHtml).toContain("50.8");
    expect(r.bodyHtml).toContain("예측 빗나감");
    expect(r.bodyHtml).not.toContain("LG<b>");
  });
});

describe("josa", () => {
  it("picks particles by final consonant", async () => {
    const { josa } = await import("./postseason-articles");
    expect(josa("두산", "은/는")).toBe("두산은");
    expect(josa("KIA", "이/가")).toBe("KIA가");
    expect(josa("LG", "은/는")).toBe("LG는");
    expect(josa("와일드카드 결정전", "은/는")).toBe("와일드카드 결정전은");
    expect(josa("LG 0승 · 두산 1승", "으로/로")).toBe("LG 0승 · 두산 1승으로");
    expect(josa("한국시리즈", "을/를")).toBe("한국시리즈를");
  });
});
