import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDailyArticles, kstDateStr } from "./articles";
import { FRANCHISES } from "./franchise";

/**
 * End-to-end pipeline test with a hand-rolled admin client (no DB, no network).
 * Exercises: standings from games → conditional sim → per-team brief → fallback
 * prose (no AI key) → render → upsert. Asserts 10 well-formed rows.
 */
beforeAll(() => {
  delete process.env.AI_GATEWAY_API_KEY; // force the deterministic prose fallback
});

type Game = {
  game_date: string;
  status: string;
  stadium: string | null;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  cancel: boolean;
  suspended: boolean;
};

function fixtureGames(): Game[] {
  const g: Game[] = [];
  // One round-robin of RESULTs so every team has a record + a played-home matrix.
  for (let i = 0; i < FRANCHISES.length; i++) {
    for (let j = 0; j < FRANCHISES.length; j++) {
      if (i === j) continue;
      g.push({
        game_date: "2026-05-01",
        status: "RESULT",
        stadium: "X",
        home_team: FRANCHISES[i],
        away_team: FRANCHISES[j],
        home_score: (i + 2) % 9,
        away_score: (j + 1) % 9,
        cancel: false,
        suspended: false,
      });
    }
  }
  // A game today (BEFORE) and a game yesterday (RESULT) for HH, to fire both branches.
  g.push({
    game_date: "2026-08-27",
    status: "BEFORE",
    stadium: "대전",
    home_team: "HH",
    away_team: "WO",
    home_score: null,
    away_score: null,
    cancel: false,
    suspended: false,
  });
  g.push({
    game_date: "2026-08-26",
    status: "RESULT",
    stadium: "문학",
    home_team: "SK",
    away_team: "HH",
    home_score: 6,
    away_score: 1,
    cancel: false,
    suspended: false,
  });
  return g;
}

/** Minimal thenable query-builder stub keyed by table. */
function makeAdmin(opts: {
  games: Game[];
  snapshot: unknown;
  prevArticles: unknown[];
  capture: { rows?: Record<string, unknown>[] };
}): SupabaseClient {
  const builder = (result: unknown) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.lt = self;
    b.gt = self;
    b.order = self;
    b.limit = self;
    b.maybeSingle = () => Promise.resolve(result);
    b.upsert = (rows: Record<string, unknown>[]) => {
      opts.capture.rows = rows;
      return Promise.resolve({ error: null });
    };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    from: (table: string) => {
      if (table === "kbo_games") return builder({ data: opts.games, error: null });
      if (table === "kbo_sim_snapshots") return builder({ data: opts.snapshot, error: null });
      if (table === "kbo_articles") return builder({ data: opts.prevArticles, error: null });
      return builder({ data: [], error: null });
    },
  } as unknown as SupabaseClient;
}

describe("generateDailyArticles", () => {
  it("produces one well-formed, template-prose article per team", async () => {
    const capture: { rows?: Record<string, unknown>[] } = {};
    const admin = makeAdmin({
      games: fixtureGames(),
      snapshot: {
        payload: {
          teams: [{ ko: "한화", playoff: 67.4 }],
          players: [
            { name: "문동주", franchise_ko: "한화", kind: "pit", war: 3.2, metric: 3.45, metric_label: "ERA" },
          ],
        },
      },
      prevArticles: [{ team: "HH", brief: { playoffPct: 1.5 } }],
      capture,
    });

    // now = 2026-08-26T20:00Z → KST 2026-08-27 05:00 → today 2026-08-27.
    const now = new Date("2026-08-26T20:00:00Z");
    expect(kstDateStr(now)).toBe("2026-08-27");

    const res = await generateDailyArticles(admin, 2026, { runId: "test-run", now });

    expect(res.articlesUpserted).toBe(10);
    expect(res.date).toBe("2026-08-27");
    expect(res.models.template).toBe(10); // no AI key → deterministic fallback

    const rows = capture.rows ?? [];
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.season).toBe(2026);
      expect(FRANCHISES).toContain(r.team as string);
      expect(r.article_date).toBe("2026-08-27");
      expect(typeof r.title).toBe("string");
      expect(String(r.body_html)).toContain("kbo-article");
      expect((r.teaser as { heroLabel?: string }).heroLabel).toBeTruthy();
    }

    // HH exercised the yesterday (loss) + today branches and the trend vs prev.
    const hh = rows.find((r) => r.team === "HH")!;
    const brief = hh.brief as {
      today: unknown;
      yesterday: { result: string } | null;
      trendPlayoff: number | null;
      playoffPct: number;
    };
    expect(brief.today).not.toBeNull();
    expect(brief.yesterday?.result).toBe("L");
    expect(typeof brief.trendPlayoff).toBe("number"); // had a previous article
    expect(brief.playoffPct).toBeGreaterThanOrEqual(0);
  });
});
