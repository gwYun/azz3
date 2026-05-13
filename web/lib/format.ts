import { Locale } from "./i18n";

/**
 * Format an EUR amount as e.g. "€12.14M" / "€420K" / "€0".
 * The hero treatment is locale-agnostic: € is a globally readable symbol.
 */
export function euro(amount: number, _locale: Locale = "en"): string {
  if (!isFinite(amount)) return "—";
  if (amount === 0) return "€0";
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}€${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}€${Math.round(abs)}`;
}

/** Format a delta with explicit + or − prefix. Used in counterfactuals. */
export function euroDelta(amount: number): string {
  if (amount === 0) return "€0";
  const formatted = euro(Math.abs(amount));
  // strip the leading €, prepend sign + €
  const numericPart = formatted.startsWith("€") ? formatted.slice(1) : formatted;
  return `${amount > 0 ? "+" : "−"}€${numericPart}`;
}

/** Format an integer or decimal value for slider readouts. */
export function num(value: number, decimals = 0): string {
  if (!isFinite(value)) return "—";
  if (decimals === 0) return Math.round(value).toString();
  return value.toFixed(decimals);
}

/** Pretty timestamp in user's locale. */
export function dateLabel(epochMs: number, locale: Locale): string {
  const d = new Date(epochMs);
  return d.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
