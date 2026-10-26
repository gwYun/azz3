"use client";

import Link from "next/link";
import { useFavorites } from "@/lib/favorites";
import { TeamLogo } from "@/components/shared/TeamLogo";
import { FavStar } from "@/components/teams/FavStar";

/** Crest + club name + ☆ on a report reader; the name links to the club's archive. */
export function ReportTeamHeader({ league, code, name }: { league: string; code: string; name: string }) {
  const { isFavTeam, toggleTeam } = useFavorites();
  return (
    <div className="mt-5 flex items-center gap-2.5">
      <TeamLogo league={league} code={code} name={name} size="lg" />
      <Link
        href={`/reports/${league}?team=${encodeURIComponent(code)}`}
        className="font-display text-lg font-semibold text-fg hover:text-accent"
      >
        {name}
      </Link>
      <FavStar on={isFavTeam(league, code)} onToggle={() => toggleTeam({ league, code, name })} label={name} size="md" />
    </div>
  );
}
