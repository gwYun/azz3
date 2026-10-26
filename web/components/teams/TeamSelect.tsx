"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n-context";
import { useFavorites } from "@/lib/favorites";
import { favoritesFirst } from "@/lib/favorites-core";
import { TeamLogo } from "@/components/shared/TeamLogo";

export type SelectTeam = { code: string; name: string };

/**
 * Crest dropdown replacing a native <select> for team pickers: the trigger shows
 * the picked club's emblem, the list floats favorites to the top (★), greys out
 * the `exclude`d team and marks paywalled picks with 🔒. Keyboard: ↑/↓ move,
 * Enter/Space pick, Esc closes.
 */
export function TeamSelect({
  league,
  label,
  value,
  teams,
  onChange,
  exclude,
  locked,
}: {
  league: string;
  label: string;
  value: string;
  teams: SelectTeam[];
  onChange: (code: string) => void;
  exclude?: string;
  locked?: (code: string) => boolean;
}) {
  const t = useT();
  const { isFavTeam } = useFavorites();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const ordered = favoritesFirst(teams, (c) => isFavTeam(league, c.code));
  const current = teams.find((c) => c.code === value);
  const pickable = (c: SelectTeam) => c.code !== exclude;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openList = () => {
    setCursor(Math.max(0, ordered.findIndex((c) => c.code === value)));
    setOpen(true);
  };
  const pick = (c: SelectTeam) => {
    if (!pickable(c)) return;
    onChange(c.code);
    setOpen(false);
  };
  const step = (dir: 1 | -1) => {
    if (!ordered.length) return;
    let i = cursor;
    for (let n = 0; n < ordered.length; n++) {
      i = (i + dir + ordered.length) % ordered.length;
      if (pickable(ordered[i])) break;
    }
    setCursor(i);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (ordered[cursor]) pick(ordered[cursor]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-dim">{label}</span>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current?.name ?? t("teams.pick")}`}
        aria-activedescendant={open && ordered[cursor] ? `${listId}-${ordered[cursor].code}` : undefined}
        className="mt-1 flex h-11 w-full items-center gap-2 rounded-md border border-line bg-ink-900/80 px-2.5 text-left text-sm text-fg transition hover:border-cyan/40 focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/40"
      >
        {current && <TeamLogo league={league} code={current.code} name={current.name} size="sm" />}
        <span className="min-w-0 flex-1 truncate font-medium">{current?.name ?? t("teams.pick")}</span>
        {current && locked?.(current.code) && <span aria-hidden>🔒</span>}
        <span aria-hidden className={"text-fg-dim transition " + (open ? "rotate-180" : "")}>▾</span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-line bg-ink-850 p-1 shadow-card"
        >
          {ordered.map((c, i) => {
            const disabled = !pickable(c);
            const selected = c.code === value;
            const fav = isFavTeam(league, c.code);
            return (
              <li
                key={c.code}
                id={`${listId}-${c.code}`}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                onMouseEnter={() => !disabled && setCursor(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm " +
                  (disabled
                    ? "cursor-not-allowed opacity-40"
                    : "cursor-pointer " + (i === cursor ? "bg-white/5 text-fg" : "text-fg-muted")) +
                  (selected ? " font-semibold text-fg" : "")
                }
              >
                <TeamLogo league={league} code={c.code} name={c.name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {fav && <span className="text-xs text-accent" aria-label={t("fav.title")}>★</span>}
                {!disabled && locked?.(c.code) && <span aria-hidden>🔒</span>}
                {selected && <span aria-hidden className="text-accent">✓</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
