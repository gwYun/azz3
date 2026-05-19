"use client";

import { useEffect, useState } from "react";
import { EUR_KRW_FALLBACK } from "./format";

const STORAGE_KEY = "azz3.fx.eurkrw";
const TTL_MS = 60 * 60 * 1000; // 1 hour
const ENDPOINT = "https://api.frankfurter.app/latest?from=EUR&to=KRW";

type Cached = { rate: number; fetchedAt: number };

export type FxRate = {
  rate: number;
  loading: boolean;
  stale: boolean;
};

function readCache(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (typeof parsed.rate !== "number" || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rate: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rate, fetchedAt: Date.now() } satisfies Cached),
    );
  } catch {
    /* ignore quota errors */
  }
}

/** Fetch live EUR→KRW once per session; fall back to a static constant if the API fails. */
export function useFxRate(): FxRate {
  const [state, setState] = useState<FxRate>(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return { rate: cached.rate, loading: false, stale: false };
    }
    return { rate: EUR_KRW_FALLBACK, loading: true, stale: false };
  });

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rates?: { KRW?: number } };
        const rate = data.rates?.KRW;
        if (!rate || !isFinite(rate)) throw new Error("missing KRW rate");
        if (cancelled) return;
        writeCache(rate);
        setState({ rate, loading: false, stale: false });
      } catch {
        if (cancelled) return;
        setState({ rate: EUR_KRW_FALLBACK, loading: false, stale: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
