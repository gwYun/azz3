"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "@/lib/i18n-context";
import { useToast } from "@/lib/toast-context";
import {
  ApiError,
  loadModelInfo,
  predict,
} from "@/lib/api";
import { listBuilds, saveBuild, suggestName } from "@/lib/storage";
import { buildShareUrl, decodeShareHash } from "@/lib/url-share";
import type {
  Archetype,
  FeatureVector,
  ModelInfo,
  Perturbation,
  RealPlayer,
} from "@/lib/types";
import { useFxRate } from "@/lib/useFxRate";
import { StatSlider } from "@/components/StatSlider";
import { FeeDisplay } from "@/components/FeeDisplay";
import { CounterfactualList } from "@/components/CounterfactualList";
import { SaveBuildButton } from "@/components/SaveBuildButton";

const NUISANCE: ReadonlySet<string> = new Set([
  "MP_Playing", "Min_Playing", "CrdR", "Ast", "PK",
]);

// Section grouping for the substantive sliders. Order = display order.
const SECTIONS: Array<{ key: "finishing" | "creation" | "passing"; features: string[] }> = [
  { key: "finishing", features: ["G+A_Per", "xG_Per", "Sh_Standard_shoot", "SoT_percent_Standard_shoot", "SoT_per_90_Standard_shoot"] },
  { key: "creation",  features: ["Ast_Per", "xAG_Expected", "xAG_Per"] },
  { key: "passing",   features: [] },
];

const DECIMALS: Record<string, number> = {
  "G+A_Per": 2, xG_Per: 2, Ast_Per: 2, xAG_Expected: 2, xAG_Per: 2,
  SoT_per_90_Standard_shoot: 3,
  SoT_percent_Standard_shoot: 1,
};

function decimals(feat: string): number {
  return DECIMALS[feat] ?? 0;
}

const DEBOUNCE_MS = 200;

