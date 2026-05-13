"use client";

import { useT } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";
import { num } from "@/lib/format";
import type { FeatureStat } from "@/lib/types";

type Props = {
  feature: string;
  value: number;
  stat: FeatureStat;
  decimals: number;
  onChange: (next: number) => void;
};

export function StatSlider({ feature, value, stat, decimals, onChange }: Props) {
  const t = useT();
  const fullKey = `stat.${feature}.full` as keyof typeof dict.en;
  const defKey = `stat.${feature}.def` as keyof typeof dict.en;
  const step = decimals === 0 ? 1 : decimals === 1 ? 0.1 : 0.01;
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span
          className="text-sm font-medium text-neutral-800"
          title={t(defKey)}
        >
          {t(fullKey)}
        </span>
        <span className="font-mono text-sm tabular-nums text-neutral-700">
          {num(value, decimals)}
        </span>
      </div>
      <input
        type="range"
        className="slider"
        min={stat.p5}
        max={stat.p95}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label={t(fullKey)}
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-400">
        <span>{num(stat.p5, decimals)}</span>
        <span>{num(stat.p95, decimals)}</span>
      </div>
    </label>
  );
}
