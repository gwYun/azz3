/**
 * Credit (unlock voucher) config. Users buy credits in bulk via Kakao Pay;
 * 1 credit unlocks 1 KBO matchup result. All amounts are server-defined — the
 * client sends a pack id, the server looks up the price here (never trust a
 * client amount). Tune freely; this is the single source of truth.
 */
export type CreditPack = {
  id: string;
  credits: number;
  amount: number; // KRW, integer
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "credits-1", credits: 1, amount: 1000 }, //  ₩1,000 / credit
  { id: "credits-5", credits: 5, amount: 4500 }, //  ₩900   / credit (10% off)
  { id: "credits-10", credits: 10, amount: 8500 }, // ₩850  / credit (15% off)
  { id: "credits-30", credits: 30, amount: 24000 }, // ₩800 / credit (20% off)
] as const;

export function getPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Price of a single unlock in KRW (the 1-credit pack). */
export const UNLOCK_PRICE_KRW = 1000;

export type Slot = "home" | "away";

/**
 * Entitlement product key for one team in one slot, e.g. "kbo:LG:home".
 * Unlocks are PER TEAM PER SLOT: unlocking LG as home is a separate purchase
 * from LG as away, and once bought it stays unlocked for that slot forever.
 */
export function kboProduct(team: string, slot: Slot): string {
  return `kbo:${team}:${slot}`;
}

/**
 * Free teams — Samsung (SS) and Hanwha (HH) are always open in BOTH slots so
 * users can sample the product. Codes come from public/kbo-matchup.json.
 */
const FREE_TEAMS: ReadonlySet<string> = new Set(["SS", "HH"]);

export function isFreeTeam(team: string): boolean {
  return FREE_TEAMS.has(team);
}

/** True if the team is usable in this slot without a purchase (free or owned). */
export function isTeamSlotOpen(team: string, slot: Slot, unlocked: string[]): boolean {
  return isFreeTeam(team) || unlocked.includes(kboProduct(team, slot));
}

// --------------------------------------------------------------------------- //
// Daily articles — a TIME-BASED paywall (distinct from the per-team matchup    //
// gate above). Each team publishes one dated column a day; the N most-recent   //
// per team are paid, everything older is free automatically. Paying grants a   //
// permanent entitlement to that one dated article.                             //
// --------------------------------------------------------------------------- //

/** How many of a team's most-recent articles stay locked. Older → free. */
export const ARTICLE_LOCK_WINDOW = 3;

/**
 * Entitlement product key for one dated article, e.g.
 * "kbo:article:HH:2026-08-27". One credit unlocks one team-day, forever.
 */
export function kboArticleProduct(team: string, date: string): string {
  return `kbo:article:${team}:${date}`;
}

/**
 * Is an article locked purely by recency? `rankFromNewest` is its 0-based
 * position among that team's articles ordered newest-first (0 = today's).
 * Locked iff it's within the newest ARTICLE_LOCK_WINDOW. The server computes
 * the rank (it needs every date); this stays a trivial, testable predicate.
 */
export function isArticleLockedByRank(rankFromNewest: number): boolean {
  return rankFromNewest >= 0 && rankFromNewest < ARTICLE_LOCK_WINDOW;
}

/** True if the reader may see the full body: not locked by age, or owns it. */
export function isArticleOpen(
  team: string,
  date: string,
  rankFromNewest: number,
  unlocked: string[],
): boolean {
  return !isArticleLockedByRank(rankFromNewest) || unlocked.includes(kboArticleProduct(team, date));
}
