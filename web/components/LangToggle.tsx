"use client";

import { useI18n } from "@/lib/i18n-context";
import { LOCALES, Locale } from "@/lib/i18n";

export function LangToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("nav.lang.label")}
      className="inline-flex rounded border border-neutral-300 p-0.5 text-xs"
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
              "rounded-sm px-2 py-1 font-medium transition " +
              (active
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:text-neutral-900")
            }
          >
            {l === "en" ? t("nav.lang.en") : t("nav.lang.ko")}
          </button>
        );
      })}
    </div>
  );
}
