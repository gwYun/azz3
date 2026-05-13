"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, useI18n } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import { ApiError, compare, loadModelInfo } from "@/lib/api";
import { deleteBuild, isStale, listBuilds } from "@/lib/storage";
import type { CompareResponse, ModelInfo, SavedBuild } from "@/lib/types";
import { dateLabel, euro } from "@/lib/format";
import { CompareView } from "@/components/CompareView";

export default function SavedPage() {
  const t = useT();
  const { locale } = useI18n();
  const toast = useToast();

  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [builds, setBuilds] = useState<SavedBuild[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadModelInfo();
        if (!cancelled) setInfo(m);
      } catch (err) {
        if (!cancelled) toast.show(err instanceof Error ? err.message : "load failed");
      }
    })();
    setBuilds(listBuilds());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }, []);

  const onDelete = useCallback((id: string) => {
    const r = deleteBuild(id);
    if (!r.ok) {
      toast.show(r.reason);
      return;
    }
    setBuilds(listBuilds());
    setSelected((prev) => prev.filter((x) => x !== id));
    if (compareResult) {
      // close compare if either side was deleted
      const stillBoth = selected.filter((x) => x !== id).length === 2;
      if (!stillBoth) {
        setCompareResult(null);
      }
    }
  }, [compareResult, selected, toast]);

  const a = useMemo(() => builds.find((x) => x.id === selected[0]), [builds, selected]);
  const b = useMemo(() => builds.find((x) => x.id === selected[1]), [builds, selected]);
  const canCompare = selected.length === 2 && a && b && info;

  const onCompare = useCallback(async () => {
    if (!canCompare || !info || !a || !b) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareResult(null);
    try {
      const r = await compare(a.features, b.features);
      setCompareResult(r);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "unknown";
      setCompareError(msg);
    } finally {
      setCompareLoading(false);
    }
  }, [a, b, canCompare, info]);

  // Compare-button hint
  let compareHint: string | null = null;
  if (selected.length === 0) compareHint = t("saved.compare.helpZero");
  else if (selected.length === 1) compareHint = t("saved.compare.helpOne");

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-900">
          {t("saved.title")}
        </h1>
        {builds.length > 0 ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onCompare}
            disabled={!canCompare || compareLoading}
          >
            {t("saved.compare.button")}
          </button>
        ) : null}
      </div>

      {builds.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-neutral-300 p-10 text-center">
          <p className="font-display text-lg font-semibold text-neutral-900">
            {t("saved.empty.title")}
          </p>
          <p className="mt-1 text-sm text-neutral-600">{t("saved.empty.body")}</p>
          <Link href="/build" className="btn-primary mt-6">
            {t("saved.empty.cta")}
          </Link>
        </div>
      ) : (
        <>
          {compareHint ? (
            <p className="mt-3 text-xs text-neutral-500">{compareHint}</p>
          ) : null}
          <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">{t("saved.col.name")}</th>
                  <th className="px-3 py-2 text-right">{t("saved.col.fee")}</th>
                  <th className="px-3 py-2 text-right">{t("saved.col.date")}</th>
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {builds.map((build) => {
                  const stale = info ? isStale(build, info.feature_set_hash) : false;
                  const checked = selected.includes(build.id);
                  return (
                    <tr key={build.id} className={stale ? "bg-neutral-50/60" : ""}>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(build.id)}
                          aria-label={`Select ${build.name}`}
                          className="h-4 w-4 accent-accent"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-neutral-900">{build.name}</div>
                        {stale ? (
                          <div
                            className="mt-0.5 inline-block text-xs text-neutral-500"
                            title={t("saved.staleTooltip")}
                          >
                            {t("saved.staleBadge")}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-800">
                        {euro(build.predicted_fee_eur, locale)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-neutral-500">
                        {dateLabel(build.saved_at, locale)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => onDelete(build.id)}
                        >
                          {t("saved.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {a && b && info && (compareResult || compareLoading || compareError) ? (
            <CompareView
              a={a}
              b={b}
              info={info}
              result={compareResult}
              loading={compareLoading}
              error={compareError}
              onClose={() => {
                setCompareResult(null);
                setCompareError(null);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
