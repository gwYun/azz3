"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n, useT } from "@/lib/i18n-context";
import { getNewsLeague } from "@/lib/news/leagues";
import { FRANCHISES, TEAM_NAMES } from "@/lib/kbo/franchise";
import { useFavorites } from "@/lib/favorites";
import { PaidFreeDivider } from "@/components/kbo/PaidFreeDivider";
import { TeamLogo } from "@/components/shared/TeamLogo";
import { FavStar } from "@/components/teams/FavStar";
import { FavoritesBar } from "@/components/teams/FavoritesBar";
import { TeamPicker } from "@/components/teams/TeamPicker";
import { ReportSortTabs } from "@/components/reports/ReportSortTabs";
import { DEFAULT_REPORT_SORT, sortReports, type ReportSort } from "@/lib/reports/sort";

/**
 * Report sub-tab page — one per league (/reports/kbo, /reports/epl, …). The live league
 * (KBO) shows the club explorer: search + team filter over the article feed.
 * Not-yet-live leagues show a "coming soon" panel. Deliberately not wired to the
 * DB yet (no articles are published); the feed renders an honest empty state so
 * the browsing structure is real before content lands.
 */
type ClubOption = { code: string; ko: string; en: string };
type NewsCard = {
  team: string;
  ko: string;
  article_date: string;
  title: string;
  dek: string;
  locked: boolean;
  reply_count?: number;
  view_count?: number;
};

// The club roster for a live league. KBO (and its playoff view) use the 10
// franchises; soccer rosters arrive with each league's launch.
function clubsFor(leagueId: string): ClubOption[] {
  if (leagueId === "kbo") {
    return FRANCHISES.map((code) => ({ code, ko: TEAM_NAMES[code].ko, en: TEAM_NAMES[code].en }));
  }
  return [];
}

export default function NewsLeaguePage() {
  const t = useT();
  const { locale } = useI18n();
  const params = useParams<{ league: string }>();
  const leagueId = params.league;
  const league = getNewsLeague(leagueId);

  const name = (o: { ko: string; en: string }) => (locale === "ko" ? o.ko : o.en);

  const { isFavLeague, toggleLeague, isFavTeam } = useFavorites();

  // The club filter lives in the URL (?team=<code>) so a filtered view is
  // shareable and the favorites bar can deep-link into it. Team codes are per
  // league, and switching league tabs drops the query, so it resets for free.
  const router = useRouter();
  const pathname = usePathname();
  const team = useSearchParams().get("team"); // null = all clubs
  const setTeam = useCallback(
    (code: string | null) =>
      router.replace(code ? `${pathname}?team=${encodeURIComponent(code)}` : pathname, { scroll: false }),
    [router, pathname],
  );
  const [soccerClubs, setSoccerClubs] = useState<ClubOption[]>([]); // soccer: from the API
  useEffect(() => {
    setSoccerClubs([]);
  }, [leagueId]);

  const clubs = useMemo(
    () => (league?.soccer || league?.postseason ? soccerClubs : clubsFor(leagueId)),
    [league, leagueId, soccerClubs],
  );
  const pickerTeams = useMemo(
    () => clubs.map((c) => ({ code: c.code, name: locale === "ko" ? c.ko : c.en })),
    [clubs, locale],
  );

  // Article feed — for the live KBO league, pull the real daily articles: the
  // latest per club (all-clubs view) or a single club's archive when filtered.
  const [rawPosts, setPosts] = useState<NewsCard[] | null>(null);
  const [sort, setSort] = useState<ReportSort>(DEFAULT_REPORT_SORT);
  const posts = useMemo(() => (rawPosts ? sortReports(rawPosts, sort) : null), [rawPosts, sort]);
  useEffect(() => {
    const isSoccer = !!league?.soccer;
    const isPost = !!league?.postseason;
    if (!league?.live || (leagueId !== "kbo" && !isSoccer && !isPost)) {
      setPosts([]);
      return;
    }
    setPosts(null);
    let active = true;
    // Postseason: the "club" filter is a series filter (team = round code).
    const url = isPost
      ? `/api/kbo/postseason/articles${team ? `?round=${team}` : ""}`
      : isSoccer
        ? `/api/soccer/articles?league=${leagueId}${team ? `&team=${encodeURIComponent(team)}` : ""}`
        : `/api/kbo/articles${team ? `?team=${team}` : ""}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        setPosts((j.cards ?? j.items ?? []) as NewsCard[]);
        if ((isSoccer || isPost) && Array.isArray(j.clubs) && j.clubs.length) setSoccerClubs(j.clubs as ClubOption[]);
      })
      .catch(() => {
        if (active) setPosts([]);
      });
    return () => {
      active = false;
    };
  }, [league, leagueId, team]);

  // Index of the first free (older) article — the paid→free boundary for the divider.
  // Only meaningful in date order.
  const firstFreeIdx = posts && sort === "latest" ? posts.findIndex((p) => !p.locked) : -1;

  if (!league) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · {t("newshub.title")}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <h1 className="font-display text-3xl font-bold text-fg">{name(league)}</h1>
        <FavStar on={isFavLeague(league.id)} onToggle={() => toggleLeague(league.id)} label={name(league)} size="md" />
      </div>
      <p className="mt-2 text-fg-muted">{t("newshub.subtitle")}</p>
      <FavoritesBar activeLeague={league.id} activeTeam={team} />

      {!league.live ? (
        <section className="mt-8 rounded-2xl border border-dashed border-line bg-fg/5 p-10 text-center">
          <div className="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {t("newshub.leagueSoon")}
          </div>
          <p className="mt-3 text-sm text-fg-muted">{t("newshub.leagueSoonNote", { league: name(league) })}</p>
        </section>
      ) : (
        <>
          {/* Club search + crest grid (favorites pinned first) */}
          <div className="mt-6">
            <TeamPicker
              league={league.id}
              teams={pickerTeams}
              value={team}
              onChange={setTeam}
              logos={!league.postseason}
            />
          </div>

          {/* Article feed — the real daily columns from /api/kbo/articles */}
          <section className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-dim">{t("newshub.articles")}</h2>
              <ReportSortTabs value={sort} onChange={setSort} />
            </div>
            {posts == null ? (
              <div className="mt-3 py-10 text-center text-fg-dim">{t("loading")}</div>
            ) : posts.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-line bg-fg/5 p-10 text-center">
                <p className="text-sm text-fg-muted">
                  {team == null
                    ? t("newshub.feedEmpty")
                    : t("newshub.teamEmpty", {
                        team: name(clubs.find((c) => c.code === team) ?? { ko: team, en: team }),
                      })}
                </p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {posts.map((c, i) => (
                  <Fragment key={`${c.team}-${c.article_date}`}>
                    {i === firstFreeIdx && firstFreeIdx > 0 && (
                      <PaidFreeDivider label={t("news.freeDivider")} />
                    )}
                    <Link
                      href={
                        league.soccer || league.postseason
                          ? `/reports/${leagueId}/${c.team}/${c.article_date}`
                          : `/kbo/news/${c.team}/${c.article_date}`
                      }
                      className="block rounded-2xl border border-line bg-fg/5 p-5 transition hover:border-accent"
                    >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {!league.postseason && <TeamLogo league={leagueId} code={c.team} name={c.ko} size="md" />}
                        <span className="truncate font-display text-base font-bold text-fg">{c.ko}</span>
                        {!league.postseason && isFavTeam(leagueId, c.team) && (
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
                  </Fragment>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
