"use client";

import { useState } from "react";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { useAccount } from "@/lib/useAccount";
import { BETA_MAX_BALANCE, type CreditPack } from "@/lib/credits";

/** BETA: tops up one credit pack free of charge. */
export function ChargeCreditsButton({ pack }: { pack: CreditPack }) {
  const t = useT();
  const { show } = useToast();
  const { refresh } = useAccount();
  const [loading, setLoading] = useState(false);

  const charge = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/credits/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      if (res.status === 401) show(t("credits.loginFirst"));
      else if (res.status === 409) show(t("credits.capReached", { n: String(BETA_MAX_BALANCE) }));
      else if (!res.ok) show(t("credits.chargeFailed"));
      else {
        show(t("credits.charged", { n: String(pack.credits) }));
        refresh();
      }
    } catch {
      show(t("credits.chargeFailed"));
    }
    setLoading(false);
  };

  return (
    <button
      type="button"
      onClick={charge}
      disabled={loading}
      className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-60"
    >
      {loading ? t("credits.charging") : t("credits.chargeFree")}
    </button>
  );
}
