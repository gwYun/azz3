import { describe, it, expect } from "vitest";
import { kboIpToDecimal, num } from "./util";
import { resolveFranchise } from "./franchise";
import { mapGame, mapTeam, mapHitter, mapPitcher, leagueConstants } from "./ingest";
import type { NaverTeamStat } from "./naver";

describe("kboIpToDecimal — KBO .1/.2 = thirds", () => {
  it("passes whole innings through", () => {
    expect(kboIpToDecimal(5)).toBe(5);
  });
  it("converts one third", () => {
    expect(kboIpToDecimal(5.1)!).toBeCloseTo(5.3333, 4);
  });
  it("converts two thirds", () => {
    expect(kboIpToDecimal(5.2)!).toBeCloseTo(5.6667, 4);
  });
  it("converts a big team total (875.1 = 875 1/3)", () => {
    expect(kboIpToDecimal(875.1)!).toBeCloseTo(875.3333, 4);
  });
  it("null/NaN → null", () => {
    expect(kboIpToDecimal(null)).toBeNull();
    expect(kboIpToDecimal(undefined)).toBeNull();
    expect(num("nope")).toBeNull();
  });
});

describe("resolveFranchise", () => {
  it("passes canonical codes", () => {
    expect(resolveFranchise("KT")).toBe("KT");
    expect(resolveFranchise("wo")).toBe("WO");
  });
  it("maps known aliases", () => {
    expect(resolveFranchise("SSG")).toBe("SK");
    expect(resolveFranchise("넥센")).toBe("WO");
  });
  it("rejects non-KBO codes", () => {
    expect(resolveFranchise("ALLSTAR")).toBeNull();
    expect(resolveFranchise(null)).toBeNull();
    expect(resolveFranchise("")).toBeNull();
  });
});

describe("mapGame", () => {
  it("maps a completed game and derives the winner from scores", () => {
    const row = mapGame(
      {
        gameId: "20260801HHKT02026",
        gameDate: "2026-08-01",
        stadium: "수원",
        awayTeamCode: "HH",
        homeTeamCode: "KT",
        awayTeamScore: 4,
        homeTeamScore: 7,
        statusCode: "RESULT",
      },
      2026,
    )!;
    expect(row.home_team).toBe("KT");
    expect(row.away_team).toBe("HH");
    expect(row.winner).toBe("HOME");
    expect(row.home_score).toBe(7);
    expect(row.status).toBe("RESULT");
  });

  it("leaves winner null for an unplayed game", () => {
    const row = mapGame(
      { gameId: "x", gameDate: "2026-08-02", awayTeamCode: "HT", homeTeamCode: "NC", statusCode: "BEFORE" },
      2026,
    )!;
    expect(row.winner).toBeNull();
    expect(row.home_score).toBeNull();
  });

  it("drops non-KBO games (unknown team code)", () => {
    expect(
      mapGame({ gameId: "as", gameDate: "2026-07-05", awayTeamCode: "NANE", homeTeamCode: "DREAM" }, 2026),
    ).toBeNull();
  });
});

describe("mapTeam", () => {
  it("maps team stats and converts defense innings", () => {
    const row = mapTeam(
      {
        teamId: "KT", ranking: 1, gameCount: 98, winGameCount: 60, loseGameCount: 36, drawnGameCount: 2,
        wra: 0.625, offenseRun: 551, offenseH2: 155, offenseH3: 15, offenseBbhp: 460,
        defenseEra: 4.41089, defenseEr: 429, defenseInning: 875.1,
      },
      2026,
    )!;
    expect(row.team).toBe("KT");
    expect(row.ranking).toBe(1);
    expect(row.o_run).toBe(551);
    expect(row.d_inning!).toBeCloseTo(875.3333, 3); // 875.1 KBO → true thirds
  });
});

describe("mapHitter", () => {
  it("keeps raw counts + Naver cross-check, leaves in-house metrics null", () => {
    const row = mapHitter(
      {
        playerId: "54529", playerName: "레이예스", teamId: "LT",
        hitterAb: 401, hitterHit: 140, hitterH2: 25, hitterH3: 2, hitterHr: 13,
        hitterBb: 38, hitterHp: 2, hitterKk: 50, hitterWoba: 0.407, hitterWar: 3.94,
        isQualified: true,
      },
      2026,
    );
    expect(row.team).toBe("LT");
    expect(row.ab).toBe(401);
    expect(row.h2).toBe(25);
    expect(row.naver_war).toBe(3.94);
    expect(row.war).toBeNull(); // recomputed in P2
    expect(row.source).toBe("naver_players");
  });
});

