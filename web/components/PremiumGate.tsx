"use client";

import { usePremium } from "@/lib/usePremium";
import { useT } from "@/lib/i18n-context";
import { BuyPremiumButton } from "./BuyPremiumButton";

/**
 * Wrap any premium-only content. Shows the children once the user holds the
 * premium entitlement; otherwise a locked panel with the buy button (or a
 * "log in first" prompt). Drop this around whatever feature you're selling.
 */
export function PremiumGate({ children }: { children: React.ReactNode }) {
  const { premium, loading, signedIn } = usePremium();
  const t = useT();

  // Stable placeholder until we know entitlement — avoids a locked→unlocked flash.
  if (loading) return <div className="h-24" aria-hidden />;

  if (premium) return <>{children}</>;

  return (
    <div className="rounded-lg border border-line bg-ink-900/40 p-6 text-center">
      <p className="text-sm text-fg-muted">
        {signedIn ? t("premium.locked") : t("premium.loginToUnlock")}
      </p>
      {signedIn && (
        <div className="mt-4 flex justify-center">
          <BuyPremiumButton />
        </div>
      )}
    </div>
  );
}
