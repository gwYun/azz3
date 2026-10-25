/**
 * Credit (unlock voucher) config. 1 credit unlocks 1 piece of paid content.
 *
 * BETA: there is no payment system — charging credits is free of charge. The
 * client sends a pack id, the server looks up the credit count here (never
 * trust a client amount). BETA_MAX_BALANCE caps free top-ups so a script can't
 * mint an unbounded balance. Tune freely; this is the single source of truth.
 */
export const IS_BETA = true;

export type CreditPack = {
  id: string;
  credits: number;
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "credits-1", credits: 1 },
  { id: "credits-5", credits: 5 },
  { id: "credits-10", credits: 10 },
  { id: "credits-30", credits: 30 },
] as const;

export function getPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** Free top-ups are refused once the balance would exceed this. */
export const BETA_MAX_BALANCE = 100;

/** One-time sign-up gift, claimed from the first-login popup. */
export const SIGNUP_GIFT_CREDITS = 10;

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

/**
 * Soccer match reports use the same time-lock with a 1-article window: only a
 * team's newest report is paid. Product key per league-team-date, e.g.
 * "soccer:article:epl:12:2026-10-07".
 */
export const SOCCER_ARTICLE_LOCK_WINDOW = 1;

export function soccerArticleProduct(league: string, team: string, date: string): string {
  return `soccer:article:${league}:${team}:${date}`;
}

/**
 * KBO postseason series reports: newest report per series is paid. Product key
 * per season-round-date, e.g. "kbo:postseason:2026:WC:2026-10-14".
 */
export const POSTSEASON_ARTICLE_LOCK_WINDOW = 1;

export function kboPostseasonProduct(season: number, round: string, date: string): string {
  return `kbo:postseason:${season}:${round}:${date}`;
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
