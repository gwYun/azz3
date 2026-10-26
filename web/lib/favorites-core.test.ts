import { describe, expect, it } from "vitest";
import {
  favoritesFirst,
  hasTeam,
  MAX_FAV_TEAMS,
  mergeFavorites,
  sanitizeFavorites,
  toggleLeague,
  toggleTeam,
} from "./favorites-core";

describe("sanitizeFavorites", () => {
  it("drops junk and dedupes", () => {
    const f = sanitizeFavorites({
      leagues: ["kbo", "kbo", 3, "", "epl"],
      teams: [
        { league: "kbo", code: "LG", name: "LG" },
        { league: "kbo", code: "LG", name: "dup" },
        { league: "epl", code: 12 },
        null,
        { league: "epl", code: "12" },
      ],
    });
    expect(f.leagues).toEqual(["kbo", "epl"]);
    expect(f.teams).toEqual([
      { league: "kbo", code: "LG", name: "LG" },
      { league: "epl", code: "12", name: "12" },
    ]);
  });

  it("handles non-objects", () => {
    expect(sanitizeFavorites(null)).toEqual({ leagues: [], teams: [] });
    expect(sanitizeFavorites("x")).toEqual({ leagues: [], teams: [] });
  });
});

describe("toggles", () => {
  it("adds and removes a team", () => {
    const t = { league: "epl", code: "12", name: "맨유" };
    const on = toggleTeam({ leagues: [], teams: [] }, t);
    expect(hasTeam(on, "epl", "12")).toBe(true);
    expect(hasTeam(toggleTeam(on, t), "epl", "12")).toBe(false);
  });

  it("same code in another league is a different team", () => {
    const f = toggleTeam({ leagues: [], teams: [] }, { league: "epl", code: "12", name: "a" });
    expect(hasTeam(f, "champs", "12")).toBe(false);
  });

  it("caps teams", () => {
    let f = { leagues: [] as string[], teams: [] as { league: string; code: string; name: string }[] };
    for (let i = 0; i < MAX_FAV_TEAMS + 5; i++) f = toggleTeam(f, { league: "epl", code: String(i), name: "x" });
    expect(f.teams).toHaveLength(MAX_FAV_TEAMS);
  });

  it("toggles a league", () => {
    const on = toggleLeague({ leagues: [], teams: [] }, "kbo");
    expect(on.leagues).toEqual(["kbo"]);
    expect(toggleLeague(on, "kbo").leagues).toEqual([]);
  });
});

describe("mergeFavorites", () => {
  it("unions with the first set's order", () => {
    const m = mergeFavorites(
      { leagues: ["epl"], teams: [{ league: "kbo", code: "LG", name: "LG" }] },
      { leagues: ["kbo", "epl"], teams: [{ league: "kbo", code: "LG", name: "LG" }, { league: "kbo", code: "SS", name: "삼성" }] },
    );
    expect(m.leagues).toEqual(["epl", "kbo"]);
    expect(m.teams.map((t) => t.code)).toEqual(["LG", "SS"]);
  });
});

describe("favoritesFirst", () => {
  it("floats favorites, stable within groups", () => {
    expect(favoritesFirst([1, 2, 3, 4, 5], (n) => n % 2 === 0)).toEqual([2, 4, 1, 3, 5]);
  });
});
