import { describe, it, expect } from "vitest";
import { maskName, parseReportKey } from "./access";

describe("maskName", () => {
  it("masks the middle of 3+ char names", () => {
    expect(maskName("홍길동", "u")).toBe("홍*동");
    expect(maskName("Alexander", "u")).toBe("A***r");
  });
  it("masks short names", () => {
    expect(maskName("홍길", "u")).toBe("홍*");
    expect(maskName("A", "u")).toBe("A*");
  });
  it("falls back to a stable id tag", () => {
    expect(maskName(null, "abcd1234-0000")).toBe("팬#abcd");
  });
});

describe("parseReportKey", () => {
  it("validates per kind", () => {
    expect(parseReportKey({ kind: "kbo-daily", team: "LG", date: "2026-10-12" })).toBeTruthy();
    expect(parseReportKey({ kind: "kbo-daily", team: "XX", date: "2026-10-12" })).toBeNull();
    expect(parseReportKey({ kind: "kbo-postseason", team: "SPO", date: "2026-10-12" })).toBeTruthy();
    expect(parseReportKey({ kind: "soccer", team: "12", date: "2026-10-12" })).toBeNull();
    expect(parseReportKey({ kind: "kbo-daily", team: "LG", date: "10/12" })).toBeNull();
  });
});
