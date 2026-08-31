"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type Account = {
  /** Credit balance. */
  credits: number;
  /** Entitlement product keys the user owns (e.g. "kbo:LG:home"). */
  unlocked: string[];
  /** Staff account — bypasses every paywall (server enforces this too). */
  isAdmin: boolean;
  loading: boolean;
  signedIn: boolean;
  /** Re-read balance + unlocks (call after a purchase or unlock). */
  refresh: () => void;
};

const EMPTY = { credits: 0, unlocked: [] as string[], isAdmin: false };
const AccountContext = createContext<Account | null>(null);

/**
 * Single source of truth for the current user's credit balance + unlocks.
 * Provider lives once in the root layout, so the /matchup picker locks and the
 * result gate share ONE state — a refresh() after an unlock updates both (before
 * this was a per-component hook, so an unlock refreshed the gate but not the
 * picker's 🔒). Reads through RLS (both select-own); re-reads on auth change.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ ...EMPTY, loading: true, signedIn: false });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState({ ...EMPTY, loading: false, signedIn: false });
      return;
    }
    const supabase = createClient();
    let active = true;

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setState({ ...EMPTY, loading: false, signedIn: false });
        return;
      }
      const [{ data: profile }, { data: ents }] = await Promise.all([
        supabase.from("profiles").select("credits, is_admin").eq("id", user.id).maybeSingle(),
        supabase.from("entitlements").select("product").eq("user_id", user.id),
      ]);
      if (active) {
        const p = profile as { credits?: number; is_admin?: boolean } | null;
        setState({
          credits: p?.credits ?? 0,
          unlocked: ((ents ?? []) as { product: string }[]).map((e) => e.product),
          isAdmin: !!p?.is_admin,
          loading: false,
          signedIn: true,
        });
      }
    };

    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [tick]);

  return createElement(AccountContext.Provider, { value: { ...state, refresh } }, children);
}

export function useAccount(): Account {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}
