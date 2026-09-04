"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n, useT } from "@/lib/i18n-context";
import { NEWS_LEAGUES } from "@/lib/news/leagues";
import { LangToggle } from "./LangToggle";
import { AuthButton } from "./AuthButton";
import { Logo } from "./Logo";

type NavItem = { href: string; label: string; activePaths?: string[]; active?: boolean };

// Two parent sections, each with forecasts in a secondary sub-tab row (하단 탭)
// shown only while inside that section:
//   이적시장 예측 (Transfer Market) → 축구 · 야구 · 가상 선수빌드
//   승부 예측     (Match Forecast)  → 월드컵 · KBO
// /saved lives under 가상 선수빌드 (/build) — it shows the market sub-tabs with
// 가상 선수빌드 active, and is reached via the in-page toggle, not a top-level tab.
const MARKET_PATHS = ["/transfers", "/salary", "/build", "/saved", "/worldcup-stars"];
const MATCH_PATHS = ["/worldcup", "/kbo", "/matchup"];
// News spans two roots: the hub (/news/*) AND the daily articles (/kbo/news/*).
// The latter is a sub-path of /kbo, so News must win over Match for those paths.
const NEWS_PATHS = ["/news", "/kbo/news"];

export function Nav() {
  const t = useT();
  const { locale } = useI18n();
  const path = usePathname();

  const matches = (href: string) => path === href || path.startsWith(href + "/");
  // News takes precedence — /kbo/news/* also matches /kbo (Match), so exclude News
  // paths from Match/Market to keep exactly one section active.
  const inNews = NEWS_PATHS.some(matches);
  const inMarket = !inNews && MARKET_PATHS.some(matches);
  const inMatch = !inNews && MATCH_PATHS.some(matches);

  // The News section's parent tab points at its first (live) sub-tab.
  const items: NavItem[] = [
    { href: "/news/kbo", label: t("nav.news"), active: inNews },
    { href: "/glossary", label: t("nav.glossary") },
    { href: "/transfers", label: t("nav.market"), active: inMarket },
    { href: "/worldcup", label: t("nav.match"), active: inMatch },
    { href: "/credits", label: t("nav.credits") },
    { href: "/contact", label: t("nav.contact") },
  ];

  // News sub-tabs (하단 탭): one per league; labels are locale-picked proper nouns.
  // The KBO sub-tab also owns the daily-article pages under /kbo/news.
  const newsSubItems: NavItem[] = NEWS_LEAGUES.map((l) => ({
    href: `/news/${l.id}`,
    label: locale === "ko" ? l.ko : l.en,
    activePaths: l.id === "kbo" ? ["/news/kbo", "/kbo/news"] : undefined,
  }));

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
    item.active !== undefined
      ? item.active
      : item.activePaths
        ? item.activePaths.some(matches)
        : matches(item.href);

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
        <div className="flex items-center gap-2 sm:gap-3">
          <AuthButton />
          <LangToggle />
        </div>
      </div>
      {/* Mobile: horizontally scrollable tab row (desktop uses the inline nav above) */}
      <nav
        aria-label="primary"
        className="flex items-center gap-1 overflow-x-auto px-3 pb-2 sm:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(renderItem)}
      </nav>
      {/* Section sub-tabs (하단 탭) — shown only while inside that section */}
      {(inMarket || inMatch || inNews) && (
        <div className="border-t border-line/70 bg-ink-900/40">
          <nav
            aria-label={inMarket ? "transfer-market" : inNews ? "report" : "match-forecast"}
            className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="mr-1.5 hidden shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-dim sm:inline">
              {t(inMarket ? "nav.market" : inNews ? "nav.news" : "nav.match")}
            </span>
            {(inMarket ? marketSubItems : inNews ? newsSubItems : matchSubItems).map(renderSubItem)}
          </nav>
        </div>
      )}
    </header>
  );
}
