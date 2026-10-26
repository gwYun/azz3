"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  EMPTY_FAVORITES,
  hasTeam,
  mergeFavorites,
  sameFavorites,
  sanitizeFavorites,
  toggleLeague as toggleLeagueIn,
  toggleTeam as toggleTeamIn,
  type FavTeam,
  type Favorites,
} from "@/lib/favorites-core";

/**
 * Favorite leagues/teams, shared app-wide (nav sub-tabs, report hub, pickers).
 *
 * localStorage is the source of truth for the device and works signed-out. When
 * signed in, the set is mirrored to public.user_favorites (RLS: own row). The
 * first sign-in on a device unions the local and account copies (so picks made
 * signed-out aren't lost); after that the account copy wins on load, so a removal
 * on one device doesn't get resurrected by another. Every toggle upserts. Any DB failure (e.g. the migration not applied yet)
 * is swallowed — favorites just stay device-local.
 */
const KEY = "azz3.favorites.v1";
const mergedKey = (uid: string) => `azz3.favorites.merged.${uid}`;

function readLocal(): Favorites {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitizeFavorites(JSON.parse(raw)) : EMPTY_FAVORITES;
  } catch {
    return EMPTY_FAVORITES;
  }
}

function writeLocal(f: Favorites) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* private mode / quota — keep in memory only */
  }
}

type FavoritesApi = {
  favorites: Favorites;
  isFavLeague: (league: string) => boolean;
  isFavTeam: (league: string, code: string) => boolean;
  toggleLeague: (league: string) => void;
  toggleTeam: (team: FavTeam) => void;
};

const FavoritesContext = createContext<FavoritesApi | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Favorites>(EMPTY_FAVORITES);
  const userId = useRef<string | null>(null);

  const pushRemote = useCallback(async (f: Favorites) => {
    if (!isSupabaseConfigured || !userId.current) return;
    try {
      await createClient()
        .from("user_favorites")
        .upsert({ user_id: userId.current, leagues: f.leagues, teams: f.teams, updated_at: new Date().toISOString() });
    } catch {
      /* table missing / offline — device-local only */
    }
  }, []);

  // Hydrate from localStorage after mount (SSR renders the empty set) + follow other tabs.
  useEffect(() => {
    setFavorites(readLocal());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setFavorites(readLocal());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Account sync: merge local ∪ account on every sign-in.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    let active = true;

    const sync = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId.current = user?.id ?? null;
      if (!user) return;
      const { data, error } = await supabase
        .from("user_favorites")
        .select("leagues, teams")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !active) return;
      const local = readLocal();
      const remote = sanitizeFavorites(data ?? {});
      let mergedBefore = false;
      try {
        mergedBefore = window.localStorage.getItem(mergedKey(user.id)) === "1";
        window.localStorage.setItem(mergedKey(user.id), "1");
      } catch {
        /* no storage — union every time, harmless */
      }
      const merged = mergedBefore && data ? remote : mergeFavorites(local, remote);
      if (!sameFavorites(merged, local)) {
        writeLocal(merged);
        setFavorites(merged);
      }
      if (!data || !sameFavorites(merged, remote)) pushRemote(merged);
    };

    sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") sync();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [pushRemote]);

  const update = useCallback(
    (fn: (f: Favorites) => Favorites) => {
      // Read-modify-write against storage so a toggle in another tab isn't clobbered.
      const next = fn(readLocal());
      writeLocal(next);
      setFavorites(next);
      pushRemote(next);
    },
    [pushRemote],
  );

  const api: FavoritesApi = {
    favorites,
    isFavLeague: (league) => favorites.leagues.includes(league),
    isFavTeam: (league, code) => hasTeam(favorites, league, code),
    toggleLeague: (league) => update((f) => toggleLeagueIn(f, league)),
    toggleTeam: (team) => update((f) => toggleTeamIn(f, team)),
  };

  return createElement(FavoritesContext.Provider, { value: api }, children);
}

export function useFavorites(): FavoritesApi {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return ctx;
}
