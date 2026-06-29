"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";

type Scenario = { to_ko: string; to_en: string; premium: number; fee_eur: number; fee_usd_man: string; fee_usd_en: string; rough?: boolean };
type Contract = { years: number; fee_eur: number; fee_usd_man: string };
type Stats = { gls: number; ast: number; min: number; mp: number };
type Player = {
  id: string;
  img?: string;
  name: string;
  name_ko: string;
  from_ko: string;
  from_en: string;
  nat_ko: string;
  nat_en: string;
  age: number;
  pos: string;
  mv_eur: number;
  type: "single" | "multi" | "free_agent";
  neutral_eur?: number;
  scenarios?: Scenario[];
  contract_scenarios?: Contract[];
  free_fee_eur?: number;
  stats: Stats;
};
type TfData = { players: Player[] };

const eurM = (v: number) => `€${Math.round(v / 1e6)}M`;

export default function TransfersPage() {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<TfData | null>(null);

  useEffect(() => {
    fetch("/transfers.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>;
  }

  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t("tf.eyebrow")}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">{t("tf.title")}</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">{t("tf.subtitle")}</p>

      <div className="mt-10 space-y-6">
        {data.players.map((p, i) => (
          <PlayerCard key={p.id} p={p} index={i} t={t} locale={locale} />
        ))}
      </div>

      {/* Note */}
      <p className="mt-10 border-t border-line pt-6 text-xs text-fg-dim">{t("tf.note")}</p>
    </article>
  );
}

function PlayerCard({ p, index, t, locale }: { p: Player; index: number; t: ReturnType<typeof useT>; locale: Locale }) {
  const ko = locale === "ko";
  const primary = ko ? p.name_ko : p.name;
  const secondary = ko ? p.name : p.name_ko;
  const img = p.img ?? `/players/${p.id}.jpg`;
  return (
    <section className="panel p-6 sm:p-7">
      {/* header: photo + identity */}
      <div className="flex items-start gap-4 sm:gap-5">
        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-line sm:h-24 sm:w-20">
          <Image
            src={img}
            alt={primary}
            fill
            sizes="80px"
            className="object-cover object-top"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-2xl font-semibold text-fg">
              <span className="mr-2 font-mono text-base text-fg-dim">0{index + 1}</span>
              {primary}
              <span className="ml-2 text-base font-normal text-fg-dim">{secondary}</span>
            </h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
            <span>
              <span className="text-fg-dim">{t("tf.from")}:</span> {ko ? p.from_ko : p.from_en}
            </span>
            <span>
              <span className="text-fg-dim">{t("tf.age")}:</span> {p.age} · {ko ? p.nat_ko : p.nat_en} · {p.pos}
            </span>
            <span>
              <span className="text-fg-dim">{t("tf.value")}:</span> {eurM(p.mv_eur)}
            </span>
          </div>
        </div>
      </div>

      {/* key stats (2025/26) */}
      <StatChips stats={p.stats} t={t} />

      {/* body by type */}
      {p.type === "free_agent" ? (
        <FreeAgent p={p} t={t} />
      ) : (
        <Destinations p={p} t={t} locale={locale} />
      )}
    </section>
  );
}

function StatChips({ stats, t }: { stats: Stats; t: ReturnType<typeof useT> }) {
  const items = [
    { label: t("tf.stat.apps"), value: stats.mp },
    { label: t("tf.stat.g"), value: stats.gls },
    { label: t("tf.stat.a"), value: stats.ast },
    { label: t("tf.stat.min"), value: stats.min.toLocaleString() },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <span className="chip border-cyan/20 text-cyan">{t("tf.stats.label")}</span>
      {items.map((it) => (
        <span key={it.label} className="chip">
          <span className="font-mono font-semibold text-fg">{it.value}</span>
          <span className="text-fg-dim">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function Destinations({ p, t, locale }: { p: Player; t: ReturnType<typeof useT>; locale: Locale }) {
  const scenarios = p.scenarios ?? [];
  const best = Math.max(...scenarios.map((s) => s.fee_eur));
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-[1fr_9rem] gap-x-3 border-b border-line bg-ink-800/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
        <span>{t("tf.col.dest")}</span>
        <span className="text-right">{t("tf.col.fee")}</span>
      </div>
      <ul className="divide-y divide-line">
        {scenarios.map((s) => {
          const top = s.fee_eur === best && scenarios.length > 1;
          return (
            <li
              key={s.to_ko}
              className="grid grid-cols-[1fr_9rem] items-center gap-x-3 px-4 py-3 text-sm"
            >
              <span className={top ? "font-semibold text-fg" : "text-fg"}>
                {locale === "ko" ? s.to_ko : s.to_en}
                {s.rough && (
                  <span className="ml-2 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-dim">
                    {t("tf.rough")}
                  </span>
                )}
              </span>
              <span className="text-right">
                <span className={"font-display font-semibold " + (top ? "text-accent" : "text-fg")}>
                  {eurM(s.fee_eur)}
                </span>
                <span className="block text-xs text-fg-dim">
                  {locale === "ko" ? s.fee_usd_man : s.fee_usd_en}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FreeAgent({ p, t }: { p: Player; t: ReturnType<typeof useT> }) {
  const rows = p.contract_scenarios ?? [];
  const maxFee = Math.max(...rows.map((r) => r.fee_eur));
  const yr = (n: number) => (n === 0 ? t("tf.salah.expired") : t("tf.salah.yr", { n: String(n) }));
  return (
    <div className="mt-5">
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[1fr_8rem] gap-x-3 border-b border-line bg-ink-800/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
          <span>{t("tf.salah.contract")}</span>
          <span className="text-right">{t("tf.salah.modelfee")}</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li
              key={r.years}
              className="relative grid grid-cols-[1fr_8rem] items-center gap-x-3 px-4 py-2.5 text-sm"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-cyan/10"
                style={{ width: `${(r.fee_eur / maxFee) * 100}%` }}
              />
              <span className={"relative z-10 " + (r.years === 0 ? "font-semibold text-fg" : "text-fg-muted")}>
                {yr(r.years)}
              </span>
              <span className="relative z-10 text-right font-display font-semibold text-fg">
                {eurM(r.fee_eur)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* reality callout */}
      <div className="mt-3 flex items-center justify-between rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
        <span className="text-sm text-fg-muted">{t("tf.salah.reality")}</span>
        <span className="font-display text-lg font-bold text-accent">{t("tf.salah.free")}</span>
      </div>
    </div>
  );
}
