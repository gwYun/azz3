"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n-context";
import type { ArticleTeaser } from "@/lib/kbo/article-types";

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
};

export default function NewsIndexPage() {
  const t = useT();
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    fetch("/api/kbo/articles", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCards((j.cards ?? []) as Card[]))
      .catch(() => setCards([]));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · KBO</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-fg">{t("news.title")}</h1>
      <p className="mt-2 text-fg-muted">{t("news.subtitle")}</p>
      <p className="mt-1 text-xs text-fg-dim">{t("news.paidNote")}</p>

      {cards == null ? (
        <div className="py-20 text-center text-fg-dim">{t("loading")}</div>
      ) : cards.length === 0 ? (
        <div className="py-20 text-center text-fg-dim">{t("news.empty")}</div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.team}
              href={`/kbo/news/${c.team}/${c.article_date}`}
              className="block rounded-2xl border border-line bg-fg/5 p-5 transition hover:border-accent"
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold text-fg">{c.ko}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    c.locked ? "bg-accent/15 text-accent" : "bg-fg/10 text-fg-muted"
                  }`}
                >
                  {c.locked ? t("news.badge.paid") : t("news.badge.free")}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-fg">{c.title}</p>
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
              <div className="mt-3 text-xs font-semibold text-accent">{t("news.read")} →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
