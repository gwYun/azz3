"use client";

import { useT, useI18n } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";
import { euroDelta, krwDelta, statDelta } from "@/lib/format";
import type { Perturbation } from "@/lib/types";

type Props = {
  perturbations: Perturbation[] | null;
  empty: boolean; // true = "drag a slider" hint state
  eurKrwRate: number;
};

export function CounterfactualList({ perturbations, empty, eurKrwRate }: Props) {
  const t = useT();
  const { locale } = useI18n();

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
    <ul className="space-y-3 text-sm text-neutral-700">
      {perturbations.map((p) => {
        const fullKey = `stat.${p.feature}.full` as keyof typeof dict.en;
        const featLabel = t(fullKey);
        return (
          <li key={p.feature} className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-accent">▲</span>
            <div className="space-y-0.5">
              <div>
                {t("build.counterfactuals.format", {
                  feature: featLabel,
                  amount: statDelta(p.feature, p.new_value - p.current),
                  delta: euroDelta(p.delta_eur),
                })}
              </div>
              <div className="text-xs text-neutral-500">
                {t("build.counterfactuals.krwApprox", {
                  delta: krwDelta(p.delta_eur * eurKrwRate, locale),
                })}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
