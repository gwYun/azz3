"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n-context";
import { PaidFreeDivider } from "@/components/kbo/PaidFreeDivider";
import type { ArticleTeaser } from "@/lib/kbo/article-types";
import { ReportSortTabs } from "@/components/reports/ReportSortTabs";
import { DEFAULT_REPORT_SORT, sortReports, type ReportSort } from "@/lib/reports/sort";
import { TeamLogo } from "@/components/shared/TeamLogo";
import { FavoritesBar } from "@/components/teams/FavoritesBar";

/**
 * KBO Daily front page — the latest article per team. Public teaser + a paid/free
 * badge; the premium numbers live behind the article's own paywall.
 */
type Card = {
  team: string;
  ko: string;
  article_date: string;
  title: string;
  dek: string;
  teaser: ArticleTeaser | null;
  locked: boolean;
  reply_count?: number;
  view_count?: number;
};

export default function NewsIndexPage() {
  const t = useT();
  const [raw, setRaw] = useState<Card[] | null>(null);
  const [sort, setSort] = useState<ReportSort>(DEFAULT_REPORT_SORT);
  const cards = useMemo(() => (raw ? sortReports(raw, sort) : null), [raw, sort]);

  useEffect(() => {
    fetch("/api/kbo/articles", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRaw((j.cards ?? []) as Card[]))
      .catch(() => setRaw([]));
  }, []);

  // Index of the first free (older) card — the paid→free boundary for the divider.
  // Only meaningful in date order.
  const firstFreeIdx = cards && sort === "latest" ? cards.findIndex((c) => !c.locked) : -1;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · KBO</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-fg">{t("news.title")}</h1>
      <p className="mt-2 text-fg-muted">{t("news.subtitle")}</p>
      <p className="mt-1 text-xs text-fg-dim">{t("news.paidNote")}</p>
      <FavoritesBar />

      {cards == null ? (
        <div className="py-20 text-center text-fg-dim">{t("loading")}</div>
      ) : cards.length === 0 ? (
        <div className="py-20 text-center text-fg-dim">{t("news.empty")}</div>
      ) : (
        <>
        <div className="mt-6 flex justify-end">
          <ReportSortTabs value={sort} onChange={setSort} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((c, i) => (
            <Fragment key={c.team}>
              {i === firstFreeIdx && firstFreeIdx > 0 && (
                <PaidFreeDivider label={t("news.freeDivider")} />
              )}
              <Link
                href={`/kbo/news/${c.team}/${c.article_date}`}
                className="block rounded-2xl border border-line bg-fg/5 p-5 transition hover:border-accent"
              >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <TeamLogo league="kbo" code={c.team} name={c.ko} size="md" />
                  <span className="truncate font-display text-lg font-bold text-fg">{c.ko}</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    c.locked ? "bg-accent/15 text-accent" : "bg-fg/10 text-fg-muted"
                  }`}
                >
                  {c.locked ? t("news.badge.paid") : t("news.badge.free")}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-fg">
                {c.title}
                <span className="ml-1.5 whitespace-nowrap text-xs font-semibold text-accent">
                  {t("replies.count", { n: String(c.reply_count ?? 0) })}
                </span>
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{c.dek}</p>
              {c.teaser && (
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full border border-line px-2 py-0.5 text-fg-muted">
                    {t("news.rank", { n: String(c.teaser.rank) })}
                  </span>
                  {c.teaser.today && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-fg-muted">{c.teaser.today}</span>
                  )}
                </div>
              )}
              <div className="mt-3 text-xs font-semibold text-accent">
                <span className="font-normal text-fg-dim">{t("reports.views", { n: String(c.view_count ?? 0) })}</span>
                {" · "}
                {t("news.read")} →
              </div>
              </Link>
            </Fragment>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
