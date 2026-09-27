import { TEAM_NAMES, type Franchise } from "@/lib/kbo/franchise";

/**
 * Shared shaping for the Open API (/api/v1). Everything here turns a raw DB row
 * into a stable, documented JSON shape a card-news generator can consume without
 * knowing our internals.
 */

/**
 * Flatten stored article HTML into plain text. The bodies are our own generated
 * markup (tags + a handful of entities), so a lightweight strip is enough — the
 * consumer gets clean prose for card copy, and still has `body_html` if it wants
 * structure. Not a general-purpose sanitizer.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export type KboArticleRow = {
  team: string;
  article_date: string;
  title: string;
  dek: string;
  teaser: unknown;
  brief: unknown;
  body_html: string;
  model: string | null;
  published_at: string;
};

export type SerializedArticle = {
  league: "kbo";
  team: string;
  team_ko: string;
  team_en: string;
  date: string;
  title: string;
  dek: string;
  teaser: unknown;
  brief: unknown;
  body_html: string;
  body_text: string;
  model: string | null;
  published_at: string;
  web_url: string;
  locked: boolean;
};

/**
 * Serialize one KBO article row into the Open API shape. `locked` is the site's
 * paywall status for humans (informational only) — the token holder always gets
 * the full body regardless.
 */
export function serializeArticle(row: KboArticleRow, locked: boolean): SerializedArticle {
  const names = TEAM_NAMES[row.team as Franchise];
  return {
    league: "kbo",
    team: row.team,
    team_ko: names?.ko ?? row.team,
    team_en: names?.en ?? row.team,
    date: row.article_date,
    title: row.title,
    dek: row.dek,
    teaser: row.teaser,
    brief: row.brief,
    body_html: row.body_html,
    body_text: stripHtml(row.body_html),
    model: row.model,
    published_at: row.published_at,
    web_url: `/kbo/news/${row.team}/${row.article_date}`,
    locked,
  };
}

/** Standard success envelope. `attribution` must be surfaced in published cards. */
export function envelope<T>(data: T, meta: Record<string, unknown> = {}) {
  return {
    data,
    meta: {
      source: "azz3 Open News API v1",
      attribution: "밸류트랙 (ValueTrack)",
      ...meta,
    },
  };
}

/** Clamp a `?limit=` param into a sane range. */
export function parseLimit(raw: string | null, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export type DateRange = { from: string | null; to: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an inclusive `from`/`to` date-range from query params. `date` is
 * shorthand for a single day (from=to=date) and is only consulted when neither
 * `from` nor `to` is given. Dates are `YYYY-MM-DD`; because that format sorts
 * lexicographically, a plain string compare validates ordering. Returns the
 * (possibly all-null) range, or an error code for a malformed / inverted range.
 */
export function parseDateRange(
  params: URLSearchParams,
): { ok: true; range: DateRange } | { ok: false; error: string } {
  let from = params.get("from");
  let to = params.get("to");
  const date = params.get("date");

  if (!from && !to && date) {
    if (!DATE_RE.test(date)) return { ok: false, error: "invalid_date" };
    from = date;
    to = date;
  }
  if (from && !DATE_RE.test(from)) return { ok: false, error: "invalid_from" };
  if (to && !DATE_RE.test(to)) return { ok: false, error: "invalid_to" };
  if (from && to && from > to) return { ok: false, error: "invalid_range" };

  return { ok: true, range: { from: from ?? null, to: to ?? null } };
}
