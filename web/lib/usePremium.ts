"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { PREMIUM_PRODUCT } from "@/lib/premium";

type PremiumState = {
  /** True once we've confirmed the user holds the premium entitlement. */
  premium: boolean;
  /** True while the initial check is in flight (avoids a locked→unlocked flash). */
  loading: boolean;
  /** True when the user is signed in (premium purchase requires login first). */
  signedIn: boolean;
};

/**
 * Client-side premium check. Reads the current user's entitlement through RLS
 * (a user can only ever see their own row), and re-checks on auth changes so
 * the UI updates right after login or a completed purchase redirect.
 */
export function usePremium(): PremiumState {
  const [state, setState] = useState<PremiumState>({
    premium: false,
    loading: true,
    signedIn: false,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState({ premium: false, loading: false, signedIn: false });
      return;
    }
    const supabase = createClient();
    let active = true;

    const check = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setState({ premium: false, loading: false, signedIn: false });
        return;
      }
      const { data } = await supabase
        .from("entitlements")
        .select("id")
        .eq("user_id", user.id)
        .eq("product", PREMIUM_PRODUCT)
        .maybeSingle();
      if (active) {
        setState({ premium: Boolean(data), loading: false, signedIn: true });
      }
    };

    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => check());
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
