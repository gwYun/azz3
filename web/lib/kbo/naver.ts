/**
 * Naver Sports gateway client (robots-clean; api-gw.sports.naver.com/robots.txt
 * is empty). Three feeds power the daily KBO refresh — see
 * kbo-naver-stats-endpoints memory for the full field catalog:
 *
 *   fetchSeasonGames  → schedule/games ...................... kbo_games
 *   fetchTeamStats    → statistics/.../teams ................ kbo_team_stats
 *   fetchPlayerStats  → statistics/.../players (top 50/sort)  kbo_hitter/pitcher
 *
 * The /players feed is a 50-row leaderboard (size/page are ignored), so
 * fetchAllPlayers unions several sort orders by playerId to widen coverage past
 * the cap. Everything is polite: a short spaced delay + small retry budget.
 */
const API = "https://api-gw.sports.naver.com";
const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  Referer: "https://m.sports.naver.com/",
  Accept: "application/json",
};

const DEFAULT_DELAY_MS = 400;
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
// Raw row shapes (subset of the fields we read).                              //
// --------------------------------------------------------------------------- //
export interface NaverGame {
  gameId: string;
  gameDate: string; // 'YYYY-MM-DD'
  stadium?: string;
  homeTeamCode?: string;
  awayTeamCode?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeamScore?: number;
  awayTeamScore?: number;
  statusCode?: string; // RESULT | BEFORE | STARTED | CANCEL
  winner?: string; // HOME | AWAY
  cancel?: boolean;
  suspended?: boolean;
}

export interface NaverTeamStat {
  teamId: string;
  ranking?: number;
  gameCount?: number;
  winGameCount?: number;
  loseGameCount?: number;
  drawnGameCount?: number;
  wra?: number;
  gameBehind?: number;
  lastFiveGames?: string;
  continuousGameResult?: string;
  offenseRun?: number; offenseRbi?: number; offenseAb?: number; offenseHit?: number;
  offenseH2?: number; offenseH3?: number; offenseHr?: number; offenseSb?: number;
  offenseBbhp?: number; offenseKk?: number;
  offenseObp?: number; offenseSlg?: number; offenseOps?: number; offenseHra?: number;
  defenseEra?: number; defenseR?: number; defenseEr?: number; defenseInning?: number;
  defenseHit?: number; defenseHr?: number; defenseKk?: number; defenseBbhp?: number;
  defenseErr?: number; defenseWhip?: number; defenseQs?: number;
  defenseSave?: number; defenseHold?: number;
}

export interface NaverHitter {
  playerId: string; playerName?: string; teamId?: string;
  hitterGameCount?: number; hitterAb?: number; hitterHit?: number;
  hitterH2?: number; hitterH3?: number; hitterHr?: number;
  hitterBb?: number; hitterHp?: number; hitterKk?: number;
  hitterSb?: number; hitterCs?: number; hitterRbi?: number; hitterRun?: number; hitterGd?: number;
  hitterObp?: number; hitterSlg?: number; hitterOps?: number;
  hitterWoba?: number; hitterWrcPlus?: number; hitterWar?: number;
  isQualified?: boolean;
}

export interface NaverPitcher {
  playerId: string; playerName?: string; teamId?: string;
  pitcherGameCount?: number; pitcherStart?: number; pitcherInning?: number;
  pitcherHit?: number; pitcherHr?: number; pitcherR?: number; pitcherEr?: number;
  pitcherBb?: number; pitcherHp?: number; pitcherKk?: number;
  pitcherWin?: number; pitcherLose?: number; pitcherSave?: number; pitcherHold?: number;
  pitcherQs?: number; pitcherPitchCount?: number;
  pitcherEra?: number; pitcherWhip?: number; pitcherWar?: number;
  isQualified?: boolean;
}

// Per-game box-score rows (schedule/games/{id}/record → result.recordData).
export interface NaverBoxBatter {
  playerCode: string; name?: string; batOrder?: number; pos?: string;
  ab?: number; hit?: number; hr?: number; bb?: number; kk?: number;
  sb?: number; run?: number; rbi?: number;
}
export interface NaverBoxPitcher {
  pcode: string; name?: string; inn?: string | number; bf?: number; ab?: number;
  hit?: number; r?: number; er?: number; hr?: number; bb?: number; bbhp?: number; kk?: number;
}
export interface NaverGameRecord {
  away: { batters: NaverBoxBatter[]; pitchers: NaverBoxPitcher[] };
  home: { batters: NaverBoxBatter[]; pitchers: NaverBoxPitcher[] };
}

// --------------------------------------------------------------------------- //
// Fetchers.                                                                    //
// --------------------------------------------------------------------------- //

/**
 * One game's per-player box score. Returns null when the game has no record yet
 * (unplayed/cancelled). battersBoxscore/pitchersBoxscore split into away/home,
 * which the caller tags with the game's known away/home franchise.
 */
