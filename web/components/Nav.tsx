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
    { href: "/glossary", label: t("nav.glossary") },
    { href: "/build", label: t("nav.build") },
    { href: "/saved", label: t("nav.saved") },
    { href: "/worldcup", label: t("nav.worldcup") },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" aria-label="ValueTrack" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {items.map((item) => {
            const active = path === item.href || (item.href !== "/" && path.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "relative rounded-md px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "text-white"
                    : "text-fg-muted hover:bg-white/5 hover:text-fg")
                }
                aria-current={active ? "page" : undefined}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
                )}
              </Link>
            );
          })}
        </nav>
        <LangToggle />
      </div>
    </header>
  );
}
