"use client";

import { useState } from "react";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import type { CreditPack } from "@/lib/credits";

/** Starts the Kakao Pay checkout for one credit pack. */
export function BuyCreditsButton({ pack }: { pack: CreditPack }) {
  const t = useT();
  const { show } = useToast();
  const [loading, setLoading] = useState(false);

  const buy = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pay/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      if (res.status === 401) {
        show(t("credits.loginFirst"));
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => null)) as { redirectUrl?: string } | null;
      if (!res.ok || !data?.redirectUrl) {
        show(t("credits.startFailed"));
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      show(t("credits.startFailed"));
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={buy}
      disabled={loading}
      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
    >
      {loading ? t("credits.starting") : t("credits.buyPack")}
    </button>
  );
}
