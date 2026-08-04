import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, getPack, kboProduct, isFreeMatchup } from "./credits";

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

  it("kboProduct builds an order-sensitive key", () => {
    expect(kboProduct("LG", "DOOSAN")).toBe("kbo:LG-DOOSAN");
    expect(kboProduct("DOOSAN", "LG")).toBe("kbo:DOOSAN-LG");
  });

  it("isFreeMatchup is true only for Samsung vs Hanwha, both orderings", () => {
    expect(isFreeMatchup("SS", "HH")).toBe(true);
    expect(isFreeMatchup("HH", "SS")).toBe(true);
    expect(isFreeMatchup("SS", "LG")).toBe(false);
    expect(isFreeMatchup("LG", "OB")).toBe(false);
  });
});
