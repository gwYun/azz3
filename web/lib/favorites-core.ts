/**
 * Favorite leagues + teams — the pure half (shape, validation, merge). The React
 * provider in lib/favorites.tsx persists this to localStorage and, for signed-in
 * users, mirrors it to public.user_favorites so it follows the account.
 *
 * `league` is the report-hub league id (lib/news/leagues.ts: "kbo", "epl", …);
 * `code` is that league's team code (KBO franchise / Naver teamId). `name` is a
 * display snapshot so the favorites bar renders without fetching club lists.
 */
export type FavTeam = { league: string; code: string; name: string };
export type Favorites = { leagues: string[]; teams: FavTeam[] };

export const EMPTY_FAVORITES: Favorites = { leagues: [], teams: [] };
export const MAX_FAV_TEAMS = 30;
export const MAX_FAV_LEAGUES = 20;

const teamKey = (t: { league: string; code: string }) => `${t.league}:${t.code}`;

/** Coerce untrusted JSON (localStorage, DB row) into a clean Favorites. */
export function sanitizeFavorites(raw: unknown): Favorites {
  const o = (raw && typeof raw === "object" ? raw : {}) as { leagues?: unknown; teams?: unknown };
  const leagues = Array.isArray(o.leagues)
    ? [...new Set(o.leagues.filter((l): l is string => typeof l === "string" && l.length > 0 && l.length <= 40))]
    : [];
  const seen = new Set<string>();
  const teams: FavTeam[] = [];
  if (Array.isArray(o.teams)) {
    for (const t of o.teams) {
      if (!t || typeof t !== "object") continue;
      const { league, code, name } = t as Record<string, unknown>;
      if (typeof league !== "string" || typeof code !== "string" || !league || !code) continue;
      if (league.length > 40 || code.length > 40) continue;
      const k = teamKey({ league, code });
      if (seen.has(k)) continue;
      seen.add(k);
      teams.push({ league, code, name: typeof name === "string" && name ? name.slice(0, 60) : code });
    }
  }
  return { leagues: leagues.slice(0, MAX_FAV_LEAGUES), teams: teams.slice(0, MAX_FAV_TEAMS) };
}

/** Union of two favorite sets, `a`'s order first (used when local meets the account copy on sign-in). */
export function mergeFavorites(a: Favorites, b: Favorites): Favorites {
  return sanitizeFavorites({ leagues: [...a.leagues, ...b.leagues], teams: [...a.teams, ...b.teams] });
}

export function sameFavorites(a: Favorites, b: Favorites): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function hasTeam(f: Favorites, league: string, code: string): boolean {
  return f.teams.some((t) => t.league === league && t.code === code);
}

export function toggleTeam(f: Favorites, team: FavTeam): Favorites {
  if (hasTeam(f, team.league, team.code)) {
    return { ...f, teams: f.teams.filter((t) => !(t.league === team.league && t.code === team.code)) };
  }
  if (f.teams.length >= MAX_FAV_TEAMS) return f;
  return { ...f, teams: [...f.teams, team] };
}

export function toggleLeague(f: Favorites, league: string): Favorites {
  if (f.leagues.includes(league)) return { ...f, leagues: f.leagues.filter((l) => l !== league) };
  if (f.leagues.length >= MAX_FAV_LEAGUES) return f;
  return { ...f, leagues: [...f.leagues, league] };
}

/** Stable sort that floats favorites to the front, keeping each group's original order. */
export function favoritesFirst<T>(items: T[], isFav: (item: T) => boolean): T[] {
  return [...items.filter(isFav), ...items.filter((i) => !isFav(i))];
}