describe("mapPitcher", () => {
  it("converts innings and carries Naver era/war as cross-check", () => {
    const row = mapPitcher(
      {
        playerId: "65516", playerName: "배제성", teamId: "KT",
        pitcherInning: 5, pitcherEr: 4, pitcherKk: 3, pitcherBb: 2, pitcherHr: 2,
        pitcherEra: 4.72, pitcherWar: 0.5,
      },
      2026,
    );
    expect(row.team).toBe("KT");
    expect(row.inning).toBe(5);
    expect(row.er).toBe(4);
    expect(row.naver_era).toBe(4.72);
    expect(row.fip).toBeNull(); // no constants passed → not recomputed
  });
});

// Two synthetic teams whose totals sum to a plausible KBO league (each ~72 games,
// ~5 R/G, ~.277 avg, ~4.67 ERA). Ratios are what drive the constants.
const TEAM_TOTALS = {
  offenseRun: 365, offenseAb: 2500, offenseHit: 675, offenseH2: 130,
  offenseH3: 12, offenseHr: 72, offenseBbhp: 292,
  defenseEr: 335, defenseInning: 645.0, defenseHr: 72, defenseBbhp: 292, defenseKk: 490,
};
const TEAMS: NaverTeamStat[] = [
  { teamId: "KT", gameCount: 72, ...TEAM_TOTALS },
  { teamId: "LG", gameCount: 72, ...TEAM_TOTALS },
];

describe("leagueConstants + in-house recompute", () => {
  const teamRows = TEAMS.map((t) => mapTeam(t, 2026)).filter(
    (r): r is NonNullable<typeof r> => r != null,
  );
  const c = leagueConstants(teamRows, 2026);

  it("derives sane KBO constants from team totals", () => {
    expect(c.lg_R_per_G).toBeGreaterThan(4);
    expect(c.lg_R_per_G).toBeLessThan(6);
    expect(c.lg_wOBA).toBeGreaterThan(0.28);
    expect(c.lg_wOBA).toBeLessThan(0.38);
    expect(c.FIP_const).toBeGreaterThan(2.5);
    expect(c.RPW).toBeGreaterThan(9);
    // league-average FIP reconstructs to league ERA (the invariant)
    expect(c.lg_FIP).toBeCloseTo(c.lg_ERA, 4);
  });

  it("mapHitter WITH constants fills in-house metrics", () => {
    const row = mapHitter(
      {
        playerId: "54529", playerName: "레이예스", teamId: "LT",
        hitterAb: 401, hitterHit: 140, hitterH2: 25, hitterH3: 2, hitterHr: 13,
        hitterBb: 38, hitterHp: 2, hitterKk: 50, hitterWar: 3.94, hitterObp: 0.405,
      },
      2026,
      c,
    );
    expect(row.woba).not.toBeNull();
    expect(row.woba!).toBeGreaterThan(0.35); // strong hitter
    expect(row.war).not.toBeNull();
    expect(row.war!).toBeGreaterThan(0);
    // in-house OBP ≈ Naver's published OBP (SF≈0 approximation → within ~0.01)
    expect(row.obp!).toBeCloseTo(0.405, 2);
    expect(row.ops!).toBeCloseTo(row.obp! + row.slg!, 6);
  });

  it("mapPitcher WITH constants fills FIP/ERA/WAR", () => {
    const row = mapPitcher(
      {
        playerId: "1", playerName: "ace", teamId: "KT",
        pitcherInning: 120, pitcherEr: 40, pitcherHit: 100, pitcherKk: 130,
        pitcherBb: 30, pitcherHp: 5, pitcherHr: 10, pitcherEra: 3.0,
      },
      2026,
      c,
    );
    expect(row.era!).toBeCloseTo(3.0, 1); // 40*9/120 = 3.00
    expect(row.fip).not.toBeNull();
    expect(row.war).not.toBeNull();
    expect(row.whip!).toBeCloseTo((30 + 100) / 120, 3);
  });
});
