"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-context";
import { LangToggle } from "./LangToggle";
import { Logo } from "./Logo";

export function Nav() {
  const t = useT();
  const path = usePathname();
  const items: Array<{ href: string; label: string }> = [
    { href: "/", label: t("nav.glossary") },
    { href: "/build", label: t("nav.build") },
    { href: "/saved", label: t("nav.saved") },
    { href: "/worldcup", label: t("nav.worldcup") },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" aria-label="ValueTrack" className="shrink-0">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1">
          {items.map((item) => {
            const active = path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900")
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <LangToggle />
      </div>
    </header>
  );
}
