"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/lib/toast-context";
import { useT } from "@/lib/i18n-context";
import { PremiumGate } from "@/components/PremiumGate";

/**
 * Premium page body. Surfaces the ?pay= notice the payment routes append
 * (success | canceled | fail | error) as a toast, then shows the gated content.
 * Rendered inside a <Suspense> in the page so useSearchParams() is allowed.
 */
export function PremiumView() {
  const t = useT();
  const { show } = useToast();
  const params = useSearchParams();
  const shown = useRef(false);

  const pay = params.get("pay");
  useEffect(() => {
    if (!pay || shown.current) return;
    shown.current = true;
    const key =
      pay === "success"
        ? "premium.paySuccess"
        : pay === "canceled"
          ? "premium.payCanceled"
          : "premium.payFailed";
    show(t(key));
  }, [pay, show, t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("premium.title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t("premium.desc")}</p>
      </div>
      <PremiumGate>
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-6">
          <p className="font-medium text-accent">{t("premium.unlocked")}</p>
          <p className="mt-1 text-sm text-fg-muted">{t("premium.unlockedBody")}</p>
        </div>
      </PremiumGate>
    </div>
  );
}
