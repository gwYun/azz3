"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";
import {
  type MatchupData, type Team, type Pitcher, type Batter, type BullpenState,
  starterForGame, bullpenForGame, optimizeLineup, muForOrder, evaluateMatchup, negBinomPmf,
} from "@/lib/matchup-sim";
import type { SimResult, SimRequest } from "@/lib/matchup.worker";
import { KboResultGate } from "@/components/KboResultGate";
import { useAccount } from "@/lib/useAccount";
import { isTeamSlotOpen } from "@/lib/credits";

const teamName = (t: { en: string; ko: string }, l: Locale) => (l === "ko" ? t.ko : t.en);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const HEAD = "grid items-center gap-x-2 border-b border-line bg-ink-850/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-dim";
const SERIES_GAMES = 5;

export default function MatchupPage() {
  const t = useT();
  const { locale } = useI18n();
  const { unlocked } = useAccount();
  const [data, setData] = useState<MatchupData | null>(null);
  const [homeCode, setHomeCode] = useState<string>("");
  const [awayCode, setAwayCode] = useState<string>("");
  const [game, setGame] = useState(0);
  const [useOptimal, setUseOptimal] = useState(false);
  const [leverage, setLeverage] = useState(true);
  const [sim, setSim] = useState<SimResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    fetch("/kbo-matchup.json").then((r) => r.json()).then((d: MatchupData) => {
      setData(d);
      if (d.teams.length >= 2) { setHomeCode(d.teams[0].code); setAwayCode(d.teams[1].code); }
    }).catch(() => setData(null));
  }, []);

  // 1,000,000-draw Monte Carlo runs off the main thread; falls back to the exact PMF.
  useEffect(() => {
    try {
      const w = new Worker(new URL("../../lib/matchup.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<SimResult>) => setSim(e.data);
      workerRef.current = w;
      return () => { w.terminate(); workerRef.current = null; };
    } catch {
      workerRef.current = null;
    }
  }, []);

  const engine = useMemo(() => {
    if (!data || !homeCode || !awayCode) return null;
    const home = data.teams.find((x) => x.code === homeCode);
    const away = data.teams.find((x) => x.code === awayCode);
    if (!home || !away || home === away) return null;
    const lg = data.league;
    const hs = starterForGame(home.rotation, game);
    const as = starterForGame(away.rotation, game);
    // Model each bullpen's availability for THIS game (top arms rest after throwing).
    const homePen = bullpenForGame(home.bullpen_arms, game, home.bullpen);
    const awayPen = bullpenForGame(away.bullpen_arms, game, away.bullpen);
    const eliteA = leverage ? awayPen.eliteRates : null;   // home offense faces away's pen
    const eliteH = leverage ? homePen.eliteRates : null;
    const hProj = home.lineup_projected.slice(0, 9);
    const aProj = away.lineup_projected.slice(0, 9);
    const hOpt = optimizeLineup(home.batters, hProj, as.rates, awayPen.rates, eliteA, as.sp_innings, lg, true, home.mu_calib);
    const aOpt = optimizeLineup(away.batters, aProj, hs.rates, homePen.rates, eliteH, hs.sp_innings, lg, false, away.mu_calib);
    const hOrder = useOptimal ? hOpt.order : hProj;
    const aOrder = useOptimal ? aOpt.order : aProj;
    const res = evaluateMatchup(lg, home, away, hOrder, aOrder, hs, as, homePen, awayPen, leverage);
    const projHmu = muForOrder(home.batters, hProj, as.rates, awayPen.rates, eliteA, as.sp_innings, lg, true, home.mu_calib);
    const projAmu = muForOrder(away.batters, aProj, hs.rates, homePen.rates, eliteH, hs.sp_innings, lg, false, away.mu_calib);
    return { home, away, lg, hs, as, homePen, awayPen, hProj, aProj, hOpt, aOpt, hOrder, aOrder, res, projHmu, projAmu };
  }, [data, homeCode, awayCode, game, useOptimal, leverage]);

  // Kick the Monte Carlo whenever the μ pair changes.
  useEffect(() => {
    if (!engine) return;
    const req: SimRequest = { muHome: engine.res.muHome, muAway: engine.res.muAway, k: engine.lg.k, n: 1_000_000 };
    if (workerRef.current) workerRef.current.postMessage(req);
    else setSim(null);
  }, [engine]);

  if (!data) return <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>;

  const teams = data.teams;
  const swap = () => { setHomeCode(awayCode); setAwayCode(homeCode); };

  // Lock indicator per team option. Unlocks are per team per slot, so the home
  // picker scores each team as a home pick and the away picker as an away pick
  // (independent purchases). Free teams (SS/HH) and owned slots show no lock.
  const homeLocked = (code: string) => !isTeamSlotOpen(code, "home", unlocked);
  const awayLocked = (code: string) => !isTeamSlotOpen(code, "away", unlocked);

  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t("matchup.eyebrow")}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">
        {t("matchup.title", { season: data.season })}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
        {t("matchup.subtitle", { sims: (1_000_000).toLocaleString() })}
      </p>

      {/* Selector */}
      <section className="mt-8 rounded-2xl border border-line bg-ink-850/50 p-5 sm:p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <TeamPick label={t("matchup.home")} value={homeCode} exclude={awayCode} teams={teams} locale={locale} onChange={setHomeCode} locked={homeLocked} />
          <button onClick={swap} className="btn-secondary mb-0.5 h-9 px-3 text-sm" aria-label={t("matchup.swap")}>⇄</button>
          <TeamPick label={t("matchup.away")} value={awayCode} exclude={homeCode} teams={teams} locale={locale} onChange={setAwayCode} locked={awayLocked} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">{t("matchup.series")}</span>
            <div className="flex gap-1">
              {Array.from({ length: SERIES_GAMES }, (_, i) => (
                <button key={i} onClick={() => setGame(i)}
                  className={"h-7 w-7 rounded-md text-sm font-mono transition " + (i === game ? "bg-accent text-white" : "bg-ink-800/60 text-fg-dim hover:text-fg")}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <Toggle label={t("matchup.toggle.optimal")} on={useOptimal} set={setUseOptimal} />
          <Toggle label={t("matchup.toggle.leverage")} on={leverage} set={setLeverage} />
        </div>
      </section>

      {engine && (
        <KboResultGate home={homeCode} away={awayCode}>
          {/* Win probability */}
          <section className="mt-8">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-display text-lg font-semibold text-fg">{teamName(engine.home, locale)} <span className="text-xs font-normal text-fg-dim">({t("matchup.home")})</span></span>
              <span className="font-display text-lg font-semibold text-fg">{teamName(engine.away, locale)} <span className="text-xs font-normal text-fg-dim">({t("matchup.away")})</span></span>
            </div>
            <div className="mt-2 flex h-11 overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-start bg-accent/25 pl-3 font-mono text-sm font-semibold text-fg transition-all"
                style={{ width: `${engine.res.homeWin * 100}%` }}>
                {engine.res.homeWin > 0.12 && pct(engine.res.homeWin)}
              </div>
              <div className="flex items-center justify-end bg-cyan/20 pr-3 font-mono text-sm font-semibold text-fg transition-all"
                style={{ width: `${engine.res.awayWin * 100}%` }}>
                {engine.res.awayWin > 0.12 && pct(engine.res.awayWin)}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label={t("matchup.winprob")}
                value={engine.res.homeWin >= engine.res.awayWin ? teamName(engine.home, locale) : teamName(engine.away, locale)}
                sub={pct(Math.max(engine.res.homeWin, engine.res.awayWin))} />
              <Stat label={t("matchup.expscore")}
                value={`${engine.res.muHome.toFixed(1)} : ${engine.res.muAway.toFixed(1)}`}
                sub={`${t("matchup.mu")}`} />
              <Stat label={t("matchup.dist.title")}
                value={sim ? (1_000_000).toLocaleString() : t("matchup.calc")}
                sub={sim ? t("matchup.sims", { sims: "" }).trim() : undefined} />
            </div>
          </section>

          {/* Run distribution */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{t("matchup.dist.title")}</h2>
            <Histogram
              home={distFrom(sim?.histHome, engine.res.muHome, engine.lg.k)}
              away={distFrom(sim?.histAway, engine.res.muAway, engine.lg.k)}
              homeLabel={teamName(engine.home, locale)} awayLabel={teamName(engine.away, locale)}
            />
          </section>

          {/* Lineups */}
          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <LineupColumn t={t} locale={locale} team={engine.home} starter={engine.hs} pen={engine.homePen}
              projOrder={engine.hProj} optOrder={engine.hOpt.order}
              projMu={engine.projHmu} optMu={engine.hOpt.mu} side={t("matchup.home")} />
            <LineupColumn t={t} locale={locale} team={engine.away} starter={engine.as} pen={engine.awayPen}
              projOrder={engine.aProj} optOrder={engine.aOpt.order}
              projMu={engine.projAmu} optMu={engine.aOpt.mu} side={t("matchup.away")} />
          </section>
          <p className="mt-3 text-xs leading-relaxed text-fg-dim">{t("matchup.lineup.note")}</p>
        </KboResultGate>
      )}

      {/* Method */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-base font-semibold tracking-tight text-fg">{t("matchup.method.title")}</h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-fg-dim">
          <li>{t("matchup.method.data")}</li>
          <li>{t("matchup.method.model")}</li>
          <li>{t("matchup.method.limits")}</li>
        </ul>
      </section>
    </article>
  );
}

// ---- subcomponents --------------------------------------------------------- //

function TeamPick({ label, value, exclude, teams, locale, onChange, locked }: {
  label: string; value: string; exclude: string; teams: Team[]; locale: Locale; onChange: (c: string) => void;
  locked?: (code: string) => boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-text mt-1 w-full">
        {teams.map((tm) => {
          const isLocked = tm.code !== exclude && locked?.(tm.code);
          return (
            <option key={tm.code} value={tm.code} disabled={tm.code === exclude}>
              {teamName(tm, locale)}{isLocked ? " 🔒" : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (b: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)}
        className="h-4 w-4 rounded border-line bg-ink-800 accent-accent" />
      {label}
    </label>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-850/40 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-dim">{label}</div>
      <div className="mt-1 font-display text-lg font-semibold text-fg">{value}</div>
      {sub && <div className="text-sm font-medium text-accent">{sub}</div>}
    </div>
  );
}

function LineupColumn({ t, locale, team, starter, pen, projOrder, optOrder, projMu, optMu, side }: {
  t: ReturnType<typeof useT>; locale: Locale; team: Team; starter: Pitcher; pen: BullpenState;
  projOrder: number[]; optOrder: number[]; projMu: number; optMu: number; side: string;
}) {
  const gain = optMu - projMu;
  const changed = optOrder.join(",") !== projOrder.join(",");
  return (
    <div className="rounded-xl border border-line bg-ink-850/30 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base font-semibold text-fg">{teamName(team, locale)}</h3>
        <span className="text-[11px] uppercase tracking-wide text-fg-dim">{side}</span>
      </div>
      <p className="mt-1 text-xs text-fg-dim">
        {t("matchup.starter")}: <span className="text-fg-muted">{starter.name}</span> · FIP {starter.fip.toFixed(2)} · {starter.sp_innings.toFixed(1)} IP
      </p>
      {pen.available.length + pen.down.length > 0 && (
        <p className="mt-1 text-xs text-fg-dim">
          {t("matchup.bullpen")}: <span className="text-fg-muted">{pen.available.slice(0, 4).map((a) => a.name).join(", ")}</span>
          {pen.down.length > 0 && (
            <> · {t("matchup.rested")}: <span className="text-fg-dim line-through">{pen.down.map((a) => a.name).join(", ")}</span></>
          )}
        </p>
      )}
      <LineupTable t={t} team={team} order={projOrder} title={t("matchup.lineup.projected")} />
      {changed && (
        <LineupTable t={t} team={team} order={optOrder}
          title={t("matchup.lineup.optimal")}
          badge={gain > 0.01 ? t("matchup.lineup.gain", { gain: gain.toFixed(2) }) : undefined} />
      )}
    </div>
  );
}

function LineupTable({ t, team, order, title, badge }: {
  t: ReturnType<typeof useT>; team: Team; order: number[]; title: string; badge?: string;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{title}</span>
        {badge && <span className="chip text-[11px] text-accent">{badge}</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className={HEAD + " grid-cols-[1.5rem_1fr_3rem_3rem]"}>
          <span className="text-right">{t("matchup.col.order")}</span>
          <span>{t("matchup.col.player")}</span>
          <span className="text-right">{t("matchup.col.wrc")}</span>
          <span className="text-right">{t("matchup.col.ob")}</span>
        </div>
        <ul className="divide-y divide-line/60">
          {order.map((idx, slot) => {
            const b: Batter = team.batters[idx];
            const ob = 1 - b.rates.out;
            return (
              <li key={idx} className="grid grid-cols-[1.5rem_1fr_3rem_3rem] items-center gap-x-2 px-3 py-1.5 text-sm">
                <span className="text-right font-mono text-fg-dim">{slot + 1}</span>
                <span className="truncate text-fg">{b.name}</span>
                <span className="text-right font-mono tabular-nums text-fg-muted">{b.wrc_plus.toFixed(0)}</span>
                <span className="text-right font-mono tabular-nums text-fg-dim">{(ob * 100).toFixed(0)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Histogram({ home, away, homeLabel, awayLabel }: {
  home: number[]; away: number[]; homeLabel: string; awayLabel: string;
}) {
  const cap = 14;
  const CHART_H = 128; // px — pixel heights avoid percentage-of-indefinite-parent collapse
  const max = Math.max(...home.slice(0, cap + 1), ...away.slice(0, cap + 1), 0.001);
  const bars = Array.from({ length: cap + 1 }, (_, r) => r);
  const px = (v: number) => (v > 0 ? Math.max(2, (v / max) * CHART_H) : 0);
  return (
    <div className="mt-3 rounded-xl border border-line bg-ink-850/30 p-4">
      <div className="mb-3 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent/70" />{homeLabel}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-cyan/60" />{awayLabel}</span>
      </div>
      <div className="flex items-end gap-1" style={{ height: CHART_H }}>
        {bars.map((r) => (
          <div key={r} className="flex flex-1 items-end justify-center gap-px">
            <span className="w-1/2 rounded-sm bg-accent/70" style={{ height: px(home[r]) }} />
            <span className="w-1/2 rounded-sm bg-cyan/60" style={{ height: px(away[r]) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {bars.map((r) => (
          <span key={r} className="flex-1 text-center font-mono text-[10px] text-fg-dim">{r}</span>
        ))}
      </div>
    </div>
  );
}

// Probability-per-run from the worker histogram (counts) or the exact NegBinom PMF.
function distFrom(hist: number[] | undefined, mu: number, k: number): number[] {
  if (hist && hist.length) {
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    return hist.map((c) => c / total);
  }
  return Array.from(negBinomPmf(mu, k, 25));
}
