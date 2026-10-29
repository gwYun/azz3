/**
 * One place that answers "which report row is this, and may this user read it?"
 * for all three report kinds. Used by /api/replies so a reply is only readable /
 * writable by someone who can read the report itself (same hard-paywall rule as
 * the gated body routes: free-by-age, admin, or entitlement owner).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FRANCHISES } from "@/lib/kbo/franchise";
import { CURRENT_SEASON } from "@/lib/kbo/ingest";
import { ROUND_KO } from "@/lib/kbo/postseason-ids";
import { getLeague } from "@/lib/soccer/leagues";
import { kboArticleProduct, kboPostseasonProduct, soccerArticleProduct, lolWorldsProduct } from "@/lib/credits";
import { isArticleLocked, isPostseasonArticleLocked } from "@/lib/kbo/article-access";
import { isSoccerArticleLocked } from "@/lib/soccer/article-access";
import { isAdminUser } from "@/lib/admin-access";
import { isLolArticleLocked } from "@/lib/lol/article-access";
import { WORLDS_SEASON } from "@/lib/lol/pipeline";

import type { ReportKind } from "@/lib/reports/types";

export type { ReportKind };
export { MAX_REPLY_LEN } from "@/lib/reports/types";

/** Natural key as the reader pages know it. `team` is the round code for postseason. */
export type ReportKey = { kind: ReportKind; team: string; date: string; league?: string };

/** report_replies FK column per kind. */
export const REPLY_FK: Record<ReportKind, "kbo_article_id" | "kbo_postseason_id" | "soccer_article_id" | "lol_article_id"> = {
  "kbo-daily": "kbo_article_id",
  "kbo-postseason": "kbo_postseason_id",
  soccer: "soccer_article_id",
  lol: "lol_article_id",
};

export type ResolvedReport = {
  kind: ReportKind;
  id: string;
  reply_count: number;
  locked: boolean;
  product: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a raw key (from query/body). Returns null when malformed. */
export function parseReportKey(raw: {
  kind?: unknown;
  team?: unknown;
  date?: unknown;
  league?: unknown;
}): ReportKey | null {
  const { kind, team, date, league } = raw;
  if (typeof team !== "string" || typeof date !== "string" || !DATE_RE.test(date)) return null;
  if (kind === "kbo-daily") {
    return (FRANCHISES as readonly string[]).includes(team) ? { kind, team, date } : null;
  }
  if (kind === "kbo-postseason") {
    return team in ROUND_KO ? { kind, team, date } : null;
  }
  if (kind === "lol") {
    return team === "worlds" ? { kind, team, date } : null;
  }
  if (kind === "soccer") {
    if (typeof league !== "string" || !getLeague(league) || !/^[\w-]{1,32}$/.test(team)) return null;
    return { kind, team, date, league };
  }
  return null;
}

/** Look up the report row + its time-lock. Null when it doesn't exist. */
export async function resolveReport(admin: SupabaseClient, key: ReportKey): Promise<ResolvedReport | null> {
  const { kind, team, date } = key;
  if (kind === "kbo-daily") {
    const { data } = await admin.from("kbo_articles").select("id, reply_count")
      .eq("season", CURRENT_SEASON).eq("team", team).eq("article_date", date).maybeSingle();
    if (!data) return null;
    return {
      kind, id: data.id, reply_count: data.reply_count ?? 0,
      locked: await isArticleLocked(admin, team, date),
      product: kboArticleProduct(team, date),
    };
  }
  if (kind === "kbo-postseason") {
    const { data } = await admin.from("kbo_postseason_articles").select("id, reply_count")
      .eq("season", CURRENT_SEASON).eq("round", team).eq("article_date", date).maybeSingle();
    if (!data) return null;
    return {
      kind, id: data.id, reply_count: data.reply_count ?? 0,
      locked: await isPostseasonArticleLocked(admin, CURRENT_SEASON, team, date),
      product: kboPostseasonProduct(CURRENT_SEASON, team, date),
    };
  }
  if (kind === "lol") {
    const { data } = await admin.from("lol_articles").select("id, reply_count")
      .eq("season", WORLDS_SEASON).eq("event", "worlds").eq("article_date", date).maybeSingle();
    if (!data) return null;
    return {
      kind, id: data.id, reply_count: data.reply_count ?? 0,
      locked: await isLolArticleLocked(admin, WORLDS_SEASON, date),
      product: lolWorldsProduct(WORLDS_SEASON, date),
    };
  }
  const league = key.league!;
  const { data } = await admin.from("soccer_articles").select("id, reply_count")
    .eq("league", league).eq("team", team).eq("article_date", date).maybeSingle();
  if (!data) return null;
  return {
    kind, id: data.id, reply_count: data.reply_count ?? 0,
    locked: await isSoccerArticleLocked(admin, league, team, date),
    product: soccerArticleProduct(league, team, date),
  };
}

/** Free-by-age, admin, or entitlement owner. */
export async function canReadReport(
  admin: SupabaseClient,
  userId: string | null,
  report: ResolvedReport,
): Promise<boolean> {
  if (!report.locked) return true;
  if (!userId) return false;
  if (await isAdminUser(admin, userId)) return true;
  const { data } = await admin.from("entitlements").select("product")
    .eq("user_id", userId).eq("product", report.product).maybeSingle();
  return !!data;
}

/**
 * Public author label. Kakao `nickname` can be a real name, so never show it raw:
 * keep first (and last, if 3+ chars) character, mask the rest. No nickname →
 * stable "팬#xxxx" from the user id.
 */
export function maskName(nickname: string | null | undefined, userId: string): string {
  const n = (nickname ?? "").trim();
  if (!n) return `팬#${userId.replace(/-/g, "").slice(0, 4)}`;
  const chars = [...n];
  if (chars.length <= 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(Math.min(chars.length - 2, 3))}${chars[chars.length - 1]}`;
}
