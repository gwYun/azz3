"use client";

import { useT } from "@/lib/i18n-context";
import { REPORT_SORTS, type ReportSort } from "@/lib/reports/sort";

/** 조회순 / 댓글순 / 최신순 toggle for the report lists. */
export function ReportSortTabs({ value, onChange }: { value: ReportSort; onChange: (s: ReportSort) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("reports.sortLabel")} className="flex gap-1 text-xs">
      {REPORT_SORTS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={
            "rounded-full px-2.5 py-1 font-medium transition " +
            (value === s ? "bg-accent/15 text-accent" : "text-fg-dim hover:text-fg")
          }
        >
          {t(`reports.sort.${s}`)}
        </button>
      ))}
    </div>
  );
}
