"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-context";
import type { TKey } from "@/lib/i18n";

// Sub-page toggle for the 가상 선수빌드 area: switch between the builder (/build)
// and the saved-builds list (/saved). Saved lives under Player Builder, not as a
// top-level nav tab.
const TABS: { href: string; key: TKey }[] = [
  { href: "/build", key: "build.title" },
  { href: "/saved", key: "saved.title" },
];

export function BuildTabs() {
  const t = useT();
  const path = usePathname();
  return (
    <div className="inline-flex rounded-xl border border-line bg-ink-850/60 p-1">
      {TABS.map((tab) => {
        const active = path === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-lg px-4 py-2 text-sm font-semibold transition " +
              (active
                ? "bg-accent text-ink-950 shadow-sm"
                : "text-fg-muted hover:bg-white/5 hover:text-fg")
            }
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </div>
  );
}
