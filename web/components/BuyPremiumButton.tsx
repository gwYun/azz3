"use client";

import { useState } from "react";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { PREMIUM_PRICE_KRW } from "@/lib/premium";

/**
 * Starts the Kakao Pay checkout: POSTs to /api/pay/ready (which creates the
 * order server-side with the server-defined amount) and redirects the browser
 * to the returned Kakao Pay URL.
 */
export function BuyPremiumButton() {
  const t = useT();
  const { show } = useToast();
  const [loading, setLoading] = useState(false);

  const buy = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pay/ready", { method: "POST" });
      if (res.status === 401) {
        show(t("premium.loginFirst"));
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => null)) as { redirectUrl?: string } | null;
      if (!res.ok || !data?.redirectUrl) {
        show(t("premium.startFailed"));
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      show(t("premium.startFailed"));
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={buy}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
    >
      {loading
        ? t("premium.starting")
        : t("premium.buy", { price: PREMIUM_PRICE_KRW.toLocaleString() })}
    </button>
  );
}
