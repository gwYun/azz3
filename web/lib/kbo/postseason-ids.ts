/**
 * KBO game-type from Naver's gameId. Regular-season ids start with the season
 * year ("20261004WOHH02026"); postseason ids replace it with a round code
 * (verified against the 2025 postseason):
 *
 *   4444 와일드카드 결정전 · 3333 준플레이오프 · 5555 플레이오프 · 7777 한국시리즈
 *
 * Postseason games land in kbo_games under the same season, so anything that
 * builds REGULAR-season standings must filter with isRegularSeasonGame.
 */
export type PostseasonRound = "WC" | "SPO" | "PO" | "KS";

export const ROUND_BY_PREFIX: Record<string, PostseasonRound> = {
  "4444": "WC",
  "3333": "SPO",
  "5555": "PO",
  "7777": "KS",
};

export const ROUND_KO: Record<PostseasonRound, string> = {
  WC: "와일드카드 결정전",
  SPO: "준플레이오프",
  PO: "플레이오프",
  KS: "한국시리즈",
};

export function postseasonRound(gameId: string | null | undefined): PostseasonRound | null {
  return gameId ? ROUND_BY_PREFIX[gameId.slice(0, 4)] ?? null : null;
}

export function isRegularSeasonGame(gameId: string | null | undefined, season: number): boolean {
  return !!gameId && gameId.startsWith(String(season));
}
