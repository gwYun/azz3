"use client";

import { useEffect, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";

type Dest = {
  rank: number; club: string; club_ko: string; league: string;
  fee_low_eur: number; fee_high_eur: number;
};
type Star = {
  rank: number; name: string; name_ko: string; nation: string; nation_ko: string;
  position: string; age: number; current_club: string;
  v0_eur: number; v1_eur: number; multiplier: number; jump_eur: number; v0_source: string;
  wc_goals: number; wc_assists: number; wc_rating: number; P: number; E: number;
  mover_status: string | null; actual_move: boolean;
  headline_club: string; headline_club_ko: string; headline_prestige: number;
  fee_low_eur: number; fee_high_eur: number;
  destinations: Dest[];
};
type Awards = {
  golden_boot: { player: string; goals: number };
  golden_ball: { player: string };
  young_player: { player: string; age: number };
};
type Mover = {
  name: string; status: string; pred_M: number | null; pred_V1_eur: number | null;
  real_eur: number | null; ratio_pred_over_real: number | null;
};
type Data = {
  generated_utc: string;
  tournament: { champion: string; runner_up: string; third: string; awards: Awards };
  james_pick: { name: string; name_ko: string; rank: number };
  board: Star[];
  validation: { james: { model_mult: number; target_mult: number; abs_err: number };
                movers: Mover[]; median_pred_over_real: number | null; note: string };
};

const eurM = (v: number) => `€${Math.round(v / 1e6)}M`;
const feeRange = (lo: number, hi: number) => `€${Math.round(lo / 1e6)}~${Math.round(hi / 1e6)}M`;

export default function WorldCupStarsPage() {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    fetch("/worldcup-stars.json").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data) {
    return <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>;
  }

  const ko = locale === "ko";
  const james = data.board.find((s) => s.name === data.james_pick.name) ?? data.board[0];
  const maxJump = Math.max(...data.board.map((s) => s.jump_eur), 1);

  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t("wcs.eyebrow")}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">{t("wcs.title")}</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">{t("wcs.subtitle")}</p>

      {/* Tournament result + awards strip */}
      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <span className="chip border-accent/20 text-accent">{t("wcs.result")}</span>
        <span className="chip"><span className="text-fg-dim">🏆</span><span className="font-semibold text-fg">{ko ? nationKo(data.tournament.champion) : data.tournament.champion}</span></span>
        <span className="chip"><span className="text-fg-dim">{t("wcs.goldenBoot")}</span><span className="text-fg">{data.tournament.awards.golden_boot.player} · {data.tournament.awards.golden_boot.goals}</span></span>
        <span className="chip"><span className="text-fg-dim">{t("wcs.youngPlayer")}</span><span className="text-fg">{data.tournament.awards.young_player.player}</span></span>
      </div>

      {/* 하메스 픽 featured card */}
      <JamesCard s={james} t={t} ko={ko} />

      {/* Breakout board */}
      <h2 className="mt-10 font-display text-2xl font-semibold text-fg">{t("wcs.board.title")}</h2>
      <p className="mt-1 text-sm text-fg-dim">{t("wcs.board.sub")}</p>
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[1.6rem_1fr_5.5rem_7rem] gap-x-2 border-b border-line bg-ink-800/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-dim sm:grid-cols-[1.6rem_1fr_8rem_9rem]">
          <span>#</span>
          <span>{t("wcs.col.player")}</span>
          <span className="text-right">{t("wcs.col.jump")}</span>
          <span className="text-right">{t("wcs.col.dest")}</span>
        </div>
        <ul className="divide-y divide-line">
          {data.board.map((s) => (
            <BoardRow key={s.name} s={s} t={t} ko={ko} maxJump={maxJump} isJames={s.name === james.name} />
          ))}
        </ul>
      </div>

      {/* Top detail cards (destinations per player) */}
      <h2 className="mt-10 font-display text-2xl font-semibold text-fg">{t("wcs.detail.title")}</h2>
      <div className="mt-4 space-y-4">
        {data.board.slice(0, 5).map((s) => (
          <DetailCard key={s.name} s={s} t={t} ko={ko} isJames={s.name === james.name} />
        ))}
      </div>

      {/* Validation */}
      <Validation v={data.validation} t={t} />

      <p className="mt-8 border-t border-line pt-6 text-xs leading-relaxed text-fg-dim">{t("wcs.note")}</p>
    </article>
  );
}