export default function BuildPage() {
  const t = useT();
  const { locale } = useI18n();
  const toast = useToast();

  // Model + archetypes load
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [players, setPlayers] = useState<RealPlayer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // FX rate (EUR -> KRW). Fetched once per session; falls back to a static
  // constant if the API is unreachable.
  const { rate: eurKrwRate } = useFxRate();

  // Build state
  const [features, setFeatures] = useState<FeatureVector>({});
  const [showAll, setShowAll] = useState(false);
  const [archetypeName, setArchetypeName] = useState<string>("");
  const [selectedPlayer, setSelectedPlayer] = useState<RealPlayer | null>(null);

  // Prediction state
  const [fee, setFee] = useState<number | null>(null);
  const [perturbations, setPerturbations] = useState<Perturbation[] | null>(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const inFlightRef = useRef(0);

  // Load model-info + archetypes once on mount; honor URL hash for shared builds.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadModelInfo();
        if (cancelled) return;
        setInfo(m);

        // Try archetypes (best-effort — page works without them)
        try {
          const r = await fetch("/archetypes.json", { cache: "force-cache" });
          if (r.ok) {
            const data = (await r.json()) as Archetype[];
            if (!cancelled) setArchetypes(data);
          }
        } catch {
          // ignore — archetypes optional
        }

        // Try real players (best-effort — same pattern as archetypes)
        try {
          const r = await fetch("/players.json", { cache: "force-cache" });
          if (r.ok) {
            const data = (await r.json()) as RealPlayer[];
            if (!cancelled) setPlayers(data);
          }
        } catch {
          // ignore — real players optional
        }

        // Hydrate from URL hash if present, else from medians.
        const hashFeatures = decodeShareHash(window.location.hash, m);
        const initial: FeatureVector = hashFeatures ?? Object.fromEntries(
          m.features.map((f) => [f, m.medians[f] ?? 0])
        );
        if (!cancelled) {
          setFeatures(initial);
          // Pull initial prediction (median or hash)
          runPredict(initial, /*userTriggered*/ false);
          if (hashFeatures) setHasInteracted(true);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t("build.error.loadGeneric"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runPredict = useCallback(async (vec: FeatureVector, userTriggered: boolean) => {
    setPredictLoading(true);
    setPredictError(null);
    const reqId = ++inFlightRef.current;
    try {
      const r = await predict(vec);
      if (reqId !== inFlightRef.current) return; // a newer request is in flight
      setFee(r.predicted_fee_eur);
      setPerturbations(r.top_3_perturbations);
    } catch (err) {
      if (reqId !== inFlightRef.current) return;
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "unknown";
      setPredictError(msg);
      // Don't clobber prior fee on transient failure; keep what's on screen.
    } finally {
      if (reqId === inFlightRef.current) setPredictLoading(false);
    }
    // Suppress unused-var warning in dev builds.
    void userTriggered;
  }, []);

  // Debounce slider changes — fire 200ms after last drag (D15).
  const setFeature = useCallback(
    (feat: string, value: number) => {
      setHasInteracted(true);
      setArchetypeName(""); // unset — they're customizing
      setSelectedPlayer(null); // editing leaves "real player" mode
      setFeatures((prev) => {
        const next = { ...prev, [feat]: value };
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
          runPredict(next, true);
        }, DEBOUNCE_MS);
        return next;
      });
    },
    [runPredict]
  );

  const onArchetypeChange = useCallback(
    (name: string) => {
      const a = archetypes.find((x) => x.name === name);
      if (!a) return;
      setArchetypeName(name);
      setSelectedPlayer(null);
      setHasInteracted(true);
      setFeatures(a.features);
      runPredict(a.features, true);
    },
    [archetypes, runPredict]
  );

  const onPlayerChange = useCallback(
    (name: string) => {
      const p = players.find((x) => x.name === name);
      if (!p) {
        setSelectedPlayer(null);
        return;
      }
      setSelectedPlayer(p);
      setArchetypeName("");
      setHasInteracted(true);
      setFeatures(p.features);
      runPredict(p.features, true);
    },
    [players, runPredict]
  );

  const onSave = useCallback(
    (name: string) => {
      if (!info || fee == null) return;
      const result = saveBuild({
        name,
        features,
        predicted_fee_eur: fee,
        feature_set_hash: info.feature_set_hash,
      });
      if (!result.ok) {
        toast.show(result.reason);
        return;
      }
      toast.show(t("toast.saved", { name }), {
        link: { label: t("toast.saved.link"), href: "/saved" },
      });
    },
    [features, fee, info, t, toast]
  );

  const onShare = useCallback(async () => {
    if (!info) return;
    const url = buildShareUrl(features, info);
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t("toast.copied"), { durationMs: 2000 });
    } catch {
      // Fallback: still show in toast for manual copy
      toast.show(url, { durationMs: 8000 });
    }
  }, [features, info, t, toast]);

  const playerBounds = useMemo(() => {
    if (!players.length) return {} as Record<string, { min: number; max: number }>;
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const p of players) {
      for (const [feat, val] of Object.entries(p.features)) {
        if (bounds[feat] === undefined) bounds[feat] = { min: val, max: val };
        else {
          bounds[feat].min = Math.min(bounds[feat].min, val);
          bounds[feat].max = Math.max(bounds[feat].max, val);
        }
      }
    }
    return bounds;
  }, [players]);

  const defaultSaveName = useMemo(() => {
    if (!info) return t("build.suggestName.numbered", { n: "1" });
    const existing = listBuilds().length;
    return suggestName({ features }, existing, locale);
  }, [features, info, locale, t]);

  // Render gates
  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {t("build.error.load", { error: loadError })}
      </div>
    );
  }
  if (!info) {
    return <p className="text-sm text-neutral-500">{t("loading")}</p>;
  }

  // Compose visible features.
  const visibleNuisance = showAll
    ? Array.from(NUISANCE).filter((f) => info.features.includes(f))
    : [];

  return (
    <div className="grid gap-10 md:grid-cols-[1fr_360px]">
      {/* Left column: hero fee + controls + sliders */}
      <div className="space-y-8">
        <div>
          <FeeDisplay
            fee={fee}
            loading={predictLoading}
            eurKrwRate={eurKrwRate}
            playerName={selectedPlayer?.name ?? null}
            actualFeeEur={selectedPlayer?.actual_fee_eur ?? null}
          />
          {predictError ? (
            <div className="mt-3 flex items-center gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <span>{t("build.error.predict")}</span>
              <button
                type="button"
                onClick={() => runPredict(features, true)}
                className="underline underline-offset-2"
              >
                {t("build.error.retry")}
              </button>
            </div>
          ) : null}
        </div>

        {/* Archetype / real-player presets + actions */}
        <div className="flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-6">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {t("build.archetype.label")}
            </span>
            <select
              className="input-text w-64"
              value={archetypeName}
              onChange={(e) => onArchetypeChange(e.currentTarget.value)}
            >
              <option value="">{t("build.archetype.placeholder")}</option>
              {archetypes.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {players.length > 0 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t("build.realplayer.label")}
              </span>
              <select
                className="input-text w-64"
                value={selectedPlayer?.name ?? ""}
                onChange={(e) => onPlayerChange(e.currentTarget.value)}
              >
                <option value="">{t("build.realplayer.placeholder")}</option>
                {players.map((p) => (
                  <option key={`${p.name}-${p.season}`} value={p.name}>
                    {p.name} ({p.season}, {p.from_club} → {p.to_club})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SaveBuildButton
            defaultName={defaultSaveName}
            onSave={onSave}
            disabled={fee == null}
          />
          <button type="button" className="btn-secondary" onClick={onShare}>
            {t("build.share.button")}
          </button>
        </div>

        {/* Sliders */}
        <div className="space-y-8">
          {SECTIONS.filter((s) => s.features.length > 0).map((section) => (
            <section key={section.key}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t(`build.section.${section.key}`)}
              </h3>
              <div className="grid gap-5 sm:grid-cols-2">
                {section.features.filter((feat) => info.feature_stats[feat]).map((feat) => (
                  <StatSlider
                    key={feat}
                    feature={feat}
                    value={features[feat] ?? info.medians[feat] ?? 0}
                    stat={info.feature_stats[feat]}
                    median={info.medians[feat] ?? 0}
                    dataMin={playerBounds[feat]?.min}
                    dataMax={playerBounds[feat]?.max}
                    decimals={decimals(feat)}
                    onChange={(v) => setFeature(feat, v)}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Show-all toggle */}
          <div className="border-t border-neutral-200 pt-5">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
            >
              {showAll ? t("build.showAllStats.hide") : t("build.showAllStats.show")}
            </button>
          </div>

          {showAll && visibleNuisance.length > 0 ? (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t("build.section.nuisance")}
              </h3>
              <div className="grid gap-5 sm:grid-cols-2">
                {visibleNuisance.filter((feat) => info.feature_stats[feat]).map((feat) => (
                  <StatSlider
                    key={feat}
                    feature={feat}
                    value={features[feat] ?? info.medians[feat] ?? 0}
                    stat={info.feature_stats[feat]}
                    median={info.medians[feat] ?? 0}
                    dataMin={playerBounds[feat]?.min}
                    dataMax={playerBounds[feat]?.max}
                    decimals={decimals(feat)}
                    onChange={(v) => setFeature(feat, v)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* Right column: counterfactuals */}
      <aside className="space-y-3 md:sticky md:top-24 md:self-start">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t("build.counterfactuals.title")}
        </h2>
        <CounterfactualList
          perturbations={perturbations}
          empty={!hasInteracted && !predictLoading && perturbations == null}
          eurKrwRate={eurKrwRate}
        />
      </aside>
    </div>
  );
}
