/**
 * Shared shapes for the soccer match-report pipeline (sibling of
 * lib/kbo/article-types.ts). One report per team, published the day after each
 * of its matches: a REVIEW of that match + a PREVIEW of the next.
 *
 * Same invariant as KBO: the BRIEF holds every authoritative number; the PROSE
 * (LLM or fallback) is narrative only and is HTML-escaped by the renderer, which
 * prints all figures from the brief.
 */

export type Result = "W" | "D" | "L";

/** Our model's pre-match numbers, from THIS team's perspective (percent / goals). */
export interface TeamPrediction {
  win: number;
  draw: number;
  loss: number;
  xgFor: number;
  xgAgainst: number;
  topScore: string; // "team-opp", e.g. "2-1"
}

export interface SoccerReview {
  gameId: string;
  date: string; // YYYY-MM-DD (KST)
  opp: string;
  oppCode: string;
  home: boolean;
  teamScore: number;
  oppScore: number;
  result: Result;
  /** Frozen pre-kickoff prediction; null if the game predates the model. */
  pred: TeamPrediction | null;
  /** Did our most likely outcome happen? null when pred is null. */
  hit: boolean | null;
}

export interface SoccerPreview {
  gameId: string;
  date: string; // YYYY-MM-DD (KST)
  kickoffKst: string; // "10/19(일) 23:00"
  opp: string;
  oppCode: string;
  home: boolean;
  pred: TeamPrediction;
  oppRank: number | null;
  oppPts: number | null;
  oppLastFive: string | null;
}

export interface SoccerStanding {
  rank: number;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  gapLeader: number; // points behind 1st (0 if leading)
  lastFive: string | null;
}

export interface SoccerSimLine {
  title: number; // % finish 1st
  top: number; // % finish in top zone
  bottom: number; // % finish in bottom zone
  expPts: number;
  trendTop: number | null; // vs this team's previous report
  trendBottom: number | null;
}

export interface TableLine {
  rank: number;
  code: string;
  name: string;
  played: number;
  pts: number;
  gd: number;
  top: number;
  bottom: number;
}

export interface TopPlayer {
  name: string;
  position: string | null;
  goals: number;
  assists: number;
  xg: number | null;
}

export interface SoccerBrief {
  league: string;
  leagueKo: string;
  season: number;
  date: string; // KST publish date
  team: string;
  ko: string;
  model: "hybrid" | "results";
  zones: { top: number; bottom: number };
  remainingFixtures: number;
  standings: SoccerStanding;
  review: SoccerReview;
  preview: SoccerPreview | null;
  sim: SoccerSimLine;
  /** Squad-value rank within the league (hybrid leagues only). */
  value: { rank: number; of: number } | null;
  seasonStats: { xg: number | null; xga: number | null; possession: number | null } | null;
  topPlayers: TopPlayer[];
  table: TableLine[];
}

export interface SoccerProse {
  lede: string;
  recap: string;
  preview: string;
  table: string;
  outlook: string;
}

export const SOCCER_PROSE_KEYS: (keyof SoccerProse)[] = ["lede", "recap", "preview", "table", "outlook"];

/** PUBLIC above-the-fold facts (stored in soccer_articles.teaser). No model numbers. */
export interface SoccerTeaser {
  kicker: string;
  heroLabel: string;
  rank: number;
  record: string; // "5승 1무 1패"
  pts: number;
  result: string; // "vs 아스널 2-1 승 · 홈"
  next: string | null; // "다음 10/19(일) vs 첼시 · 원정"
}

export interface RenderedSoccerArticle {
  title: string;
  dek: string;
  teaser: SoccerTeaser;
  bodyHtml: string;
}
