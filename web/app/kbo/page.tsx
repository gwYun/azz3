"use client";

import { useEffect, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";

type Team = {
  en: string; ko: string; rank: number;
  championship: number; pennant: number; playoff: number; first: number;
  off_rating: number; def_rating: number; proj_wins: number;
  rs_per_game: number; ra_per_game: number; payroll_ok: number;
};
type Player = {
  name: string; franchise_ko: string; kind: string;
  war: number; metric: number; metric_label: string; salary_ok: number;
};
type BtRow = {
  season: number; standings_rho: number; pick_ko: string;
  actual_champ_ko: string; pick_correct: boolean; champ_prob_of_actual: number;
};
type KboData = {
  season: string; n_sims: number; seed: number;
  title_pick: { en: string; ko: string; prob: number };
  teams: Team[];
  players: Player[];
  backtest: {
    seasons: number[]; mean_standings_rho: number; champion_hit_rate: number;
    mean_prob_of_actual_champ: number; rows: BtRow[];
  };
};

const name = (n: { en: string; ko: string }, locale: Locale) => (locale === "ko" ? n.ko : n.en);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const HEAD = "grid items-center gap-x-2 border-b border-line bg-ink-850/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-dim";

export default function KboPage() {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<KboData | null>(null);

  useEffect(() => {
    fetch("/kbo.json").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>;
  }

  const champ = data.title_pick;
  const bt = data.backtest;
  const maxChamp = data.teams[0]?.championship || 1;
  const byWins = [...data.teams].sort((a, b) => b.proj_wins - a.proj_wins);

  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t("kbo.eyebrow")}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">
        {t("kbo.title", { season: data.season })}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
        {t("kbo.subtitle", { sims: data.n_sims.toLocaleString() })}
      </p>

      {/* Hero — the call + backtest credibility */}
      <section className="mt-10 rounded-2xl border border-line bg-ink-850/50 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-dim">{t("kbo.call.label")}</p>
        <p className="mt-3 text-xl font-medium leading-snug text-fg sm:text-2xl">
          {t("kbo.call.body", { first: name(champ, locale), season: data.season })}
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label={t("kbo.stat.champion")} value={name(champ, locale)} sub={fmtPct(champ.prob)} />
          <Stat label={t("kbo.bt.rho")} value={bt.mean_standings_rho.toFixed(2)} sub={t("kbo.bt.rhosub")} />
          <Stat label={t("kbo.bt.signal")} value={`${bt.mean_prob_of_actual_champ}%`} sub={t("kbo.bt.signalsub")} />
        </div>
        <p className="mt-6 text-xs text-fg-dim">{t("kbo.call.locked", { seed: String(data.seed) })}</p>
      </section>

      {/* Championship probability */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">{t("kbo.board.title")}</h2>
        <p className="mt-2 text-sm text-fg-muted">{t("kbo.board.note")}</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className={HEAD + " grid-cols-[2rem_1fr_4rem_4rem_4rem_3.5rem]"}>
            <span className="text-right">{t("kbo.col.rank")}</span>
            <span>{t("kbo.col.team")}</span>
            <span className="text-right">{t("kbo.col.champ")}</span>
            <span className="text-right">{t("kbo.col.pennant")}</span>
            <span className="text-right">{t("kbo.col.playoff")}</span>
            <span className="text-right">{t("kbo.col.first")}</span>
          </div>
          <ul>
            {data.teams.map((c, i) => (
              <li key={c.en}
                className={"relative grid grid-cols-[2rem_1fr_4rem_4rem_4rem_3.5rem] items-center gap-x-2 px-4 py-2.5 text-sm " + (i % 2 ? "bg-ink-850/40" : "bg-ink-800/20")}>
                <span aria-hidden className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${(c.championship / maxChamp) * 100}%` }} />
                <span className="relative z-10 text-right font-mono text-fg-dim">{c.rank}</span>
                <span className={"relative z-10 truncate " + (i < 5 ? "font-semibold text-fg" : "text-fg")}>{name(c, locale)}</span>
                <span className="relative z-10 text-right font-mono font-semibold tabular-nums text-fg">{c.championship.toFixed(1)}</span>
                <span className="relative z-10 text-right font-mono tabular-nums text-fg-dim">{c.pennant.toFixed(0)}</span>
                <span className="relative z-10 text-right font-mono tabular-nums text-fg-dim">{c.playoff.toFixed(0)}</span>
                <span className="relative z-10 text-right font-mono tabular-nums text-fg-dim">{c.first.toFixed(0)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Team strength + payroll */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">{t("kbo.strength.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("kbo.legend")}</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className={HEAD + " grid-cols-[2rem_1fr_3.5rem_3.5rem_4rem_4.5rem]"}>
            <span className="text-right">{t("kbo.col.rank")}</span>
            <span>{t("kbo.col.team")}</span>
            <span className="text-right">{t("kbo.col.off")}</span>
            <span className="text-right">{t("kbo.col.def")}</span>
            <span className="text-right">{t("kbo.col.wins")}</span>
            <span className="text-right">{t("kbo.col.payroll")}</span>
          </div>
          <ul className="divide-y divide-line">
            {byWins.map((s, i) => (
              <li key={s.en} className="grid grid-cols-[2rem_1fr_3.5rem_3.5rem_4rem_4.5rem] items-center gap-x-2 px-4 py-2.5 text-sm">
                <span className="text-right font-mono text-fg-dim">{i + 1}</span>
                <span className={i < 5 ? "font-semibold text-fg" : "text-fg"}>{name(s, locale)}</span>
                <span className="text-right font-mono tabular-nums text-fg">{s.off_rating.toFixed(0)}</span>
                <span className="text-right font-mono tabular-nums text-fg">{s.def_rating.toFixed(0)}</span>
                <span className="text-right font-mono font-semibold tabular-nums text-fg">{s.proj_wins.toFixed(1)}</span>
                <span className="text-right font-mono tabular-nums text-fg-dim">{s.payroll_ok}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Player value leaderboard */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">{t("kbo.players.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("kbo.players.note")}</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className={HEAD + " grid-cols-[2rem_1fr_3.5rem_5rem_4.5rem]"}>
            <span className="text-right">{t("kbo.col.rank")}</span>
            <span>{t("kbo.col.player")}</span>
            <span className="text-right">{t("kbo.col.war")}</span>
            <span className="text-right">{t("kbo.col.metric")}</span>
            <span className="text-right">{t("kbo.col.salary")}</span>
          </div>
          <ul className="divide-y divide-line">
            {data.players.map((p, i) => (
              <li key={p.name + i} className="grid grid-cols-[2rem_1fr_3.5rem_5rem_4.5rem] items-center gap-x-2 px-4 py-2.5 text-sm">
                <span className="text-right font-mono text-fg-dim">{i + 1}</span>
                <span className="truncate text-fg">{p.name} · <span className="text-fg-dim">{p.franchise_ko}</span></span>
                <span className="text-right font-mono font-semibold tabular-nums text-fg">{p.war.toFixed(1)}</span>
                <span className="text-right font-mono tabular-nums text-fg-dim">{p.metric_label} {p.metric}</span>
                <span className="text-right font-mono tabular-nums text-accent">{p.salary_ok}억</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Backtest */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">{t("kbo.bt.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("kbo.bt.note")}</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-line">
          <div className={HEAD + " grid-cols-[3rem_1fr_1fr_4rem]"}>
            <span className="text-right">{t("kbo.bt.col.season")}</span>
            <span>{t("kbo.bt.col.pick")}</span>
            <span>{t("kbo.bt.col.actual")}</span>
            <span className="text-right">{t("kbo.bt.col.prob")}</span>
          </div>
          <ul className="divide-y divide-line">
            {bt.rows.map((r) => (
              <li key={r.season} className="grid grid-cols-[3rem_1fr_1fr_4rem] items-center gap-x-2 px-4 py-2.5 text-sm">
                <span className="text-right font-mono text-fg-dim">{r.season}</span>
                <span className={r.pick_correct ? "font-semibold text-accent" : "text-fg"}>{r.pick_ko}</span>
                <span className="text-fg">{r.actual_champ_ko}</span>
                <span className="text-right font-mono tabular-nums text-fg-dim">{r.champ_prob_of_actual}%</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-sm text-fg-dim">
          {t("kbo.bt.summary", {
            rho: bt.mean_standings_rho.toFixed(2),
            hit: `${Math.round(bt.champion_hit_rate * 100)}`,
            sig: `${bt.mean_prob_of_actual_champ}`,
          })}
        </p>
      </section>

      {/* Method */}
      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-base font-semibold tracking-tight text-fg">{t("kbo.method.title")}</h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-fg-dim">
          {(["data", "pipeline", "backtest", "limits"] as const).map((k) => (
            <li key={k}>{t(`kbo.method.${k}` as Parameters<typeof t>[0])}</li>
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
