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
