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

/**
 * Entitlement product key for a KBO matchup result. Order-sensitive: home vs
 * away differs from away vs home in the sim (home advantage), so the key keeps
 * the ordering. One unlock covers the whole series for that pairing.
 */
export function kboProduct(homeCode: string, awayCode: string): string {
  return `kbo:${homeCode}-${awayCode}`;
}

/**
 * Free "taster" matchups — Samsung (SS) vs Hanwha (HH), both orderings. These
 * show without a credit so users can sample the product; every other pairing is
 * gated. Codes come from public/kbo-matchup.json.
 */
const FREE_PAIRS: ReadonlySet<string> = new Set(["SS-HH", "HH-SS"]);

export function isFreeMatchup(homeCode: string, awayCode: string): boolean {
  return FREE_PAIRS.has(`${homeCode}-${awayCode}`);
}
