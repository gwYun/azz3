/**
 * The single one-time "premium unlock" product sold in Phase 3.
 *
 * Pure constants (no imports) so both server and client code can use them.
 * Adjust PREMIUM_PRICE_KRW / PREMIUM_ITEM_NAME to your real product; the whole
 * flow (order amount, Kakao Pay checkout, entitlement grant) reads from here.
 */
export const PREMIUM_PRODUCT = "premium";

/** Price in KRW. Won has no minor unit, so this is an integer. Placeholder. */
export const PREMIUM_PRICE_KRW = 4900;

/** Item name shown on the Kakao Pay checkout. */
export const PREMIUM_ITEM_NAME = "ValueTrack 프리미엄";
