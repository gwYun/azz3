"use client";

import { useEffect, useRef, useState } from "react";
import { useT, useI18n } from "@/lib/i18n-context";
import { euro } from "@/lib/format";

type Props = {
  fee: number | null;
  loading: boolean;
};

/**
 * Hero fee number. Locked decisions:
 *  - D1: hero of /build
 *  - D15: 200ms transition on the value
 *  - D16: aria-live="polite" so screen readers announce updates non-disruptively
 *  - D21: calibration tooltip on small 'i' icon
 */
export function FeeDisplay({ fee, loading }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close tooltip
  useEffect(() => {
    if (!tooltipOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setTooltipOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tooltipOpen]);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        <span>{t("build.fee.label")}</span>
        <button
          type="button"
          onClick={() => setTooltipOpen((v) => !v)}
          aria-expanded={tooltipOpen}
          aria-label={t("build.fee.calibration.aria")}
          className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-[10px] font-semibold leading-none text-neutral-500 hover:border-neutral-500 hover:text-neutral-800"
        >
          i
        </button>
      </div>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="mt-1 font-display text-6xl font-semibold tracking-tight text-neutral-900 transition-all duration-fee"
      >
        {loading && fee == null ? (
          <span className="inline-block h-12 w-48 animate-pulse rounded bg-neutral-100" />
        ) : (
          <span>
            {fee == null ? "—" : euro(fee, locale)}
          </span>
        )}
      </div>
      <div className="mt-1 h-0.5 w-16 bg-accent" aria-hidden="true" />
      {tooltipOpen ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-2 max-w-sm rounded-lg border border-neutral-200 bg-white p-3 text-xs leading-relaxed text-neutral-700 shadow-elevated"
        >
          {t("build.fee.calibration")}
        </div>
      ) : null}
    </div>
  );
}
