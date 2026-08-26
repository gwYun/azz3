import { describe, it, expect } from "vitest";
import { renderArticle } from "./article-template";
import { fallbackProse } from "./llm";
import type { ArticleBrief } from "./article-types";

function brief(over: Partial<ArticleBrief> = {}): ArticleBrief {
  return {
    season: 2026,
    date: "2026-08-27",
    team: "HH",
    ko: "한화",
    en: "Hanwha Eagles",
    park: "대전",
    standings: {
      rank: 7,
      win: 49,
      lose: 59,
      draw: 3,
      pct: 49 / 108,
      gamesPlayed: 111,
      gamesRemaining: 33,
      gbLeader: 16.5,
      gbCut: 4.0,
      inPlayoffSpot: false,
      lastFive: "WLLWL",
      streak: "1패",
    },
    yesterday: { opp: "SSG", oppCode: "SK", home: false, stadium: "문학", teamScore: 1, oppScore: 6, result: "L" },
    today: { opp: "키움", oppCode: "WO", home: true, stadium: "대전", winProb: 58.4, projFor: 5.1, projAgainst: 4.3 },
    playoffPct: 0.9,
    firstPct: 0,
    powerPlayoffPct: 67.4,
    trendPlayoff: -0.7,
    offRating: 109.8,
    defRating: 95.9,
    topPlayer: { name: "문동주", kind: "pit", war: 3.2, metric: 3.45, metricLabel: "ERA" },
    ...over,
  };
}

describe("article template", () => {
  it("prints the premium numbers in the body but withholds them from teaser + title", () => {
    const b = brief();
    const r = renderArticle(b, fallbackProse(b));
    // The conditional 가을야구 % is the paid reveal — present in the gated body…
    expect(r.bodyHtml).toContain("0.9");
    // …but never in the public title or teaser.
    expect(r.title).not.toContain("0.9");
    expect(r.title).not.toContain("%");
    expect(JSON.stringify(r.teaser)).not.toContain("0.9");
    expect(r.teaser.heroLabel).toBeTruthy();
    expect(r.teaser.rank).toBe(7);
    expect(r.teaser.gamesRemaining).toBe(33);
  });

  it("escapes prose so the model can't inject markup", () => {
    const r = renderArticle(brief(), {
      lede: "<script>alert(1)</script>",
      recap: "x",
      preview: "y",
      outlook: "z",
    });
    expect(r.bodyHtml).not.toContain("<script>");
    expect(r.bodyHtml).toContain("&lt;script&gt;");
  });

  it("handles an off-day (no games) without throwing", () => {
    const b = brief({ yesterday: null, today: null });
    const r = renderArticle(b, fallbackProse(b));
    expect(r.bodyHtml).toContain("오늘 경기 없음");
  });

  it("fallbackProse returns four non-empty paragraphs", () => {
    const p = fallbackProse(brief());
    for (const k of ["lede", "recap", "preview", "outlook"] as const) {
      expect(typeof p[k]).toBe("string");
      expect(p[k].length).toBeGreaterThan(0);
    }
  });
});
