"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-context";
import { LangToggle } from "./LangToggle";
import { Logo } from "./Logo";

type NavItem = { href: string; label: string; activePaths?: string[] };

// Two parent sections, each with forecasts in a secondary sub-tab row (하단 탭)
// shown only while inside that section:
//   이적시장 예측 (Transfer Market) → 축구 · 야구 · 가상 선수빌드
//   승부 예측     (Match Forecast)  → 월드컵 · KBO
// /saved lives under 가상 선수빌드 (/build) — it shows the market sub-tabs with
// 가상 선수빌드 active, and is reached via the in-page toggle, not a top-level tab.
const MARKET_PATHS = ["/transfers", "/salary", "/build", "/saved", "/worldcup-stars"];
const MATCH_PATHS = ["/worldcup", "/kbo", "/matchup"];

export function Nav() {
  const t = useT();
  const path = usePathname();

  const matches = (href: string) => path === href || path.startsWith(href + "/");
  const inMarket = MARKET_PATHS.some(matches);
  const inMatch = MATCH_PATHS.some(matches);

  const items: NavItem[] = [
    { href: "/glossary", label: t("nav.glossary") },
    { href: "/transfers", label: t("nav.market"), activePaths: MARKET_PATHS },
    { href: "/worldcup", label: t("nav.match"), activePaths: MATCH_PATHS },
    { href: "/contact", label: t("nav.contact") },
  ];

  const marketSubItems: NavItem[] = [
    { href: "/transfers", label: t("nav.sub.soccer") },
    { href: "/salary", label: t("nav.sub.baseball") },
    { href: "/build", label: t("nav.sub.build"), activePaths: ["/build", "/saved"] },
    { href: "/worldcup-stars", label: t("nav.sub.wcstars") },
  ];

  const matchSubItems: NavItem[] = [
    { href: "/worldcup", label: t("nav.sub.worldcup") },
    { href: "/kbo", label: t("nav.sub.kbo") },
    { href: "/matchup", label: t("nav.sub.matchup") },
  ];

  const isActive = (item: NavItem) =>
    item.activePaths ? item.activePaths.some(matches) : matches(item.href);

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    return (
      <Link
        key={item.href + item.label}
        href={item.href}
        className={
          "relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition " +
          (active ? "text-white" : "text-fg-muted hover:bg-white/5 hover:text-fg")
        }
        aria-current={active ? "page" : undefined}
      >
        {item.label}
        {active && (
          <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
        )}
      </Link>
    );
  };

  const renderSubItem = (item: NavItem) => {
    const active = item.activePaths ? item.activePaths.some(matches) : matches(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          "relative whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition " +
          (active ? "text-accent" : "text-fg-dim hover:bg-white/5 hover:text-fg")
        }
        aria-current={active ? "page" : undefined}
      >
        {item.label}
        {active && (
          <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
        )}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" aria-label="ValueTrack" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">{items.map(renderItem)}</nav>
        <LangToggle />
      </div>
      {/* Mobile: horizontally scrollable tab row (desktop uses the inline nav above) */}
      <nav
        aria-label="primary"
        className="flex items-center gap-1 overflow-x-auto px-3 pb-2 sm:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(renderItem)}
      </nav>
      {/* Section sub-tabs (하단 탭) — shown only while inside that section */}
      {(inMarket || inMatch) && (
        <div className="border-t border-line/70 bg-ink-900/40">
          <nav
            aria-label={inMarket ? "transfer-market" : "match-forecast"}
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="mr-1.5 hidden shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-dim sm:inline">
              {t(inMarket ? "nav.market" : "nav.match")}
            </span>
            {(inMarket ? marketSubItems : matchSubItems).map(renderSubItem)}
          </nav>
        </div>
      )}
    </header>
  );
}
