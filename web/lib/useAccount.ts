"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type Account = {
  /** Credit balance. */
  credits: number;
  /** Entitlement product keys the user owns (e.g. "kbo:LG-DOOSAN"). */
  unlocked: string[];
  loading: boolean;
  signedIn: boolean;
  /** Re-read balance + unlocks (call after a purchase or unlock). */
  refresh: () => void;
};

const EMPTY = { credits: 0, unlocked: [] as string[] };

/**
 * Reads the current user's credit balance + unlocked products through RLS
 * (both are select-own). Re-reads on auth changes and on refresh().
 */
export function useAccount(): Account {
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
        supabase.from("profiles").select("credits").eq("id", user.id).maybeSingle(),
        supabase.from("entitlements").select("product").eq("user_id", user.id),
      ]);
      if (active) {
        setState({
          credits: (profile as { credits?: number } | null)?.credits ?? 0,
          unlocked: ((ents ?? []) as { product: string }[]).map((e) => e.product),
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

  return { ...state, refresh };
}
