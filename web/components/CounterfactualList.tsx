"use client";

import { useT } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";
import { euroDelta } from "@/lib/format";
import type { Perturbation } from "@/lib/types";

type Props = {
  perturbations: Perturbation[] | null;
  empty: boolean; // true = "drag a slider" hint state
};

export function CounterfactualList({ perturbations, empty }: Props) {
  const t = useT();

  if (empty) {
    return (
      <p className="text-sm text-neutral-500">{t("build.counterfactuals.empty")}</p>
    );
  }
  if (perturbations && perturbations.length === 0) {
    return (
      <p className="text-sm text-neutral-500">{t("build.counterfactuals.ceiling")}</p>
    );
  }
  if (!perturbations) {
    return (
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-5 w-3/4 animate-pulse rounded bg-neutral-100" />
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2 text-sm text-neutral-700">
      {perturbations.map((p) => {
        const fullKey = `stat.${p.feature}.full` as keyof typeof dict.en;
        const featLabel = t(fullKey);
        return (
          <li key={p.feature} className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-accent">▲</span>
            <span>
              {t("build.counterfactuals.format", {
                feature: featLabel,
                delta: euroDelta(p.delta_eur),
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
