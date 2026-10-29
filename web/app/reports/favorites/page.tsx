"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n, useT } from "@/lib/i18n-context";
import { useFavorites } from "@/lib/favorites";
import { getNewsLeague, type NewsLeague } from "@/lib/news/leagues";
import { TeamLogo } from "@/components/shared/TeamLogo";
import { ReportSortTabs } from "@/components/reports/ReportSortTabs";
import { DEFAULT_REPORT_SORT, sortReports, type ReportSort } from "@/lib/reports/sort";
import { cardHref, feedUrl } from "@/lib/reports/favorites-feed";

/**
 * Report hub "★ 즐겨찾기" tab — every report of the viewer's favorite teams (their
 * recent archive) plus the latest cards of their favorite leagues, merged into
 * one feed. Reads the same public list endpoints as the league tabs; favorites
 * come from the device/account (lib/favorites.tsx), so this page is client-only.
 */
type Card = {
  league: NewsLeague;
  team: string;
  ko: string;
  article_date: string;
  title: string;
  dek: string;
  locked: boolean;
  reply_count?: number;
  view_count?: number;
  fav: boolean; // from a favorite TEAM (vs. a favorite league's feed)
};

type Raw = Omit<Card, "league" | "fav">;
const PER_TEAM = 5;

export default function FavoriteReportsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { favorites, isFavTeam } = useFavorites();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [sort, setSort] = useState<ReportSort>("latest");
  const name = (o: { ko: string; en: string }) => (locale === "ko" ? o.ko : o.en);

  // Stable key so the fetch only reruns when the favorite set actually changes.
  const favKey = JSON.stringify(favorites);
  useEffect(() => {
    const jobs: { league: NewsLeague; url: string; team?: string }[] = [];
    for (const f of favorites.teams) {
      const lg = getNewsLeague(f.league);
      const url = lg && feedUrl(lg, f.code);
      if (lg && url) jobs.push({ league: lg, url, team: f.code });
    }
    for (const id of favorites.leagues) {
      const lg = getNewsLeague(id);
      const url = lg && feedUrl(lg);
      if (lg && url) jobs.push({ league: lg, url });
    }
    if (jobs.length === 0) {
      setCards([]);
      return;
    }
    setCards(null);
    let active = true;
    Promise.all(
      jobs.map((j) =>
        fetch(j.url)
          .then((r) => r.json())
          .then((d) => {
            const rows = ((d.items ?? d.cards ?? []) as Raw[]).slice(0, j.team ? PER_TEAM : undefined);
            return rows.map((r) => ({ ...r, league: j.league, fav: !!j.team }));
          })
          .catch(() => [] as Card[]),
      ),
    ).then((lists) => {
      if (!active) return;
      // Dedupe (a favorite team inside a favorite league appears in both feeds).
      const seen = new Map<string, Card>();
      for (const c of lists.flat()) {
        const k = `${c.league.id}|${c.team}|${c.article_date}`;
        const prev = seen.get(k);
        if (!prev || (c.fav && !prev.fav)) seen.set(k, c);
      }
      setCards([...seen.values()].sort((a, b) => b.article_date.localeCompare(a.article_date)));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favKey]);

  const shown = useMemo(() => (cards ? sortReports(cards, sort) : null), [cards, sort]);
  const empty = favorites.teams.length === 0 && favorites.leagues.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · {t("newshub.title")}</div>
      <h1 className="mt-1.5 font-display text-3xl font-bold text-fg">★ {t("fav.tab")}</h1>
      <p className="mt-2 text-fg-muted">{t("fav.tabSubtitle")}</p>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-dim">{t("newshub.articles")}</h2>
          {!empty && <ReportSortTabs value={sort} onChange={setSort} />}
        </div>
        {empty ? (
          <div className="mt-3 rounded-2xl border border-line bg-fg/5 p-10 text-center">
            <p className="text-sm text-fg-muted">{t("fav.tabEmpty")}</p>
            <Link href="/reports/kbo" className="mt-4 inline-block text-sm font-semibold text-accent">
              {t("newshub.title")} →
            </Link>
          </div>
        ) : shown == null ? (
          <div className="mt-3 py-10 text-center text-fg-dim">{t("loading")}</div>
        ) : shown.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-line bg-fg/5 p-10 text-center">
            <p className="text-sm text-fg-muted">{t("fav.tabNoReports")}</p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {shown.map((c) => {
              const crest = !c.league.postseason && !c.league.lol;
              return (
                <Link
                  key={`${c.league.id}-${c.team}-${c.article_date}`}
                  href={cardHref(c.league, c.team, c.article_date)}
                  className="block rounded-2xl border border-line bg-fg/5 p-5 transition hover:border-accent"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-dim">{name(c.league)}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {crest && <TeamLogo league={c.league.id} code={c.team} name={c.ko} size="md" />}
                      <span className="truncate font-display text-base font-bold text-fg">{c.ko}</span>
                      {crest && isFavTeam(c.league.id, c.team) && (
                        <span className="text-xs text-accent" aria-label={t("fav.title")}>★</span>
                      )}
                    </span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-semibold " +
                        (c.locked ? "bg-accent/15 text-accent" : "bg-fg/10 text-fg-muted")
                      }
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
                  <div className="mt-3 text-xs font-semibold text-accent">
                    {c.article_date} ·{" "}
                    <span className="font-normal text-fg-dim">{t("reports.views", { n: String(c.view_count ?? 0) })}</span>
                    {" · "}
                    {t("news.read")} →
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
