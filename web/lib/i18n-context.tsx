"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  Locale,
  STORAGE_KEY,
  TKey,
  isLocale,
  t as translate,
} from "./i18n";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TKey, vars?: Record<string, string>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

/**
 * Provider mounts at root layout. SSR renders with DEFAULT_LOCALE; on hydration
 * we read localStorage and update if it differs. Avoids a hydration mismatch by
 * keeping the first paint deterministic.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored) && stored !== locale) {
        setLocaleState(stored);
      }
    } catch {
      // private mode / disabled storage — silently use default
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore — locale just won't persist this session
    }
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string>) => translate(locale, key, vars),
    [locale]
  );

  const value = useMemo<Ctx>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Sugar: `const t = useT(); t("nav.build")`. */
export function useT() {
  return useI18n().t;
}
