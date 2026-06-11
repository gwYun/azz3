"use client";

import { useT, useI18n } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";
import { euro, euroDelta, num } from "@/lib/format";
import type { CompareResponse, ModelInfo, SavedBuild } from "@/lib/types";

type Props = {
  a: SavedBuild;
  b: SavedBuild;
  info: ModelInfo;
  result: CompareResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

const DECIMALS: Record<string, number> = {
  Gls_Per: 2, "G+A_Per": 2, G_minus_PK_Per: 2,
  xG_Expected: 1, npxG_Expected: 1, xAG_Expected: 1, Mins_Per_90_Playing: 1,
};

export function CompareView({ a, b, info, result, loading, error, onClose }: Props) {
  const t = useT();
  const { locale } = useI18n();

  return (
    <section
      className="mt-8 rounded-lg border border-line bg-ink-850/60 p-6 shadow-elevated"
      aria-labelledby="compare-title"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="compare-title" className="font-display text-xl font-semibold text-fg">
          {t("compare.title")}
        </h2>
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("compare.close")}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* Side-by-side fee header */}
      <div className="mt-6 grid grid-cols-3 gap-4 border-y border-line py-4">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{a.name}</div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg">
            {result ? euro(result.a.predicted_fee_eur, locale) : euro(a.predicted_fee_eur, locale)}
          </div>
        </div>
        <div className="flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-fg-dim">
          vs
        </div>
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{b.name}</div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg">
            {result ? euro(result.b.predicted_fee_eur, locale) : euro(b.predicted_fee_eur, locale)}
          </div>
        </div>
      </div>

      {/* Deciding-group callout (per D20) */}
      {result && result.deciding_group ? (
        <p className="mt-4 rounded bg-accent/15 p-3 text-sm text-fg">
          {(() => {
            const groupKey = `compare.group.${result.deciding_group}` as keyof typeof dict.en;
            const groupLabel = t(groupKey);
            const swap = result.group_swaps[0];
            const delta = swap ? euroDelta(swap.delta_eur) : "—";
            const formatted = t("compare.deciding.format", { group: "{group}", delta });
            // Render with the group name in accent color via inline replacement.
            const [pre, post] = formatted.split("{group}");
            return (
              <>
                {pre}
                <span className="font-semibold text-accent-dark">{groupLabel}</span>
                {post}
              </>
            );
          })()}
        </p>
      ) : null}

      {loading && !result ? (
        <p className="mt-6 text-sm text-fg-dim">{t("loading")}</p>
      ) : null}

      {/* Per-stat side-by-side. Uses D17: green = better w/ ▲, gray = worse, no red. */}
      <div className="mt-6 overflow-hidden rounded border border-line">
        <table className="w-full text-sm">
          <thead className="bg-ink-850/50 text-xs font-semibold uppercase tracking-wide text-fg-dim">
            <tr>
              <th className="px-3 py-2 text-left">{t("compare.col.stat")}</th>
              <th className="px-3 py-2 text-right">{a.name}</th>
              <th className="px-3 py-2 text-right">{b.name}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular-nums">
            {info.features.map((feat) => {
              const va = a.features[feat] ?? info.medians[feat] ?? 0;
              const vb = b.features[feat] ?? info.medians[feat] ?? 0;
              const aBetter = va > vb;
              const bBetter = vb > va;
              const tied = va === vb;
              const fullKey = `stat.${feat}.full` as keyof typeof dict.en;
              const decs = DECIMALS[feat] ?? 0;
              return (
                <tr key={feat}>
                  <td className="px-3 py-1.5 font-sans text-xs text-fg-muted">{t(fullKey)}</td>
                  <td
                    className={
                      "px-3 py-1.5 text-right " +
                      (aBetter ? "text-accent-dark font-semibold" : tied ? "text-fg-dim" : "text-fg-muted")
                    }
                  >
                    {aBetter ? "▲ " : ""}
                    {num(va, decs)}
                  </td>
                  <td
                    className={
                      "px-3 py-1.5 text-right " +
                      (bBetter ? "text-accent-dark font-semibold" : tied ? "text-fg-dim" : "text-fg-muted")
                    }
                  >
                    {bBetter ? "▲ " : ""}
                    {num(vb, decs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
