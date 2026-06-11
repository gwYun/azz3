"use client";

import { useEffect, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";

type Nation = { en: string; ko: string; win: number; sf: number };
type Stage1 = { en: string; ko: string; rating: number; tm: number; syn: number; core: number };
type WcData = {
  n_sims: number;
  seed: number;
  top4: string[];
  top4_en: string[];
  top4_prob: number;
  nations: Nation[];
  stage1: Stage1[];
};

const name = (n: { en: string; ko: string }, locale: Locale) => (locale === "ko" ? n.ko : n.en);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

export default function WorldCupPage() {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<WcData | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/worldcup.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>
    );
  }

  const champ = data.nations[0];
  const shown = expanded ? data.nations : data.nations.slice(0, 12);
  const maxWin = data.nations[0].win;

  return (
    <article className="mx-auto max-w-3xl">
      {/* Header */}
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {t("wc.eyebrow")}
      </p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">
        {t("wc.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
        {t("wc.subtitle", { sims: data.n_sims.toLocaleString() })}
      </p>

      {/* The call — hero card */}
      <section className="mt-10 rounded-2xl border border-line bg-ink-850/50 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">
          {t("wc.call.label")}
        </p>
        <p className="mt-3 text-xl font-medium leading-snug text-fg sm:text-2xl">
          {t("wc.call.body", { first: name(champ, locale) })}
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label={t("wc.stat.champion")} value={name(champ, locale)} sub={fmtPct(champ.win)} />
          <Stat label={t("wc.stat.top4prob")} value={`${data.top4_prob.toFixed(2)}%`} />
          <Stat label={t("wc.stat.sims")} value={data.n_sims.toLocaleString()} />
        </div>

        <p className="mt-6 text-xs text-fg-dim">
          {t("wc.call.locked", { seed: String(data.seed) })}
        </p>
      </section>

      {/* Title probability leaderboard */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("wc.leaderboard.title")}
        </h2>
        <p className="mt-2 text-sm text-fg-muted">{t("wc.leaderboard.note")}</p>

        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem] gap-x-3 border-b border-line bg-ink-850/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-dim">
            <span className="text-right">{t("wc.col.rank")}</span>
            <span>{t("wc.col.nation")}</span>
            <span className="text-right">{t("wc.col.win")}</span>
            <span className="text-right">{t("wc.col.sf")}</span>
          </div>
          <ul>
            {shown.map((n, i) => {
              const top4 = i < 4;
              return (
                <li
                  key={n.en}
                  className={
                    "relative grid grid-cols-[2.5rem_1fr_5rem_5rem] items-center gap-x-3 px-4 py-2.5 text-sm " +
                    (i % 2 ? "bg-ink-850/40" : "bg-ink-800/20")
                  }
                >
                  {/* win-prob bar */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-accent/10"
                    style={{ width: `${(n.win / maxWin) * 100}%` }}
                  />
                  <span className="relative z-10 text-right font-mono text-fg-dim">{i + 1}</span>
                  <span
                    className={
                      "relative z-10 truncate " +
                      (top4 ? "font-semibold text-fg" : "text-fg")
                    }
                  >
                    {name(n, locale)}
                  </span>
                  <span className="relative z-10 text-right font-mono font-semibold tabular-nums text-fg">
                    {n.win.toFixed(1)}
                  </span>
                  <span className="relative z-10 text-right font-mono tabular-nums text-fg-dim">
                    {n.sf.toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-sm font-medium text-accent hover:text-accent-dark"
        >
          {expanded ? t("wc.leaderboard.less") : t("wc.leaderboard.more")}
        </button>
      </section>

      {/* Most likely final four */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("wc.semifinal.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
          {t("wc.semifinal.body")}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.nations.slice(0, 4).map((n, i) => (
            <div
              key={n.en}
              className="rounded-xl border border-line bg-ink-850/40 p-4 text-center"
            >
              <div className="font-mono text-xs text-fg-dim">{i + 1}</div>
              <div className="mt-1 font-display text-lg font-semibold text-fg">
                {name(n, locale)}
              </div>
              <div className="mt-1 text-sm font-medium text-accent">{fmtPct(n.win)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Squad strength ranking */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("wc.strength.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
          {t("wc.strength.note")}
        </p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[2.5rem_1fr_4.5rem_6rem_4rem] gap-x-3 border-b border-line bg-ink-850/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-dim">
            <span className="text-right">{t("wc.col.rank")}</span>
            <span>{t("wc.col.nation")}</span>
            <span className="text-right">{t("wc.col.rating")}</span>
            <span className="text-right">{t("wc.col.tm")}</span>
            <span className="text-right">{t("wc.col.synergy")}</span>
          </div>
          <ul className="divide-y divide-line">
            {data.stage1.map((s, i) => (
              <li
                key={s.en}
                className="grid grid-cols-[2.5rem_1fr_4.5rem_6rem_4rem] items-center gap-x-3 px-4 py-2.5 text-sm"
              >
                <span className="text-right font-mono text-fg-dim">{i + 1}</span>
                <span className={i < 4 ? "font-semibold text-fg" : "text-fg"}>
                  {name(s, locale)}
                </span>
                <span className="text-right font-mono font-semibold tabular-nums text-fg">
                  {s.rating.toFixed(1)}
                </span>
                <span className="text-right font-mono tabular-nums text-fg-dim">
                  {s.tm.toLocaleString()}
                </span>
                <span className="text-right font-mono tabular-nums text-fg-dim">
                  {s.syn.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why these four */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {t("wc.reasoning.title")}
        </h2>
        <ul className="mt-5 space-y-3">
          {(["france", "england", "spain", "portugal"] as const).map((k) => (
            <li
              key={k}
              className="rounded-lg border-l-2 border-accent/50 bg-ink-850/50 px-4 py-3 text-sm leading-relaxed text-fg-muted"
            >
              {t(`wc.reasoning.${k}` as Parameters<typeof t>[0])}
            </li>
          ))}
        </ul>
      </section>

      {/* Method */}
      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-base font-semibold tracking-tight text-fg">
          {t("wc.method.title")}
        </h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-fg-dim">
          {(["model", "input", "coverage", "sims"] as const).map((k) => (
            <li key={k}>{t(`wc.method.${k}` as Parameters<typeof t>[0])}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-850/40 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold text-fg">{value}</div>
      {sub && <div className="text-sm font-medium text-accent">{sub}</div>}
    </div>
  );
}
