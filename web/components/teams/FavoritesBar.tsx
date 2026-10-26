"use client";

import Link from "next/link";
import { useI18n, useT } from "@/lib/i18n-context";
import { useFavorites } from "@/lib/favorites";
import { getNewsLeague } from "@/lib/news/leagues";
import { TeamLogo } from "@/components/shared/TeamLogo";

/**
 * Cross-league quick row of the viewer's favorite clubs — one tap jumps to that
 * club's report archive (/reports/<league>?team=<code>). Hidden when empty; the
 * team picker carries the "tap ☆ to pin" hint instead.
 */
export function FavoritesBar({ activeLeague, activeTeam }: { activeLeague?: string; activeTeam?: string | null }) {
  const t = useT();
  const { locale } = useI18n();
  const { favorites } = useFavorites();
  const teams = favorites.teams.filter((f) => getNewsLeague(f.league));
  if (teams.length === 0) return null;

  return (
    <nav aria-label={t("fav.title")} className="mt-5 flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-accent">★ {t("fav.myTeams")}</span>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {teams.map((f) => {
          const lg = getNewsLeague(f.league)!;
          const active = f.league === activeLeague && f.code === activeTeam;
          return (
            <Link
              key={`${f.league}:${f.code}`}
              href={`/reports/${f.league}?team=${encodeURIComponent(f.code)}`}
              aria-current={active ? "page" : undefined}
              title={`${f.name} · ${locale === "ko" ? lg.ko : lg.en}`}
              className={
                "flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition " +
                (active
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-line bg-fg/5 text-fg-muted hover:border-accent/60 hover:text-fg")
              }
            >
              <TeamLogo league={f.league} code={f.code} name={f.name} size="xs" />
              {f.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
