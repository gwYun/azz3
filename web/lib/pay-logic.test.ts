import { describe, it, expect } from "vitest";
import { ownsOrder, isAlreadyApproved, approvedAmountMatches, type Order } from "./pay-logic";

const order: Order = {
  id: "o1",
  user_id: "u1",
  product: "credits-5",
  amount: 4500,
  credits: 5,
  status: "ready",
};

describe("pay-logic", () => {
  describe("ownsOrder", () => {
    it("true when the order belongs to the user", () => {
      expect(ownsOrder(order, "u1")).toBe(true);
    });
    it("false for a different user", () => {
      expect(ownsOrder(order, "u2")).toBe(false);
    });
    it("false for a null order", () => {
      expect(ownsOrder(null, "u1")).toBe(false);
    });
  });

  describe("isAlreadyApproved", () => {
    it("true when approved", () => {
      expect(isAlreadyApproved({ ...order, status: "approved" })).toBe(true);
    });
    it("false otherwise", () => {
      expect(isAlreadyApproved(order)).toBe(false);
    });
  });

  describe("approvedAmountMatches", () => {
    it("true on an exact integer match", () => {
      expect(approvedAmountMatches(order, 4500)).toBe(true);
    });
    it("false on a mismatched amount", () => {
      expect(approvedAmountMatches(order, 100)).toBe(false);
    });
    it("false on a string (never trust a non-number)", () => {
      expect(approvedAmountMatches(order, "4900")).toBe(false);
    });
    it("false on undefined/missing", () => {
      expect(approvedAmountMatches(order, undefined)).toBe(false);
    });
    it("false on a non-integer", () => {
      expect(approvedAmountMatches(order, 4500.5)).toBe(false);
    });
  });
});
