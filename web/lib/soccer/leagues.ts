/**
 * Soccer league registry — the leagues the daily collector tracks and the Naver
 * gateway coordinates each one needs.
 *
 * `code` is Naver's categoryId (also our `league` column value); `upper` is the
 * upperCategoryId the schedule feed keys on (wfootball = world football, kfootball
 * = Korean). Everything else (seasonCode, season window) is resolved live from
 * Naver's /seasons endpoint — see naver.ts::resolveSeason — because the codes are
 * opaque and rotate each season.
 */
export interface LeagueDef {
  code: string;      // Naver categoryId + our `league` column (e.g. 'epl')
  upper: string;     // upperCategoryId for the schedule feed
  ko: string;        // Korean display name
  en: string;        // English display name
  country: string;   // country / region label
  /**
   * Match model: big-5 have squad-value ratings → hybrid; K League → results only;
   * UEFA club competitions → europe (results model pooled over UCL + UEL + UECL).
   */
  model: "hybrid" | "results" | "europe";
  /** Table zones the season sim reports (generic "top N / bottom N", not rule claims). */
  zones: { top: number; bottom: number };
  /**
   * Split-season format: after `rounds` league rounds the table splits into a top
   * and bottom `groupSize` that each play a single round-robin (K League 1:
   * 33 + 5 = 38). Naver publishes the post-split fixtures only after the split.
   */
  split?: { rounds: number; groupSize: number };
  /** Publish per-team reports + appear in the report hub (false = training data only). */
  reports?: boolean;
  /** Collect per-team player stats (skip for training-only competitions). */
  players?: boolean;
  /** Table-stage games are those before this MM-DD of season+1 (UCL league phase ends in January). */
  tableUntil?: string;
  /** Labels for the sim's top / bottom zones (default "상위 N위" / "하위 N위"). */
  zoneLabels?: { top: string; bottom: string };
}

export const LEAGUES: LeagueDef[] = [
  { code: "epl",        upper: "wfootball", ko: "프리미어리그", en: "Premier League", country: "England", model: "hybrid",  zones: { top: 4, bottom: 3 } },
  { code: "primera",    upper: "wfootball", ko: "라리가",       en: "LaLiga",         country: "Spain",   model: "hybrid",  zones: { top: 4, bottom: 3 } },
  { code: "bundesliga", upper: "wfootball", ko: "분데스리가",   en: "Bundesliga",     country: "Germany", model: "hybrid",  zones: { top: 4, bottom: 2 } },
  { code: "seria",      upper: "wfootball", ko: "세리에 A",     en: "Serie A",        country: "Italy",   model: "hybrid",  zones: { top: 4, bottom: 3 } },
  { code: "ligue1",     upper: "wfootball", ko: "리그 1",       en: "Ligue 1",        country: "France",  model: "hybrid",  zones: { top: 4, bottom: 2 } },
  { code: "kleague",    upper: "kfootball", ko: "K리그1",       en: "K League 1",     country: "Korea",   model: "results", zones: { top: 4, bottom: 1 }, split: { rounds: 33, groupSize: 6 } },
  { code: "kleague2",   upper: "kfootball", ko: "K리그2",       en: "K League 2",     country: "Korea",   model: "results", zones: { top: 5, bottom: 1 } },
  { code: "champs",     upper: "wfootball", ko: "UEFA 챔피언스리그", en: "UEFA Champions League", country: "Europe", model: "europe",
    zones: { top: 8, bottom: 12 }, tableUntil: "02-01", zoneLabels: { top: "16강 직행(1~8위)", bottom: "탈락(25~36위)" } },
  // Training data for the europe model only; no reports, no player pulls.
  { code: "europa",     upper: "wfootball", ko: "UEFA 유로파리그", en: "UEFA Europa League", country: "Europe", model: "europe",
    zones: { top: 8, bottom: 12 }, reports: false, players: false },
  { code: "uecl",       upper: "wfootball", ko: "UEFA 컨퍼런스리그", en: "UEFA Conference League", country: "Europe", model: "europe",
    zones: { top: 8, bottom: 12 }, reports: false, players: false },
];

/** European club competitions pooled by the europe model. */
export const EUROPE_CODES = ["champs", "europa", "uecl"];

export const LEAGUE_CODES = LEAGUES.map((l) => l.code);

const BY_CODE = new Map(LEAGUES.map((l) => [l.code, l]));

/** Look up a league definition by its Naver code; undefined if not tracked. */
export function getLeague(code: string): LeagueDef | undefined {
  return BY_CODE.get(code);
}
