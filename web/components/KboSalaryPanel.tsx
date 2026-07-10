"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import { krw } from "@/lib/format";
import {
  ageFactor,
  estSalaryWon,
  MAX_SALARY_WON,
  MIN_SALARY_WON,
  warPremiumWon,
  type KboPlayer,
} from "@/lib/kbo-salary";

const WAR_MIN = 0;
const WAR_MAX = 10;
const AGE_MIN = 18;
const AGE_MAX = 42;
const DEFAULT_AGE = 30;

const ok = (won: number) => (won / 1e8).toFixed(2);

/** Interactive WAR→연봉 estimator for KBO. Fully client-side (no backend). */
export function KboSalaryPanel() {
  const t = useT();
  const { locale } = useI18n();

  const [players, setPlayers] = useState<KboPlayer[]>([]);
  const [presetName, setPresetName] = useState("");
  const [war, setWar] = useState(3.0);
  const [ageOn, setAgeOn] = useState(false);
  const [age, setAge] = useState(DEFAULT_AGE);

  // Representative players are the /kbo leaderboard — reuse the same JSON.
  useEffect(() => {
    fetch("/kbo.json")
      .then((r) => r.json())
      .then((d) => setPlayers(Array.isArray(d.players) ? d.players : []))
      .catch(() => setPlayers([]));
  }, []);

  const effectiveAge = ageOn ? age : null;
  const salaryWon = estSalaryWon(war, effectiveAge);

  // Transparent breakdown of the curve, mirroring salary_model.py.
  const floorWon = MIN_SALARY_WON;
  const premiumWon = warPremiumWon(war);
  const factor = ageFactor(effectiveAge);
  const capped = salaryWon >= MAX_SALARY_WON;

  const onPreset = (name: string) => {
    setPresetName(name);
    const p = players.find((x) => x.name === name);
    if (p) {
      setWar(Math.round(p.war * 10) / 10);
      setAgeOn(false); // the open dump carries no age — keep it neutral
    }
  };

  const selected = useMemo(
    () => players.find((x) => x.name === presetName) ?? null,
    [players, presetName],
  );

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      {/* Controls */}
      <div className="space-y-7">
        {/* Preset */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-dim">
            {t("salary.preset.label")}
          </span>
          <select
            className="input-text w-full max-w-sm"
            value={presetName}
            onChange={(e) => onPreset(e.currentTarget.value)}
          >
            <option value="">{t("salary.preset.placeholder")}</option>
            {players.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} · {p.franchise_ko} (WAR {p.war.toFixed(1)})
              </option>
            ))}
          </select>
        </label>

        {/* WAR slider */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm font-medium text-fg">{t("salary.war.label")}</span>
            <span className="font-mono text-sm tabular-nums text-fg-muted">{war.toFixed(1)}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={WAR_MIN}
            max={WAR_MAX}
            step={0.1}
            value={war}
            onChange={(e) => {
              setWar(Number(e.currentTarget.value));
              setPresetName("");
            }}
            aria-label={t("salary.war.label")}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-dim">
            <span>{WAR_MIN.toFixed(1)}</span>
            <span>{t("salary.war.hint")}</span>
            <span>{WAR_MAX.toFixed(1)}</span>
          </div>
        </div>

        {/* Age (optional) */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-fg">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={ageOn}
              onChange={(e) => setAgeOn(e.currentTarget.checked)}
            />
            {t("salary.age.toggle")}
          </label>
          {ageOn ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-sm text-fg-muted">{t("salary.age.label")}</span>
                <span className="font-mono text-sm tabular-nums text-fg-muted">
                  {age} · ×{factor.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                className="slider"
                min={AGE_MIN}
                max={AGE_MAX}
                step={1}
                value={age}
                onChange={(e) => setAge(Number(e.currentTarget.value))}
                aria-label={t("salary.age.label")}
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-dim">
                <span>{AGE_MIN}</span>
                <span>{t("salary.age.peak")}</span>
                <span>{AGE_MAX}</span>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-fg-dim">{t("salary.age.off")}</p>
          )}
        </div>

        {/* Breakdown */}
        <div className="rounded-xl border border-line bg-ink-850/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
            {t("salary.breakdown.title")}
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label={t("salary.breakdown.floor")} value={`${ok(floorWon)}억`} />
            <Row label={t("salary.breakdown.premium")} value={`+${ok(premiumWon)}억`} />
            {ageOn ? (
              <Row label={t("salary.breakdown.age")} value={`×${factor.toFixed(2)}`} />
            ) : null}
            {capped ? (
              <Row label={t("salary.breakdown.cap")} value={`${ok(MAX_SALARY_WON)}억`} muted />
            ) : null}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="text-sm font-semibold text-fg">{t("salary.breakdown.total")}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-accent">
                {ok(salaryWon)}억
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Result */}
      <aside className="md:sticky md:top-24 md:self-start">
        <div className="rounded-2xl border border-line bg-ink-850/50 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-dim">
            {t("salary.result.kbo.label")}
          </p>
          <div
            aria-live="polite"
            className="mt-2 font-display text-5xl font-semibold tracking-tight text-fg transition-all duration-fee"
          >
            {ok(salaryWon)}
            <span className="ml-1 text-2xl font-medium text-fg-muted">억원</span>
          </div>
          <div className="mt-1 text-sm text-fg-dim">≈ {krw(salaryWon, locale)}</div>
          <div className="mt-2 h-0.5 w-16 bg-accent" aria-hidden />
          {selected ? (
            <p className="mt-4 text-xs text-fg-dim">
              {t("salary.result.kbo.ref", {
                name: selected.name,
                metric: `${selected.metric_label} ${selected.metric}`,
              })}
            </p>
          ) : null}
          <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-fg-dim">
            {t("salary.result.kbo.caveat")}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={"font-mono tabular-nums " + (muted ? "text-fg-dim" : "text-fg")}>{value}</dd>
    </div>
  );
}
