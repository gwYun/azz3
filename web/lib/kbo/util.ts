/**
 * Shared numeric helpers for the KBO stat pipeline.
 */

/**
 * KBO reports innings pitched in ".1 / .2 = thirds" notation: 5.1 means 5⅓,
 * 5.2 means 5⅔. Convert to true decimal innings so downstream arithmetic
 * (ERA, WHIP, FIP, RA/game) is correct. Whole numbers pass through unchanged.
 */
export function kboIpToDecimal(ip: number | null | undefined): number | null {
  if (ip == null || !isFinite(ip)) return null;
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 10); // 0, 1, or 2
  return whole + frac / 3;
}

/** Coerce a possibly-missing numeric to a finite number or null. */
export function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : null;
}
