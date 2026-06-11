"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n-context";
import { dict } from "@/lib/i18n";

// Order matches feature_order.json so the glossary reads in the same order
// the rest of the app surfaces stats.
const FEATURE_ORDER = [
  "MP_Playing",
  "Starts_Playing",
  "Mins_Per_90_Playing",
  "Gls",
  "Ast",
  "PK",
  "PKatt",
  "CrdY",
  "CrdR",
  "Gls_Per",
  "G+A_Per",
  "G_minus_PK_Per",
  "xG_Expected",
  "npxG_Expected",
  "xAG_Expected",
] as const;

// Short stat abbreviations for the left column. Same in both locales — these
// are universal football abbreviations.
const ABBREV: Record<(typeof FEATURE_ORDER)[number], string> = {
  MP_Playing: "MP",
  Starts_Playing: "Starts",
  Mins_Per_90_Playing: "90s",
  Gls: "Gls",
  Ast: "Ast",
  PK: "PK",
  PKatt: "PKatt",
  CrdY: "CrdY",
  CrdR: "CrdR",
  Gls_Per: "Gls/90",
  "G+A_Per": "G+A/90",
  G_minus_PK_Per: "npGls/90",
  xG_Expected: "xG",
  npxG_Expected: "npxG",
  xAG_Expected: "xAG",
};

export default function GlossaryPage() {
  const t = useT();
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
        {t("glossary.title")}
      </h1>
      <p className="mt-3 text-base text-fg-muted">{t("glossary.subtitle")}</p>

      <div className="mt-10 panel overflow-hidden">
        <div className="grid grid-cols-[10rem_1fr] gap-x-6 border-b border-line bg-ink-800/40 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-fg-dim">
          <span>{t("glossary.col.stat")}</span>
          <span>{t("glossary.col.definition")}</span>
        </div>
        <dl className="divide-y divide-line">
          {FEATURE_ORDER.map((feat) => {
            // Cast through `any` is fine: t() validates keys at compile time;
            // we know these stat keys exist in the dict because they're listed above.
            const fullKey = `stat.${feat}.full` as keyof typeof dict.en;
            const defKey = `stat.${feat}.def` as keyof typeof dict.en;
            return (
              <div
                key={feat}
                className="grid grid-cols-[10rem_1fr] gap-x-6 px-5 py-4"
              >
                <dt className="flex flex-col">
                  <span className="font-mono text-sm font-semibold text-cyan">
                    {ABBREV[feat]}
                  </span>
                  <span className="text-xs text-fg-dim">{t(fullKey)}</span>
                </dt>
                <dd className="text-sm leading-relaxed text-fg-muted">
                  {t(defKey)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      <div className="mt-12 flex justify-end">
        <Link href="/build" className="btn-primary">
          {t("glossary.cta")}
        </Link>
      </div>
    </article>
  );
}