function moverTag(status: string | null, t: ReturnType<typeof useT>): string | null {
  if (status === "confirmed") return t("wcs.mover.confirmed");
  if (status === "rumored") return t("wcs.mover.rumored");
  return null;
}

function JamesCard({ s, t, ko }: { s: Star; t: ReturnType<typeof useT>; ko: boolean }) {
  const tag = moverTag(s.mover_status, t);
  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-accent/40 bg-accent/[0.07] p-6 shadow-glow sm:p-7">
      <div className="flex items-center gap-2">
        <span className="chip border-accent/40 bg-accent/10 text-accent">★ {t("wcs.james.tag")}</span>
        {tag && <span className="chip border-cyan/20 text-cyan">{tag}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-3xl font-semibold text-fg">{ko ? s.name_ko : s.name}</h2>
        <span className="text-base text-fg-dim">{ko ? s.name : s.name_ko}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {ko ? s.nation_ko : s.nation} · {s.current_club} · {t("wcs.age")} {s.age} · {s.position}
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ValueTile label={t("wcs.before")} value={eurM(s.v0_eur)} />
        <ValueTile label={t("wcs.after")} value={eurM(s.v1_eur)} accent
          badge={`×${s.multiplier.toFixed(2)}`} />
        <ValueTile label={t("wcs.dest.fee", { club: ko ? s.headline_club_ko : s.headline_club })}
          value={feeRange(s.fee_low_eur, s.fee_high_eur)} accent />
      </div>
    </section>
  );
}

