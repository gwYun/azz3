import { describe, it, expect } from "vitest";
import {
  CREDIT_PACKS,
  getPack,
  kboProduct,
  isFreeTeam,
  isTeamSlotOpen,
  kboArticleProduct,
  isArticleLockedByRank,
  isArticleOpen,
  ARTICLE_LOCK_WINDOW,
} from "./credits";

describe("credits config", () => {
  it("getPack returns the pack for a valid id", () => {
    expect(getPack("credits-5")).toEqual({ id: "credits-5", credits: 5, amount: 4500 });
  });

  it("getPack returns null for an unknown or empty id", () => {
    expect(getPack("credits-999")).toBeNull();
    expect(getPack("")).toBeNull();
  });

  it("every pack has positive integer amount and credits", () => {
    for (const p of CREDIT_PACKS) {
      expect(Number.isInteger(p.amount) && p.amount > 0).toBe(true);
      expect(Number.isInteger(p.credits) && p.credits > 0).toBe(true);
    }
  });

  it("bulk packs are cheaper per credit than the single", () => {
    const single = CREDIT_PACKS.find((p) => p.credits === 1);
    expect(single).toBeTruthy();
    const perCredit = (p: { amount: number; credits: number }) => p.amount / p.credits;
    for (const p of CREDIT_PACKS.filter((x) => x.credits > 1)) {
      expect(perCredit(p)).toBeLessThan(perCredit(single!));
    }
  });

  it("kboProduct builds a team + slot key", () => {
    expect(kboProduct("LG", "home")).toBe("kbo:LG:home");
    expect(kboProduct("LG", "away")).toBe("kbo:LG:away");
  });

  it("isFreeTeam is true only for Samsung and Hanwha", () => {
    expect(isFreeTeam("SS")).toBe(true);
    expect(isFreeTeam("HH")).toBe(true);
    expect(isFreeTeam("LG")).toBe(false);
  });

  it("isTeamSlotOpen: free teams always; others only for the unlocked slot", () => {
    expect(isTeamSlotOpen("SS", "home", [])).toBe(true);
    expect(isTeamSlotOpen("HH", "away", [])).toBe(true);
    expect(isTeamSlotOpen("LG", "home", [])).toBe(false);
    expect(isTeamSlotOpen("LG", "home", ["kbo:LG:home"])).toBe(true);
    expect(isTeamSlotOpen("LG", "away", ["kbo:LG:home"])).toBe(false);
  });
});

describe("article time-lock", () => {
  it("kboArticleProduct builds a team + date key", () => {
    expect(kboArticleProduct("HH", "2026-08-27")).toBe("kbo:article:HH:2026-08-27");
  });

  it("isArticleLockedByRank: locked within the newest window, free beyond it", () => {
    for (let r = 0; r < ARTICLE_LOCK_WINDOW; r++) expect(isArticleLockedByRank(r)).toBe(true);
    expect(isArticleLockedByRank(ARTICLE_LOCK_WINDOW)).toBe(false);
    expect(isArticleLockedByRank(ARTICLE_LOCK_WINDOW + 5)).toBe(false);
    expect(isArticleLockedByRank(-1)).toBe(false); // guard: unknown position isn't "locked"
  });

  it("isArticleOpen: free-by-age OR owned", () => {
    const owned = ["kbo:article:HH:2026-08-27"];
    // rank 0 (today) — locked unless owned
    expect(isArticleOpen("HH", "2026-08-27", 0, [])).toBe(false);
    expect(isArticleOpen("HH", "2026-08-27", 0, owned)).toBe(true);
    // rank beyond the window — free for everyone
    expect(isArticleOpen("HH", "2026-08-20", ARTICLE_LOCK_WINDOW, [])).toBe(true);
    // owning a different date doesn't open this one
    expect(isArticleOpen("LG", "2026-08-27", 0, owned)).toBe(false);
  });
});