export async function fetchGameRecord(gameId: string): Promise<NaverGameRecord | null> {
  const url = `${API}/schedule/games/${gameId}/record`;
  let rd: {
    battersBoxscore?: { away?: NaverBoxBatter[]; home?: NaverBoxBatter[] };
    pitchersBoxscore?: { away?: NaverBoxPitcher[]; home?: NaverBoxPitcher[] };
  };
  try {
    const result = await getJson<{ recordData?: typeof rd }>(url);
    if (!result?.recordData?.battersBoxscore) return null;
    rd = result.recordData;
  } catch {
    return null;
  }
  const bb = rd.battersBoxscore ?? {};
  const pb = rd.pitchersBoxscore ?? {};
  return {
    away: { batters: bb.away ?? [], pitchers: pb.away ?? [] },
    home: { batters: bb.home ?? [], pitchers: pb.home ?? [] },
  };
}

/** All KBO games in a [fromDate, toDate] window (one request, size=500). */
export async function fetchGames(fromDate: string, toDate: string): Promise<NaverGame[]> {
  const url =
    `${API}/schedule/games?upperCategoryId=kbaseball&categoryId=kbo` +
    `&fromDate=${fromDate}&toDate=${toDate}&fields=basic,stadium&size=500`;
  const result = await getJson<{ games?: NaverGame[] }>(url);
  return result.games ?? [];
}

/**
 * A full season's games, fetched month by month (Mar..throughMonth) so we stay
 * under the 500-row page and mirror the Python collector. Idempotent to re-run.
 */
export async function fetchSeasonGames(
  season: number,
  throughMonth: number,
  delayMs = DEFAULT_DELAY_MS,
): Promise<NaverGame[]> {
  const out: NaverGame[] = [];
  const end = Math.min(Math.max(throughMonth, 3), 11);
  for (let m = 3; m <= end; m++) {
    const last = new Date(season, m, 0).getDate(); // day 0 of next month = last day
    const from = `${season}-${String(m).padStart(2, "0")}-01`;
    const to = `${season}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    out.push(...(await fetchGames(from, to)));
    await sleep(delayMs);
  }
  return out;
}

/** Team season stats + standings for all 10 teams. The endpoint wraps the rows
 * in result.seasonTeamStats (alongside a postSeason block). */
export async function fetchTeamStats(season: number): Promise<NaverTeamStat[]> {
  const url = `${API}/statistics/categories/kbo/seasons/${season}/teams?gameType=REGULAR_SEASON`;
  const result = await getJson<{ seasonTeamStats?: NaverTeamStat[] }>(url);
  return result.seasonTeamStats ?? [];
}

async function fetchPlayerPage<T>(
  season: number,
  playerType: "HITTER" | "PITCHER",
  sortField: string,
): Promise<T[]> {
  const url =
    `${API}/statistics/categories/kbo/seasons/${season}/players` +
    `?playerType=${playerType}&gameType=REGULAR_SEASON` +
    `&sortField=${sortField}&sortDirection=desc`;
  const result = await getJson<{ [k: string]: unknown } | T[]>(url);
  if (Array.isArray(result)) return result as T[];
  const arr = Object.values(result).find((v) => Array.isArray(v)) as T[] | undefined;
  return arr ?? [];
}

// Sort fields unioned to reach past the top-50 cap: pick orderings that surface
// different slices of the roster (rate leaders, volume leaders, value leaders).
const HITTER_SORTS = [
  "hitterHra", "hitterAb", "hitterHr", "hitterRbi", "hitterHit", "hitterOps", "hitterWar", "hitterRun",
];
const PITCHER_SORTS = [
  "pitcherEra", "pitcherInning", "pitcherKk", "pitcherWin", "pitcherWar", "pitcherHold", "pitcherSave", "pitcherWhip",
];

/** Union of the hitter leaderboards across sort fields, deduped by playerId. */
export async function fetchAllHitters(
  season: number,
  delayMs = DEFAULT_DELAY_MS,
): Promise<NaverHitter[]> {
  const byId = new Map<string, NaverHitter>();
  for (const sort of HITTER_SORTS) {
    const rows = await fetchPlayerPage<NaverHitter>(season, "HITTER", sort);
    for (const r of rows) if (r.playerId && !byId.has(r.playerId)) byId.set(r.playerId, r);
    await sleep(delayMs);
  }
  return [...byId.values()];
}

/** Union of the pitcher leaderboards across sort fields, deduped by playerId. */
export async function fetchAllPitchers(
  season: number,
  delayMs = DEFAULT_DELAY_MS,
): Promise<NaverPitcher[]> {
  const byId = new Map<string, NaverPitcher>();
  for (const sort of PITCHER_SORTS) {
    const rows = await fetchPlayerPage<NaverPitcher>(season, "PITCHER", sort);
    for (const r of rows) if (r.playerId && !byId.has(r.playerId)) byId.set(r.playerId, r);
    await sleep(delayMs);
  }
  return [...byId.values()];
}
