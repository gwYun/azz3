"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";
import { num } from "@/lib/format";
import type { FeatureStat } from "@/lib/types";

type Props = {
  feature: string;
  value: number;
  stat: FeatureStat;
  median: number;
  dataMin?: number;
  dataMax?: number;
  decimals: number;
  onChange: (next: number) => void;
};

function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return x === mu ? 1 : 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

export function StatSlider({ feature, value, stat, median, dataMin, dataMax, decimals, onChange }: Props) {
  const t = useT();
  const fullKey = `stat.${feature}.full` as keyof typeof dict.en;
  const defKey = `stat.${feature}.def` as keyof typeof dict.en;
  const step = decimals === 0 ? 1 : decimals === 1 ? 0.1 : decimals === 2 ? 0.01 : 0.001;

  const min = dataMin !== undefined ? Math.min(dataMin, stat.p5) : stat.p5;
  const max = dataMax !== undefined ? Math.max(dataMax, stat.p95) : stat.p95;

  // Distribution gradient: 24 stops using normal PDF centred on median
  const trackGradient = useMemo(() => {
    const STOPS = 24;
    const sigma = stat.sd > 0 ? stat.sd : (max - min) / 4;
    const stops: string[] = [];
    for (let i = 0; i <= STOPS; i++) {
      const pct = i / STOPS;
      const x = min + pct * (max - min);
      const density = normalPdf(x, median, sigma);
      // density 0→1; map to opacity 0.08→0.55 on accent green
      const opacity = (0.08 + density * 0.47).toFixed(2);
      stops.push(`rgba(34,197,94,${opacity}) ${(pct * 100).toFixed(1)}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }, [min, max, median, stat.sd]);

  // Text input editing state
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) => Math.round(v / step) * step;

  function handleInputChange(raw: string) {
    setInputVal(raw);
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) onChange(clamp(snap(n)));
  }

  function handleBlur() {
    setEditing(false);
    const n = parseFloat(inputVal);
    if (!Number.isNaN(n)) onChange(clamp(snap(n)));
  }

  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-neutral-800" title={t(defKey)}>
          {t(fullKey)}
        </span>
        {editing ? (
          <input
            type="number"
            className="w-20 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-right font-mono text-sm tabular-nums text-neutral-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={inputVal}
            step={step}
            min={min}
            max={max}
            autoFocus
            onChange={(e) => handleInputChange(e.currentTarget.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onClick={(e) => e.preventDefault()}
          />
        ) : (
          <button
            type="button"
            className="rounded px-1 font-mono text-sm tabular-nums text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-1 focus:ring-accent"
            title="클릭하여 직접 입력"
            onClick={(e) => {
              e.preventDefault();
              setInputVal(num(value, decimals));
              setEditing(true);
            }}
          >
            {num(value, decimals)}
          </button>
        )}
      </div>

      {/* Slider with distribution overlay */}
      <div className="relative">
        <input
          type="range"
          className="slider relative z-10"
          style={{ background: trackGradient }}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-label={t(fullKey)}
        />
        {/* Median tick */}
        {median >= min && median <= max ? (
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-neutral-400/70"
            style={{ left: `${((median - min) / (max - min)) * 100}%` }}
            title={`Median: ${num(median, decimals)}`}
          />
        ) : null}
      </div>

      <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-400">
        <span>{num(min, decimals)}</span>
        <span className="text-neutral-300">median {num(median, decimals)}</span>
        <span>{num(max, decimals)}</span>
      </div>
    </label>
  );
}
