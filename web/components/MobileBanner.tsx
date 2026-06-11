"use client";

import { useT } from "@/lib/i18n-context";

export function MobileBanner() {
  const t = useT();
  return (
    <div className="relative z-10 block border-b border-line bg-ink-900 px-4 py-2 text-center text-xs text-fg-muted md:hidden">
      {t("mobile.banner")}
    </div>
  );
}