function ValueTile({ label, value, accent, badge }: { label: string; value: string; accent?: boolean; badge?: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-fg-dim">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={"font-display text-2xl font-bold " + (accent ? "text-accent" : "text-fg")}>{value}</span>
        {badge && <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">{badge}</span>}
      </div>
    </div>
  );
}

function BoardRow({ s, t, ko, maxJump, isJames }: { s: Star; t: ReturnType<typeof useT>; ko: boolean; maxJump: number; isJames: boolean }) {
  return (
    <li className="relative grid grid-cols-[1.6rem_1fr_5.5rem_7rem] items-center gap-x-2 px-3 py-2.5 text-sm sm:grid-cols-[1.6rem_1fr_8rem_9rem]">
      <span aria-hidden className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${(s.jump_eur / maxJump) * 100}%` }} />
      <span className="relative z-10 font-mono text-fg-dim">{s.rank}</span>
      <span className="relative z-10 min-w-0 truncate">
        <span className={isJames ? "font-semibold text-accent" : "text-fg"}>{ko ? s.name_ko : s.name}</span>
        {isJames && <span className="ml-1 text-accent">★</span>}
        <span className="ml-1.5 text-xs text-fg-dim">{ko ? s.nation_ko : s.nation} · {s.age}</span>
      </span>
      <span className="relative z-10 text-right">
        <span className="text-fg-dim">{eurM(s.v0_eur)}</span>
        <span className="text-fg-dim">→</span>
        <span className="font-display font-semibold text-fg">{eurM(s.v1_eur)}</span>
        <span className="ml-1 font-mono text-[11px] text-accent">×{s.multiplier.toFixed(2)}</span>
      </span>
      <span className="relative z-10 truncate text-right text-fg-muted">
        {ko ? s.headline_club_ko : s.headline_club}
        {s.actual_move && <span className="ml-1 text-cyan" title={t("wcs.mover.confirmed")}>✔</span>}
      </span>
    </li>
  );
}

function DetailCard({ s, t, ko, isJames }: { s: Star; t: ReturnType<typeof useT>; ko: boolean; isJames: boolean }) {
  const tag = moverTag(s.mover_status, t);
  const best = Math.max(...s.destinations.map((d) => d.fee_high_eur), 1);
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-xl font-semibold text-fg">
          <span className="mr-2 font-mono text-sm text-fg-dim">{s.rank}</span>
          {ko ? s.name_ko : s.name}
          {isJames && <span className="ml-1.5 text-accent">★</span>}
          <span className="ml-2 text-sm font-normal text-fg-dim">{ko ? s.nation_ko : s.nation} · {s.age} · {s.position}</span>
        </h3>
        <span className="font-display text-lg font-semibold text-accent">
          {eurM(s.v0_eur)} → {eurM(s.v1_eur)} <span className="font-mono text-sm">×{s.multiplier.toFixed(2)}</span>
        </span>
      </div>
      {tag && <div className="mt-2"><span className="chip border-cyan/20 text-cyan">{tag}</span></div>}

      {s.actual_move && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-cyan/40 bg-cyan/[0.08] px-4 py-3">
          <span className="text-sm text-fg-muted">
            ✔ {t("wcs.actual.label")}: <span className="font-semibold text-fg">{ko ? s.headline_club_ko : s.headline_club}</span>
          </span>
          <span className="font-display text-lg font-bold text-cyan">{eurM(s.fee_low_eur)}</span>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[1fr_9rem] gap-x-3 border-b border-line bg-ink-800/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-dim">
          <span>{s.actual_move ? t("wcs.modelfit") : t("wcs.dest.title")}</span>
          <span className="text-right">{t("wcs.col.fee")}</span>
        </div>
        <ul className="divide-y divide-line">
          {s.destinations.slice(0, 3).map((d, i) => (
            <li key={d.club} className="relative grid grid-cols-[1fr_9rem] items-center gap-x-3 px-4 py-2.5 text-sm">
              <span aria-hidden className="absolute inset-y-0 left-0 bg-cyan/10" style={{ width: `${(d.fee_high_eur / best) * 100}%` }} />
              <span className={"relative z-10 " + (i === 0 ? "font-semibold text-fg" : "text-fg-muted")}>{ko ? d.club_ko : d.club}</span>
              <span className={"relative z-10 text-right font-display font-semibold " + (i === 0 ? "text-accent" : "text-fg")}>{feeRange(d.fee_low_eur, d.fee_high_eur)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Validation({ v, t }: { v: Data["validation"]; t: ReturnType<typeof useT> }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-semibold text-fg">{t("wcs.valid.title")}</h2>
      <p className="mt-2 text-sm text-fg-muted">
        {t("wcs.valid.james", { model: v.james.model_mult.toFixed(2), target: v.james.target_mult.toFixed(2) })}
      </p>
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[1fr_5rem_5rem_4rem] gap-x-2 border-b border-line bg-ink-800/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
          <span>{t("wcs.col.player")}</span>
          <span className="text-right">{t("wcs.valid.pred")}</span>
          <span className="text-right">{t("wcs.valid.real")}</span>
          <span className="text-right">{t("wcs.valid.ratio")}</span>
        </div>
        <ul className="divide-y divide-line">
          {v.movers.map((m) => (
            <li key={m.name} className="grid grid-cols-[1fr_5rem_5rem_4rem] items-center gap-x-2 px-4 py-2.5 text-sm">
              <span className="truncate text-fg">{m.name}</span>
              <span className="text-right text-fg-muted">{m.pred_V1_eur ? eurM(m.pred_V1_eur) : "—"}</span>
              <span className="text-right text-fg-muted">{m.real_eur ? eurM(m.real_eur) : "—"}</span>
              <span className="text-right font-mono text-fg-dim">{m.ratio_pred_over_real ?? "—"}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-fg-dim">{t("wcs.valid.note")}</p>
    </section>
  );
}

// Korean names for the four semifinalist nations shown in the result strip.
function nationKo(n: string): string {
  const m: Record<string, string> = { Spain: "스페인", Argentina: "아르헨티나", England: "잉글랜드", France: "프랑스" };
  return m[n] ?? n;
}
