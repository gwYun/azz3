/** Client-safe report-reply constants (lib/reports/access.ts is server-only). */
export type ReportKind = "kbo-daily" | "kbo-postseason" | "soccer" | "lol";

/** Mirrors the DB check on report_replies.body. */
export const MAX_REPLY_LEN = 500;
