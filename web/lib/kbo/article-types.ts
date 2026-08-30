/**
 * Shared shapes for the daily KBO articles pipeline. Kept in their own module so
 * the brief builder (articles.ts), the prose writer (llm.ts), and the HTML
 * renderer (article-template.ts) can all import them without a cycle.
 *
 * The BRIEF holds every authoritative number (deterministic, from the sim +
 * standings). The PROSE holds only narrative paragraphs (from the LLM, or the
 * deterministic fallback). The renderer prints numbers from the brief — never
 * from the prose — so a stray figure in the narrative can't reach the reader as
 * fact.
 */

export interface ArticleStandings {
  rank: number;
  win: number;
  lose: number;
  draw: number;
  pct: number; // win% excluding draws
  gamesPlayed: number;
  gamesRemaining: number;
  gbLeader: number; // games behind the 1st-place team (0 if leading)
  /** Games behind the 5th seed (the 가을야구 cut). >0 = outside; <=0 = inside (cushion). */
  gbCut: number;
  inPlayoffSpot: boolean; // currently rank <= 5
  lastFive: string | null; // e.g. "WWLWL"
  streak: string | null; // e.g. "3승"
}

export interface ArticleGame {
  opp: string; // opponent Korean name
  oppCode: string;
  home: boolean;
  stadium: string | null;
}

export interface ArticleYesterday extends ArticleGame {
  teamScore: number;
  oppScore: number;
  result: "W" | "L" | "T";
}

export interface ArticleToday extends ArticleGame {
  winProb: number; // this team's win probability (decisive), 0–100
  projFor: number; // projected runs for
  projAgainst: number; // projected runs against
}

export interface ArticleTopPlayer {
  name: string;
  kind: "bat" | "pit";
  war: number | null;
  metric: number | null;
  metricLabel: string; // "wRC+" | "ERA"
}

export interface ArticleBrief {
  season: number;
  date: string; // YYYY-MM-DD (KST publish date)
  team: string; // franchise code
  ko: string;
  en: string;
  park: string;
  standings: ArticleStandings;
  yesterday: ArticleYesterday | null;
  today: ArticleToday | null;
  playoffPct: number; // CONDITIONAL 가을야구(top-5) odds — current standings fixed
  firstPct: number; // CONDITIONAL % finishing 1st (pennant context)
  powerPlayoffPct: number | null; // unconditional "0-0 restart" power sim (context only)
  trendPlayoff: number | null; // today's playoffPct − yesterday's article playoffPct
  offRating: number | null; // 100 = league average
  defRating: number | null; // 100 = league average (higher = fewer runs allowed)
  topPlayer: ArticleTopPlayer | null;
  /**
   * League-wide 가을야구 race context (all 10 teams, sorted by rank) — so the
   * article can analyze how OTHER teams' results moved this team's odds, not
   * just its own game. Same for every team's article that day.
   */
  raceContext: RaceTeam[];
}

/** One team's line in the 가을야구 race table. */
export interface RaceTeam {
  rank: number;
  code: string;
  ko: string;
  win: number;
  lose: number;
  draw: number;
  gbCut: number; // games behind the 5th seed (<0 = cushion inside the cut)
  playoffPct: number; // conditional 가을야구 odds
  inPlayoffSpot: boolean; // rank <= 5
  yesterday: { opp: string; result: "W" | "L" | "T"; teamScore: number; oppScore: number } | null;
}

export interface ArticleProse {
  lede: string; // headline hook (2–3 sentences)
  recap: string; // yesterday's game, in depth (3–5 sentences)
  preview: string; // today's matchup analysis (3–5 sentences)
  race: string; // how the rest of the league's results moved the PO picture (4–6 sentences)
  outlook: string; // remaining-schedule outlook (3–5 sentences)
}

export const PROSE_KEYS: (keyof ArticleProse)[] = ["lede", "recap", "preview", "race", "outlook"];

/**
 * The PUBLIC above-the-fold preview (stored in kbo_articles.teaser, safe to
 * expose). Deliberately withholds the premium numbers — the conditional
 * 가을야구 odds, the day-over-day trend, and today's win probability live ONLY
 * in the gated body_html. The teaser carries public standings facts (rank,
 * record, today's opponent) so the card is enticing without giving away what
 * readers pay for.
 */
export interface ArticleTeaser {
  kicker: string; // e.g. "가을야구 레이스"
  heroLabel: string; // the locked hero's caption, e.g. "가을야구 진출 확률"
  rank: number;
  record: string; // "49승 59패 3무"
  pct: string; // ".454"
  gamesRemaining: number;
  today: string | null; // "오늘 vs SSG · 홈"
}

export interface RenderedArticle {
  title: string;
  dek: string;
  teaser: ArticleTeaser;
  bodyHtml: string; // self-contained, scoped fragment (see article-template.ts)
}
