"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";
import {
  type MatchupData, type Team, type Pitcher, type Batter, type BullpenState,
  starterForGame, bullpenForGame, optimizeLineup, muForOrder, evaluateMatchup,
} from "@/lib/matchup-sim";
import { KboResultGate } from "@/components/KboResultGate";
import { useAccount } from "@/lib/useAccount";
import { isTeamSlotOpen } from "@/lib/credits";

const teamName = (t: { en: string; ko: string }, l: Locale) => (l === "ko" ? t.ko : t.en);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtDate = (d: string) => d.slice(5).replace("-", "/"); // 'YYYY-MM-DD' → 'MM/DD'
// KBO plays 8 home games vs each opponent — a fixed slate per orientation. Played games
// fill their slots with real results; the rest are predictions (robust to the live
// schedule being incomplete/lopsided from rain-out makeups and unplaced late games).
const HOME_SLATE = 8;
const HEAD = "grid items-center gap-x-2 border-b border-line bg-ink-850/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-dim";

type H2HGame = {
  game_id: string; game_date: string; home_team: string; away_team: string;
  home_score: number | null; away_score: number | null; winner: string | null; status: string;
};
type H2H = { a: string; b: string; record: { a: number; b: number; tie: number } | null; played: number; games: H2HGame[] };

export default function MatchupPage() {
  const t = useT();
  const { locale } = useI18n();
  const { unlocked } = useAccount();
  const [data, setData] = useState<MatchupData | null>(null);
  const [homeCode, setHomeCode] = useState<string>("");
  const [awayCode, setAwayCode] = useState<string>("");
  const [game, setGame] = useState(0);
  const [leverage, setLeverage] = useState(true);
  // User-edited batting orders (indices into team.batters). null = the model's projected
  // lineup. The engine takes an arbitrary order, so editing just feeds a different array.
  const [homeOrder, setHomeOrder] = useState<number[] | null>(null);
  const [awayOrder, setAwayOrder] = useState<number[] | null>(null);
  // Chosen starting pitcher (index into team.rotation). null = the rotation's starter for
  // this series game. The starter is the biggest single lever on a game, so let it be picked.
  const [homeStarterIdx, setHomeStarterIdx] = useState<number | null>(null);
  const [awayStarterIdx, setAwayStarterIdx] = useState<number | null>(null);
  const [h2h, setH2h] = useState<H2H | null>(null);

  useEffect(() => {
    const apply = (d: MatchupData) => {
      setData(d);
      if (d.teams.length >= 2) { setHomeCode(d.teams[0].code); setAwayCode(d.teams[1].code); }
    };
    // Live box-score-built rosters (Supabase-backed) with a static-file fallback.
    fetch("/api/kbo/matchup")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no live"))))
      .then(apply)
      .catch(() =>
        fetch("/kbo-matchup.json").then((r) => r.json()).then(apply).catch(() => setData(null)),
      );
  }, []);

  // A team's 14-man pool differs per team, so a custom order is only valid for the team it
  // was built on — reset to projected when the team (not the game) changes.
  useEffect(() => { setHomeOrder(null); setHomeStarterIdx(null); }, [homeCode]);
  useEffect(() => { setAwayOrder(null); setAwayStarterIdx(null); }, [awayCode]);

  // Actual head-to-head results this season for the picked pair (real games, not a
  // prediction). Reloads whenever either team changes.
  useEffect(() => {
    if (!homeCode || !awayCode || homeCode === awayCode) { setH2h(null); return; }
    let cancelled = false;
    setH2h(null);
    fetch(`/api/kbo/h2h?a=${homeCode}&b=${awayCode}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("h2h"))))
      .then((d: H2H) => { if (!cancelled) setH2h(d); })
      .catch(() => { if (!cancelled) setH2h(null); });
    return () => { cancelled = true; };
  }, [homeCode, awayCode]);

  // Default to the first PREDICTION slot (= after the played home games), else the last.
  useEffect(() => {
    const orient = (h2h?.games ?? []).filter((g) => g.home_team === homeCode && g.away_team === awayCode);
    const played = orient.filter((g) => g.status === "RESULT" && g.home_score != null).length;
    const total = Math.max(HOME_SLATE, played);
    setGame(Math.min(played, total - 1));
  }, [h2h, homeCode, awayCode]);

  const engine = useMemo(() => {
    if (!data || !homeCode || !awayCode) return null;
    const home = data.teams.find((x) => x.code === homeCode);
    const away = data.teams.find((x) => x.code === awayCode);
    if (!home || !away || home === away) return null;
    const lg = data.league;
    // Effective starter: the user's pick if any, else the rotation's starter for this game.
    const rotIdx = (rot: Pitcher[], g: number) => ((g % rot.length) + rot.length) % rot.length;
    const hsIdx = homeStarterIdx ?? rotIdx(home.rotation, game);
    const asIdx = awayStarterIdx ?? rotIdx(away.rotation, game);
    const hs = home.rotation[hsIdx] ?? starterForGame(home.rotation, game);
    const as = away.rotation[asIdx] ?? starterForGame(away.rotation, game);
    // Model each bullpen's availability for THIS game (top arms rest after throwing).
    const homePen = bullpenForGame(home.bullpen_arms, game, home.bullpen);
    const awayPen = bullpenForGame(away.bullpen_arms, game, away.bullpen);
    const eliteA = leverage ? awayPen.eliteRates : null;   // home offense faces away's pen
    const eliteH = leverage ? homePen.eliteRates : null;
    const hProj = home.lineup_projected.slice(0, 9);
    const aProj = away.lineup_projected.slice(0, 9);
    const hOrder = homeOrder ?? hProj;                     // custom edit or projected
    const aOrder = awayOrder ?? aProj;
    // Win-max lineup (for the "apply optimal" action + the achievable-gain hint).
    const hOpt = optimizeLineup(home.batters, hProj, as.rates, awayPen.rates, eliteA, as.sp_innings, lg, true, home.mu_calib);
    const aOpt = optimizeLineup(away.batters, aProj, hs.rates, homePen.rates, eliteH, hs.sp_innings, lg, false, away.mu_calib);
    const res = evaluateMatchup(lg, home, away, hOrder, aOrder, hs, as, homePen, awayPen, leverage);
    // Projected-lineup μ baseline so the badge reads "vs the model's projected lineup".
    const projHmu = muForOrder(home.batters, hProj, as.rates, awayPen.rates, eliteA, as.sp_innings, lg, true, home.mu_calib);
    const projAmu = muForOrder(away.batters, aProj, hs.rates, homePen.rates, eliteH, hs.sp_innings, lg, false, away.mu_calib);
    return { home, away, lg, hs, as, hsIdx, asIdx, homePen, awayPen, hProj, aProj, hOrder, aOrder, hOpt, aOpt, res, projHmu, projAmu };
  }, [data, homeCode, awayCode, game, leverage, homeOrder, awayOrder, homeStarterIdx, awayStarterIdx]);

  if (!data) return <div className="mx-auto max-w-3xl py-20 text-center text-fg-dim">{t("loading")}</div>;

  const teams = data.teams;
  const swap = () => { setHomeCode(awayCode); setAwayCode(homeCode); };
  const nameByCode = (code: string) => {
    const tm = teams.find((x) => x.code === code);
    return tm ? teamName(tm, locale) : code;
  };

  // Lock indicator per team option. Unlocks are per team per slot, so the home
  // picker scores each team as a home pick and the away picker as an away pick
  // (independent purchases). Free teams (SS/HH) and owned slots show no lock.
  const homeLocked = (code: string) => !isTeamSlotOpen(code, "home", unlocked);
  const awayLocked = (code: string) => !isTeamSlotOpen(code, "away", unlocked);

  // Exact run distributions from the base-out Markov chain (no NegBinom, no Monte
  // Carlo). Their shape reflects each team's scoring profile; win prob, ranges, and
  // the total all read off these directly.
  const distHome = engine ? engine.res.pmfHome : [];
  const distAway = engine ? engine.res.pmfAway : [];

  // Fixed 8-game home slate for the picked orientation (home team hosting the away team).
  // Played games fill their slots with real results; the remaining slots are predictions,
  // so the view is always a full 8-game series regardless of the schedule's gaps/skew.
  const orient = (h2h?.games ?? []).filter((g) => g.home_team === homeCode && g.away_team === awayCode);
  const playedG = orient.filter((g) => g.status === "RESULT" && g.home_score != null && g.away_score != null);
  const upcomingG = orient.filter((g) => !(g.status === "RESULT" && g.home_score != null));
  const slots: { played: boolean; game: H2HGame | null }[] = playedG.map((g) => ({ played: true, game: g }));
  for (let u = 0; slots.length < Math.max(HOME_SLATE, playedG.length); u++) {
    slots.push({ played: false, game: upcomingG[u] ?? null });
  }
  const sel = slots[game] ?? null;
  const selPlayed = !!sel?.played;
  const selGame = sel?.game ?? null;
  const selHs = selGame?.home_score ?? 0; // narrowed numbers (only used when selPlayed)
  const selAs = selGame?.away_score ?? 0;

  // Home-orientation record (this park only), matching the shown slate.
  const hw = playedG.filter((g) => (g.home_score ?? 0) > (g.away_score ?? 0)).length;
  const hl = playedG.filter((g) => (g.home_score ?? 0) < (g.away_score ?? 0)).length;
  const recordLine = playedG.length
    ? locale === "ko" ? `${nameByCode(homeCode)} 홈 ${hw}승 ${hl}패` : `${nameByCode(homeCode)} home ${hw}W ${hl}L`
    : "";

  // Distribution summary for the prediction: per-team run interval (P25–P75) + the
  // game total, instead of a single misleading scoreline.
  const dist = engine
    ? (() => {
        const total = convolve(distHome, distAway);
        return {
          h25: quantile(distHome, 0.25), h50: quantile(distHome, 0.5), h75: quantile(distHome, 0.75),
          a25: quantile(distAway, 0.25), a50: quantile(distAway, 0.5), a75: quantile(distAway, 0.75),
          t25: quantile(total, 0.25), t50: quantile(total, 0.5), t75: quantile(total, 0.75),
        };
      })()
    : null;

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
        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-1.5 shrink-0 text-xs font-medium uppercase tracking-wide text-fg-dim">{t("matchup.homeGames", { team: nameByCode(homeCode) })}</span>
            <div className="flex flex-wrap gap-1">
              {slots.map((s, i) => {
                const title = s.game
                  ? `${fmtDate(s.game.game_date)} · ${nameByCode(homeCode)} ${s.played ? `${s.game.home_score}:${s.game.away_score}` : "vs"} ${nameByCode(awayCode)}`
                  : t("matchup.predicted");
                return (
                  <button key={i} onClick={() => setGame(i)} title={title}
                    className={"h-7 min-w-[1.75rem] rounded-md px-1 text-xs font-mono transition " +
                      (i === game
                        ? "bg-accent text-white"
                        : s.played
                          ? "bg-ink-800/40 text-fg-dim hover:text-fg"
                          : "bg-ink-800/70 text-fg-muted ring-1 ring-inset ring-accent/30 hover:text-fg")}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
          <Toggle label={t("matchup.toggle.leverage")} on={leverage} set={setLeverage} />
        </div>
        {recordLine && (
          <p className="mt-3 font-mono text-xs text-fg-dim">
            {t("matchup.h2h.title")} · <span className="text-fg-muted">{recordLine}</span>
          </p>
        )}
      </section>

      {/* Played slot → the real result (fact). Otherwise → the prediction. */}
      {selPlayed && selGame ? (
        <section className="mt-8 rounded-2xl border border-line bg-ink-850/50 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-fg/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              {t("matchup.h2h.completed")}
            </span>
            <span className="text-xs text-fg-dim">{fmtDate(selGame.game_date)} · {t("matchup.h2h.sub")}</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-center">
            <div className="flex-1">
              <div className={"font-display text-lg font-semibold " + (selHs > selAs ? "text-fg" : "text-fg-dim")}>{nameByCode(selGame.home_team)}</div>
              <div className="text-[11px] uppercase tracking-wide text-fg-dim">{t("matchup.home")}</div>
            </div>
            <div className="font-mono text-3xl font-semibold tabular-nums text-fg">{selHs} : {selAs}</div>
            <div className="flex-1">
              <div className={"font-display text-lg font-semibold " + (selAs > selHs ? "text-fg" : "text-fg-dim")}>{nameByCode(selGame.away_team)}</div>
              <div className="text-[11px] uppercase tracking-wide text-fg-dim">{t("matchup.away")}</div>
            </div>
          </div>
          <p className="mt-3 text-center text-sm font-medium text-accent">
            {selHs === selAs
              ? t("matchup.h2h.tie")
              : t("matchup.h2h.won", { team: nameByCode(selHs > selAs ? selGame.home_team : selGame.away_team) })}
          </p>
        </section>
      ) : engine ? (
        <KboResultGate home={homeCode} away={awayCode}>
          <div className="mt-8 flex items-center gap-2">
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              {t("matchup.predicted")}
            </span>
            <span className="text-xs text-fg-dim">
              {selGame ? fmtDate(selGame.game_date) : t("matchup.tbd")}
            </span>
          </div>
          {/* Win probability */}
          <section className="mt-4">
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
              {dist && (
                <Stat label={t("matchup.runrange")}
                  value={`${dist.h25}–${dist.h75} : ${dist.a25}–${dist.a75}`}
                  sub={`${t("matchup.median")} ${dist.h50} : ${dist.a50}`} />
              )}
              {dist && (
                <Stat label={t("matchup.total")}
                  value={`${dist.t50}`}
                  sub={`${dist.t25}–${dist.t75} ${t("matchup.iqr")}`} />
              )}
            </div>
          </section>

          {/* Run distribution — the honest output: the full spread, not a scoreline. */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{t("matchup.dist.title")}</h2>
            <p className="mt-1 text-xs text-fg-dim">{t("matchup.exact")}</p>
            <Histogram
              home={distHome} away={distAway}
              homeLabel={teamName(engine.home, locale)} awayLabel={teamName(engine.away, locale)}
            />
          </section>

          {/* Editable lineups */}
          <section className="mt-10">
            <p className="mb-3 text-sm text-fg-muted">{t("matchup.lineup.editHint")}</p>
            <div className="grid gap-6 md:grid-cols-2">
              <LineupColumn t={t} locale={locale} team={engine.home} pen={engine.homePen}
                rotation={engine.home.rotation} starterIdx={engine.hsIdx} onStarterChange={setHomeStarterIdx}
                order={engine.hOrder} onOrderChange={setHomeOrder}
                isCustom={homeOrder !== null} gain={engine.res.muHome - engine.projHmu}
                optGain={engine.hOpt.mu - engine.projHmu}
                onOptimal={() => setHomeOrder(engine.hOpt.order.slice())} onReset={() => setHomeOrder(null)}
                side={t("matchup.home")} />
              <LineupColumn t={t} locale={locale} team={engine.away} pen={engine.awayPen}
                rotation={engine.away.rotation} starterIdx={engine.asIdx} onStarterChange={setAwayStarterIdx}
                order={engine.aOrder} onOrderChange={setAwayOrder}
                isCustom={awayOrder !== null} gain={engine.res.muAway - engine.projAmu}
                optGain={engine.aOpt.mu - engine.projAmu}
                onOptimal={() => setAwayOrder(engine.aOpt.order.slice())} onReset={() => setAwayOrder(null)}
                side={t("matchup.away")} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fg-dim">{t("matchup.lineup.note")}</p>
          </section>
        </KboResultGate>
      ) : null}
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

function LineupColumn({ t, locale, team, pen, rotation, starterIdx, onStarterChange, order, onOrderChange, isCustom, gain, optGain, onOptimal, onReset, side }: {
  t: ReturnType<typeof useT>; locale: Locale; team: Team; pen: BullpenState;
  rotation: Pitcher[]; starterIdx: number; onStarterChange: (i: number) => void;
  order: number[]; onOrderChange: (o: number[]) => void; isCustom: boolean;
  gain: number; optGain: number; onOptimal: () => void; onReset: () => void; side: string;
}) {
  const canOptimize = optGain > 0.01 && Math.abs(gain - optGain) > 0.01;
  return (
    <div className="rounded-xl border border-line bg-ink-850/30 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base font-semibold text-fg">{teamName(team, locale)}</h3>
        <span className="text-[11px] uppercase tracking-wide text-fg-dim">{side}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-fg-dim">
        <span className="shrink-0">{t("matchup.starter")}</span>
        <select value={starterIdx} onChange={(e) => onStarterChange(Number(e.target.value))}
          aria-label={t("matchup.starter")}
          className="min-w-0 flex-1 truncate rounded border border-line bg-ink-800/60 px-1.5 py-1 text-xs text-fg focus:border-accent focus:outline-none">
          {rotation.map((p, pi) => (
            <option key={pi} value={pi}>{p.name} · FIP {p.fip.toFixed(2)} · {p.sp_innings.toFixed(1)} IP</option>
          ))}
        </select>
      </div>
      {pen.available.length + pen.down.length > 0 && (
        <p className="mt-1 text-xs text-fg-dim">
          {t("matchup.bullpen")}: <span className="text-fg-muted">{pen.available.slice(0, 4).map((a) => a.name).join(", ")}</span>
          {pen.down.length > 0 && (
            <> · {t("matchup.rested")}: <span className="text-fg-dim line-through">{pen.down.map((a) => a.name).join(", ")}</span></>
          )}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
          {isCustom ? t("matchup.lineup.custom") : t("matchup.lineup.projected")}
          {Math.abs(gain) > 0.01 && (
            <span className={"ml-2 font-mono " + (gain > 0 ? "text-accent" : "text-fg-dim")}>
              {t("matchup.lineup.gain", { gain: (gain > 0 ? "+" : "") + gain.toFixed(2) })}
            </span>
          )}
        </span>
        <div className="flex gap-1.5">
          <button onClick={onOptimal} disabled={!canOptimize}
            className="btn-secondary h-6 px-2 text-[11px] disabled:opacity-40"
            title={optGain > 0.01 ? t("matchup.lineup.gain", { gain: "+" + optGain.toFixed(2) }) : undefined}>
            {t("matchup.lineup.optimize")}
          </button>
          {isCustom && (
            <button onClick={onReset} className="btn-secondary h-6 px-2 text-[11px]">
              {t("matchup.lineup.reset")}
            </button>
          )}
        </div>
      </div>
      <LineupTable t={t} pool={team.batters} order={order} onOrderChange={onOrderChange} />
    </div>
  );
}

function LineupTable({ t, pool, order, onOrderChange }: {
  t: ReturnType<typeof useT>; pool: Batter[]; order: number[]; onOrderChange: (o: number[]) => void;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j > 8) return;
    const o = order.slice();
    [o[i], o[j]] = [o[j], o[i]];
    onOrderChange(o);
  };
  const setSlot = (i: number, poolIdx: number) => {
    const o = order.slice();
    const at = o.indexOf(poolIdx);
    if (at >= 0) [o[i], o[at]] = [o[at], o[i]];   // already batting → swap positions
    else o[i] = poolIdx;                          // bench bat → substitute in
    onOrderChange(o);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line">
      <div className={HEAD + " grid-cols-[1.25rem_1fr_2.75rem_2.75rem_2.5rem]"}>
        <span className="text-right">{t("matchup.col.order")}</span>
        <span>{t("matchup.col.player")}</span>
        <span className="text-right">{t("matchup.col.wrc")}</span>
        <span className="text-right">{t("matchup.col.ob")}</span>
        <span />
      </div>
      <ul className="divide-y divide-line/60">
        {order.map((idx, slot) => {
          const b = pool[idx];
          const ob = 1 - b.rates.out;
          return (
            <li key={slot} className="grid grid-cols-[1.25rem_1fr_2.75rem_2.75rem_2.5rem] items-center gap-x-2 px-3 py-1.5 text-sm">
              <span className="text-right font-mono text-fg-dim">{slot + 1}</span>
              <select value={idx} onChange={(e) => setSlot(slot, Number(e.target.value))}
                aria-label={t("matchup.col.player")}
                className="min-w-0 truncate rounded border border-line bg-ink-800/60 px-1.5 py-1 text-sm text-fg focus:border-accent focus:outline-none">
                {pool.map((p, pi) => (
                  <option key={pi} value={pi}>{p.name} · {p.wrc_plus.toFixed(0)}</option>
                ))}
              </select>
              <span className="text-right font-mono tabular-nums text-fg-muted">{b.wrc_plus.toFixed(0)}</span>
              <span className="text-right font-mono tabular-nums text-fg-dim">{(ob * 100).toFixed(0)}</span>
              <span className="flex justify-end gap-0.5">
                <button onClick={() => move(slot, -1)} disabled={slot === 0}
                  aria-label={t("matchup.lineup.moveUp")}
                  className="flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-25">▲</button>
                <button onClick={() => move(slot, 1)} disabled={slot === 8}
                  aria-label={t("matchup.lineup.moveDown")}
                  className="flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-25">▼</button>
              </span>
            </li>
          );
        })}
      </ul>
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
            <span className="w-1/2 rounded-sm bg-accent/70" style={{ height: px(home[r] ?? 0) }} />
            <span className="w-1/2 rounded-sm bg-cyan/60" style={{ height: px(away[r] ?? 0) }} />
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

// Smallest integer run total whose cumulative probability reaches q (a quantile).
// The NegBinom is right-skewed, so a single point (mode/mean) misleads; quantiles
// give an honest interval. q=0.5 is the median (never degenerates to 0 for a normal
// offense, unlike the mode).
function quantile(pmf: number[], q: number): number {
  let c = 0;
  for (let i = 0; i < pmf.length; i++) { c += pmf[i]; if (c >= q) return i; }
  return pmf.length ? pmf.length - 1 : 0;
}

// PMF of the sum of two independent run distributions (the game total). The model
// already treats the two teams' runs as independent, so this convolution is exact.
function convolve(a: number[], b: number[]): number[] {
  if (!a.length || !b.length) return [];
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) if (a[i]) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
