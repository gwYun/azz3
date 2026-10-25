/**
 * Report list ordering. Default is most viewed, ties broken by most replied,
 * then newest. "latest" keeps the server's newest-first order.
 */
export type ReportSort = "views" | "replies" | "latest";
export const REPORT_SORTS: readonly ReportSort[] = ["views", "replies", "latest"] as const;
export const DEFAULT_REPORT_SORT: ReportSort = "views";

type Sortable = { article_date: string; view_count?: number; reply_count?: number };

export function sortReports<T extends Sortable>(cards: T[], sort: ReportSort): T[] {
  if (sort === "latest") return cards;
  const v = (c: T) => c.view_count ?? 0;
  const r = (c: T) => c.reply_count ?? 0;
  const [first, second] = sort === "views" ? [v, r] : [r, v];
  return [...cards].sort(
    (a, b) => first(b) - first(a) || second(b) - second(a) || b.article_date.localeCompare(a.article_date),
  );
}
