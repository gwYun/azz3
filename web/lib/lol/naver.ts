/**
 * Naver esports schedule client (esports-api.game.naver.com — serves no
 * robots.txt; game.naver.com's robots allows `*`). One feed powers everything:
 *
 *   GET /service/v2/schedule/month?month=YYYY-MM&topLeagueId=<id>&relay=false
 *     → { content: { matches: NaverLolMatch[] } }
 *
 * A "match" is a SERIES (Bo1/Bo3/Bo5): homeScore/awayScore are map wins,
 * maxMatchCount the best-of. Unknown sides are teamId 'TBD' until Naver fills
 * the draw in. `startDate` is epoch ms (a real instant, unlike the sports feeds'
 * KST-labelled-UTC). Some topLeagueIds (EWC) mix games — keep gameCode 'lol'.
 */
const API = "https://esports-api.game.naver.com/service/v2";
const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  Referer: "https://game.naver.com/",
  Accept: "application/json",
};
const DELAY_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NaverLolTeam {
  teamId: string;
  name: string;
  nameAcronym?: string;
  nameEng?: string;
  nameEngAcronym?: string;
  imageUrl?: string | null;
}

export interface NaverLolMatch {
  gameId: string;
  leagueId: string;      // e.g. 'world_championship_2026'
  topLeagueId: string;
  gameCode: string;
  stadium?: string | null;
  startDate: number;     // epoch ms
  title?: string | null; // '스위스 3R', '8강', …
  homeScore: number;
  awayScore: number;
  winner?: string | null; // HOME | AWAY | NONE
  matchStatus: string;   // RESULT | BEFORE | STARTED
  maxMatchCount: number; // best-of
  homeTeam: NaverLolTeam;
  awayTeam: NaverLolTeam;
}

async function getJson(url: string, retries = 2): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`naver-esports ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** One league's series in one calendar month ('YYYY-MM'). */
export async function fetchMonth(topLeagueId: string, month: string): Promise<NaverLolMatch[]> {
  const url = `${API}/schedule/month?month=${month}&topLeagueId=${encodeURIComponent(topLeagueId)}&relay=false`;
  const json = (await getJson(url)) as { code?: number; content?: { matches?: NaverLolMatch[] } };
  return (json.content?.matches ?? []).filter((m) => m.gameCode === "lol");
}

/** 'YYYY-MM' months from `from` to `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Every series of the given leagues over a month range (polite, sequential). */
export async function fetchMonths(leagueIds: string[], months: string[]): Promise<NaverLolMatch[]> {
  const out: NaverLolMatch[] = [];
  for (const id of leagueIds) {
    for (const month of months) {
      out.push(...(await fetchMonth(id, month)));
      await sleep(DELAY_MS);
    }
  }
  return out;
}
