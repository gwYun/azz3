/**
 * Naver Sports football gateway client (robots-clean; api-gw.sports.naver.com has
 * no robots.txt — same host + politeness contract as the KBO client in
 * web/lib/kbo/naver.ts). Four feeds power the daily soccer refresh — see the
 * soccer-naver-endpoints memory for the full field catalog:
 *
 *   resolveSeason   → statistics/.../seasons ............ current seasonCode + window
 *   fetchGames      → schedule/games .................... soccer_games
 *   fetchStandings  → statistics/.../teams ............. soccer_standings (+ teams)
 *   fetchPlayers    → statistics/.../players (paginated)  soccer_player_stats
 *
 * The statistics endpoints key on an opaque per-league `seasonCode` (e.g. EPL
 * 2026/27 = 'gMoc'), NOT the year — resolveSeason maps a league to it and caches.
 */
import type { LeagueDef } from "./leagues";

const API = "https://api-gw.sports.naver.com";
const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  Referer: "https://m.sports.naver.com/",
  Accept: "application/json",
};

const DEFAULT_DELAY_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T = unknown>(
  url: string,
  { retries = 2, timeoutMs = 15000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`naver ${res.status} for ${url}`);
      const json = (await res.json()) as { success?: boolean; result?: T };
      if (json?.success === false || json?.result == null) {
        throw new Error(`naver returned no result for ${url}`);
      }
      return json.result as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// --------------------------------------------------------------------------- //
// Raw row shapes (subset of the fields we read; feeds carry much more, kept in  //
// the `raw` jsonb column downstream).                                           //
// --------------------------------------------------------------------------- //

export interface NaverSeason {
  year: number;
  seasonCode: string;
  title: string;      // '2026/27'
  startDate: string;  // 'YYYYMMDD'
  endDate: string;    // 'YYYYMMDD'
  isSeason: string;   // 'Y' for the current season
  isEnable: string;
}

export interface ResolvedSeason {
  year: number;
  seasonCode: string;
  startDate: string;  // 'YYYY-MM-DD'
  endDate: string;    // 'YYYY-MM-DD'
}

export interface NaverGame {
  gameId: string;
  categoryId?: string;
  gameDate: string;         // 'YYYY-MM-DD'
  gameDateTime?: string;    // ISO-ish
  homeTeamCode?: string;
  awayTeamCode?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeamScore?: number;
  awayTeamScore?: number;
  statusCode?: string;      // RESULT | BEFORE | STARTED | CANCEL
  winner?: string;          // HOME | AWAY (null/absent = draw or unplayed)
  cancel?: boolean;
  suspended?: boolean;
  roundName?: string;
  homeTeamEmblemUrl?: string;
  awayTeamEmblemUrl?: string;
}

// Standings row (subset; full row kept as `raw`). rankPrediction/
// finalRankDistribution are Naver's OWN model — cross-check only.
export interface NaverStandingRow {
  teamId: string;
  teamName?: string;
  teamShortName?: string;
  keyword?: string;
  teamEmblemUrl?: string;
  rank?: number;
  rankStatus?: string;
  matchesPlayed?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  points?: number;
  goals?: number;
  goalsConceded?: number;
  goalsDifference?: number;
  expectedGoals?: number;
  expectedGoalsConceded?: number;
  possession?: number;
  shots?: number;
  shotsOnTarget?: number;
  passes?: number;
  passesAccuracy?: number;
  cornerKicks?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  cleanSheets?: number;
  lastFiveGames?: string;
  rankPrediction?: Record<string, unknown> | null;
  finalRankDistribution?: unknown;
  [k: string]: unknown; // long tail preserved in `raw`
}

export interface NaverPlayerRow {
  playerId: string;
  playerName?: string;
  shortName?: string;
  teamId?: string;
  position?: string;
  backNumber?: number | string;
  countryId?: string;
  matchesPlayed?: number;
  matchesPlayedStarts?: number;
  minsPlayed?: number;
  goals?: number;
  assists?: number;
  expectedGoals?: number;
  expectedAssists?: number;
  shots?: number;
  shotsOnTarget?: number;
  keyPasses?: number;
  passes?: number;
  accuratePasses?: number;
  yellowCards?: number;
  redCards?: number;
  saves?: number;
  cleanSheets?: number;
  goalsConceded?: number;
  indexScore?: number | null;
  [k: string]: unknown; // long tail preserved in `raw`
}

// --------------------------------------------------------------------------- //
// Fetchers.                                                                    //
// --------------------------------------------------------------------------- //

const dash = (yyyymmdd: string) =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;

/**
 * Resolve a league's current season: the opaque seasonCode the statistics feeds
 * need, plus the [startDate, endDate] window and the start-year we store as
 * `season`. Prefers the isSeason='Y' entry, else the latest listed.
 */
export async function resolveSeason(league: LeagueDef): Promise<ResolvedSeason> {
  const url = `${API}/statistics/categories/${league.code}/seasons`;
  const result = await getJson<{ seasons?: NaverSeason[] }>(url);
  const seasons = result.seasons ?? [];
  if (seasons.length === 0) throw new Error(`no seasons for ${league.code}`);
  const current = seasons.find((s) => s.isSeason === "Y") ?? seasons[seasons.length - 1];
  return {
    year: current.year,
    seasonCode: current.seasonCode,
    startDate: dash(current.startDate),
    endDate: dash(current.endDate),
  };
}

/** One league's games in a [fromDate, toDate] window (one request, size=500). */
export async function fetchGames(
  league: LeagueDef,
  fromDate: string,
  toDate: string,
): Promise<NaverGame[]> {
  const url =
    `${API}/schedule/games?upperCategoryId=${league.upper}&categoryId=${league.code}` +
    `&fromDate=${fromDate}&toDate=${toDate}&fields=basic,stadium&size=500`;
  const result = await getJson<{ games?: NaverGame[] }>(url);
  return result.games ?? [];
}

/**
 * A league's full-season games, fetched month by month across [startDate,
 * endDate] so we stay under the 500-row page. Idempotent to re-run.
 */
export async function fetchSeasonGames(
  league: LeagueDef,
  startDate: string,
  endDate: string,
  delayMs = DEFAULT_DELAY_MS,
): Promise<NaverGame[]> {
  const out: NaverGame[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth(); // 0-based
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    out.push(...(await fetchGames(league, from, to)));
    await sleep(delayMs);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** Standings + full team-season stats for every team in the league. */
export async function fetchStandings(
  league: LeagueDef,
  seasonCode: string,
): Promise<NaverStandingRow[]> {
  const url = `${API}/statistics/categories/${league.code}/seasons/${seasonCode}/teams`;
  const result = await getJson<{ seasonTeamStats?: NaverStandingRow[] }>(url);
  return result.seasonTeamStats ?? [];
}

/**
 * Every player's season stats, walking the paginated /players feed (50/page by
 * default; we request 100) until a short/empty page. maxPages bounds a runaway.
 */
export async function fetchPlayers(
  league: LeagueDef,
  seasonCode: string,
  { pageSize = 100, maxPages = 30, delayMs = DEFAULT_DELAY_MS }: {
    pageSize?: number; maxPages?: number; delayMs?: number;
  } = {},
): Promise<NaverPlayerRow[]> {
  const byId = new Map<string, NaverPlayerRow>();
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${API}/statistics/categories/${league.code}/seasons/${seasonCode}/players` +
      `?page=${page}&pageSize=${pageSize}`;
    let rows: NaverPlayerRow[];
    try {
      const result = await getJson<{ seasonPlayerStats?: NaverPlayerRow[] }>(url);
      rows = result.seasonPlayerStats ?? [];
    } catch {
      break; // an errored page ends the walk; keep what we have
    }
    for (const r of rows) if (r.playerId && !byId.has(r.playerId)) byId.set(r.playerId, r);
    if (rows.length < pageSize) break; // last page
    await sleep(delayMs);
  }
  return [...byId.values()];
}
