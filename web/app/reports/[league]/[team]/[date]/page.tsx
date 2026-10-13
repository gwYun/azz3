"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n-context";
import { ArticleGate } from "@/components/kbo/ArticleGate";
import type { SoccerTeaser } from "@/lib/soccer/article-types";
import type { PsTeaser } from "@/lib/kbo/postseason-articles";

/**
 * Report reader for soccer match reports (/reports/<league>/<team>/<date>) and
 * KBO postseason series reports (/reports/kbo-playoff/<round>/<date>). Same
 * hard paywall as the KBO reader: the gated route only returns body_html when
 * the report is free-by-age (anything but the newest) or owned.
 */
type Report = {
  league: string;
  team: string;
  ko: string;
  article_date: string;
  title: string;
  dek: string;
  teaser: (SoccerTeaser & Partial<PsTeaser>) | (PsTeaser & Partial<SoccerTeaser>) | null;
  locked: boolean;
  owned: boolean;
  body_html: string | null;
};

export default function SoccerReportPage() {
  const t = useT();
  const params = useParams<{ league: string; team: string; date: string }>();
  const league = String(params.league);
  const team = String(params.team);
  const date = String(params.date);
  const isPost = league === "kbo-playoff";
  const apiUrl = isPost ? `/api/kbo/postseason/article/${team}/${date}` : `/api/soccer/article/${league}/${team}/${date}`;

  const [data, setData] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl, { cache: "no-store" });
      if (!res.ok) {
        setState("error");
        return;
      }
      setData((await res.json()) as Report);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const back = `/reports/${league}`;
  if (state === "loading") {
    return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-fg-dim">{t("loading")}</div>;
  }
  if (state === "error" || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-fg-dim">
        <p>{t("news.empty")}</p>
        <Link href={back} className="mt-4 inline-block text-sm text-accent">
          ← {t("newshub.title")}
        </Link>
      </div>
    );
  }

  const teaser = data.teaser;
  const chip = "rounded-full border border-line px-3 py-1 text-fg-muted";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href={back} className="text-sm text-accent">
        ← {t("newshub.title")}
      </Link>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-accent">{teaser?.kicker}</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-fg">{data.title}</h1>
      <p className="mt-2 text-fg-muted">{data.dek}</p>

      {teaser && isPost && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {teaser.seriesLine && <span className={chip}>{teaser.seriesLine}</span>}
          {teaser.result && <span className={chip}>{teaser.result}</span>}
          {teaser.today && <span className={chip}>{teaser.today}</span>}
        </div>
      )}
      {teaser && !isPost && teaser.rank != null && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={chip}>{t("news.rank", { n: String(teaser.rank) })}</span>
          <span className={chip}>
            {teaser.record} · {t("soccer.points", { n: String(teaser.pts) })}
          </span>
          <span className={chip}>{teaser.result}</span>
          {teaser.next && <span className={chip}>{teaser.next}</span>}
        </div>
      )}

      <ArticleGate
        team={team}
        date={date}
        bodyHtml={data.body_html}
        onUnlocked={load}
        unlockBody={isPost ? { kind: "kbo-postseason-article", round: team, date } : { kind: "soccer-article", league, team, date }}
        lockedNote={isPost ? t("postseason.heroLocked") : t("soccer.heroLocked")}
      />
    </div>
  );
}
