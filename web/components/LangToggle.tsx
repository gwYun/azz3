"use client";

import { useI18n } from "@/lib/i18n-context";
import { LOCALES, Locale } from "@/lib/i18n";

export function LangToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("nav.lang.label")}
      className="inline-flex rounded-md border border-line bg-ink-900/60 p-0.5 text-xs"
    >
      {LOCALES.map((l: Locale) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={active}
            className={
              "rounded px-2 py-1 font-medium transition " +
              (active
                ? "bg-accent text-ink-950"
                : "text-fg-muted hover:text-fg")
            }
          >
            {l === "en" ? t("nav.lang.en") : t("nav.lang.ko")}
          </button>
        );
      })}
    </div>
  );
}
