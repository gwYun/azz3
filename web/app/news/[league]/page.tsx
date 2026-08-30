"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useI18n, useT } from "@/lib/i18n-context";
import { getNewsLeague } from "@/lib/news/leagues";
import { FRANCHISES, TEAM_NAMES } from "@/lib/kbo/franchise";
import { PaidFreeDivider } from "@/components/PaidFreeDivider";

/**
 * News sub-tab page — one per league (/news/kbo, /news/epl, …). The live league
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
};

// The club roster for a live league. KBO (and its playoff view) use the 10
// franchises; soccer rosters arrive with each league's launch.
function clubsFor(leagueId: string): ClubOption[] {
  if (leagueId === "kbo" || leagueId === "kbo-playoff") {
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

  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<string | null>(null); // null = all clubs

  const clubs = useMemo(() => clubsFor(leagueId), [leagueId]);
  const filteredClubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter((c) => c.ko.toLowerCase().includes(q) || c.en.toLowerCase().includes(q));
  }, [clubs, query]);

  // Article feed — for the live KBO league, pull the real daily articles: the
  // latest per club (all-clubs view) or a single club's archive when filtered.
  const [posts, setPosts] = useState<NewsCard[] | null>(null);
  useEffect(() => {
    if (!league?.live || leagueId !== "kbo") {
      setPosts([]);
      return;
    }
    setPosts(null);
    let active = true;
    const q = team ? `?team=${team}` : "";
    fetch(`/api/kbo/articles${q}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (active) setPosts((j.cards ?? j.items ?? []) as NewsCard[]);
      })
      .catch(() => {
        if (active) setPosts([]);
      });
    return () => {
      active = false;
    };
  }, [league, leagueId, team]);

  // Index of the first free (older) article — the paid→free boundary for the divider.
  const firstFreeIdx = posts ? posts.findIndex((p) => !p.locked) : -1;

  if (!league) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">ValueTrack · {t("newshub.title")}</div>
      <h1 className="mt-1.5 font-display text-3xl font-bold text-fg">{name(league)}</h1>
      <p className="mt-2 text-fg-muted">{t("newshub.subtitle")}</p>

      {!league.live ? (
        <section className="mt-8 rounded-2xl border border-dashed border-line bg-fg/5 p-10 text-center">
          <div className="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {t("newshub.leagueSoon")}
          </div>
          <p className="mt-3 text-sm text-fg-muted">{t("newshub.leagueSoonNote", { league: name(league) })}</p>
        </section>
      ) : (
        <>
          {/* Club search + filter */}
          <div className="mt-6">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("newshub.searchTeams")}
              aria-label={t("newshub.searchTeams")}
              className="w-full rounded-xl border border-line bg-fg/5 px-4 py-2.5 text-sm text-fg outline-none placeholder:text-fg-dim focus:border-accent"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setTeam(null)}
                aria-pressed={team === null}
                className={
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition " +
                  (team === null
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-line text-fg-muted hover:border-accent/60 hover:text-fg")
                }
              >
                {t("newshub.allTeams")}
              </button>
              {filteredClubs.map((c) => {
                const active = team === c.code;
                return (
                  <button
                    key={c.code}
                    onClick={() => setTeam(active ? null : c.code)}
                    aria-pressed={active}
                    className={
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition " +
                      (active
                        ? "border-accent bg-accent/15 text-fg"
                        : "border-line text-fg-muted hover:border-accent/60 hover:text-fg")
                    }
                  >
                    {name(c)}
                  </button>
                );
              })}
            </div>
            {query.trim() !== "" && filteredClubs.length === 0 && (
              <p className="mt-3 text-sm text-fg-dim">{t("newshub.noTeamMatch")}</p>
            )}
          </div>

          {/* Article feed — the real daily columns from /api/kbo/articles */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-dim">{t("newshub.articles")}</h2>
            {posts == null ? (
              <div className="mt-3 py-10 text-center text-fg-dim">{t("loading")}</div>
            ) : posts.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-line bg-fg/5 p-10 text-center">
                <p className="text-sm text-fg-muted">
                  {team == null
                    ? t("newshub.feedEmpty")
                    : t("newshub.teamEmpty", { team: name(TEAM_NAMES[team as keyof typeof TEAM_NAMES]) })}
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
                      href={`/kbo/news/${c.team}/${c.article_date}`}
                      className="block rounded-2xl border border-line bg-fg/5 p-5 transition hover:border-accent"
                    >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-base font-bold text-fg">{c.ko}</span>
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-semibold " +
                          (c.locked ? "bg-accent/15 text-accent" : "bg-fg/10 text-fg-muted")
                        }
                      >
                        {c.locked ? t("news.badge.paid") : t("news.badge.free")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-fg">{c.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{c.dek}</p>
                    <div className="mt-3 text-xs font-semibold text-accent">
                      {c.article_date} · {t("news.read")} →
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
