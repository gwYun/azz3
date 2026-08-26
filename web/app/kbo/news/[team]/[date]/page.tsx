"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n-context";
import { ArticleGate } from "@/components/ArticleGate";
import type { ArticleTeaser } from "@/lib/kbo/article-types";

type Article = {
  team: string;
  ko: string;
  article_date: string;
  title: string;
  dek: string;
  teaser: ArticleTeaser | null;
  locked: boolean;
  owned: boolean;
  body_html: string | null;
};

export default function ArticlePage() {
  const t = useT();
  const params = useParams<{ team: string; date: string }>();
  const team = String(params.team);
  const date = String(params.date);

  const [data, setData] = useState<Article | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/kbo/article/${team}/${date}`, { cache: "no-store" });
      if (!res.ok) {
        setState("error");
        return;
      }
      setData((await res.json()) as Article);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [team, date]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") {
    return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-fg-dim">{t("loading")}</div>;
  }
  if (state === "error" || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-fg-dim">
        <p>{t("news.empty")}</p>
        <Link href="/kbo/news" className="mt-4 inline-block text-sm text-accent">
          {t("news.back")}
        </Link>
      </div>
    );
  }

  const teaser = data.teaser;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/kbo/news" className="text-sm text-accent">
        {t("news.back")}
      </Link>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-accent">{teaser?.kicker}</div>
      <h1 className="mt-2 font-display text-3xl font-bold text-fg">{data.title}</h1>
      <p className="mt-2 text-fg-muted">{data.dek}</p>

      {teaser && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-line px-3 py-1 text-fg-muted">
            {t("news.rank", { n: String(teaser.rank) })}
          </span>
          <span className="rounded-full border border-line px-3 py-1 text-fg-muted">
            {teaser.record} · {teaser.pct}
          </span>
          <span className="rounded-full border border-line px-3 py-1 text-fg-muted">
            {t("news.remaining", { n: String(teaser.gamesRemaining) })}
          </span>
          {teaser.today && (
            <span className="rounded-full border border-line px-3 py-1 text-fg-muted">{teaser.today}</span>
          )}
        </div>
      )}

      <ArticleGate team={team} date={date} bodyHtml={data.body_html} onUnlocked={load} />
    </div>
  );
}
