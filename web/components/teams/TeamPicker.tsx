"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n-context";
import { useFavorites } from "@/lib/favorites";
import { TeamLogo } from "@/components/shared/TeamLogo";
import { FavStar } from "@/components/teams/FavStar";

export type PickerTeam = { code: string; name: string };

/**
 * Club filter for a report league: search + an "All" tile + a crest grid, with the
 * viewer's favorite clubs pinned in their own "My teams" row. Each tile filters the
 * feed (click again to clear); the ☆ in its corner toggles the favorite.
 *
 * `logos=false` (postseason series filter) drops crests and favorites — those
 * "teams" are series codes, not clubs.
 */
export function TeamPicker({
  league,
  teams,
  value,
  onChange,
  logos = true,
}: {
  league: string;
  teams: PickerTeam[];
  value: string | null;
  onChange: (code: string | null) => void;
  logos?: boolean;
}) {
  const t = useT();
  const { isFavTeam, toggleTeam } = useFavorites();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? teams.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) : teams),
    [teams, q],
  );
  const favs = logos ? shown.filter((c) => isFavTeam(league, c.code)) : [];
  const rest = logos ? shown.filter((c) => !isFavTeam(league, c.code)) : shown;

  const tile = (c: PickerTeam) => {
    const active = value === c.code;
    const fav = logos && isFavTeam(league, c.code);
    return (
      <li key={c.code} className="relative">
        <button
          type="button"
          onClick={() => onChange(active ? null : c.code)}
          aria-pressed={active}
          className={
            "flex w-full items-center gap-2 rounded-xl border py-2 pl-2 text-left text-sm font-medium transition " +
            (logos ? "pr-7 " : "pr-2 ") +
            (active
              ? "border-accent bg-accent/15 text-fg"
              : "border-line bg-fg/5 text-fg-muted hover:border-accent/60 hover:text-fg")
          }
        >
          {logos && <TeamLogo league={league} code={c.code} name={c.name} size="sm" />}
          <span className="min-w-0 truncate">{c.name}</span>
        </button>
        {logos && (
          <FavStar
            on={fav}
            onToggle={() => toggleTeam({ league, code: c.code, name: c.name })}
            label={c.name}
            className="absolute right-1 top-1/2 -translate-y-1/2"
          />
        )}
      </li>
    );
  };

  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5";

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("newshub.searchTeams")}
          aria-label={t("newshub.searchTeams")}
          className="min-w-0 flex-1 rounded-xl border border-line bg-fg/5 px-4 py-2.5 text-sm text-fg outline-none placeholder:text-fg-dim focus:border-accent"
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={
            "shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition " +
            (value === null
              ? "border-accent bg-accent/15 text-fg"
              : "border-line text-fg-muted hover:border-accent/60 hover:text-fg")
          }
        >
          {t("newshub.allTeams")}
        </button>
      </div>

      {favs.length > 0 && (
        <>
          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">★ {t("fav.myTeams")}</div>
          <ul className={"mt-2 " + grid}>{favs.map(tile)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          {favs.length > 0 && (
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">{t("fav.otherTeams")}</div>
          )}
          <ul className={(favs.length > 0 ? "mt-2 " : "mt-3 ") + grid}>{rest.map(tile)}</ul>
        </>
      )}
      {q !== "" && shown.length === 0 && <p className="mt-3 text-sm text-fg-dim">{t("newshub.noTeamMatch")}</p>}
      {logos && favs.length === 0 && q === "" && teams.length > 0 && (
        <p className="mt-2 text-xs text-fg-dim">{t("fav.hint")}</p>
      )}
    </div>
  );
}
