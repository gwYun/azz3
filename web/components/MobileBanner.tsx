"use client";

import { useT } from "@/lib/i18n-context";

export function MobileBanner() {
  const t = useT();
  return (
    <div className="block bg-neutral-900 px-4 py-2 text-center text-xs text-white md:hidden">
      {t("mobile.banner")}
    </div>
  );
}
