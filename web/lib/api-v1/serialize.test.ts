import { describe, it, expect } from "vitest";
import { parseDateRange, parseLimit, stripHtml } from "./serialize";

const range = (qs: string) => parseDateRange(new URLSearchParams(qs));

describe("parseDateRange", () => {
  it("returns an all-null range with no params", () => {
    const r = range("");
    expect(r).toEqual({ ok: true, range: { from: null, to: null } });
  });

  it("reads an explicit from/to range", () => {
    const r = range("from=2026-09-20&to=2026-09-27");
    expect(r).toEqual({ ok: true, range: { from: "2026-09-20", to: "2026-09-27" } });
  });

  it("treats a bare date as a single-day range", () => {
    const r = range("date=2026-09-27");
    expect(r).toEqual({ ok: true, range: { from: "2026-09-27", to: "2026-09-27" } });
  });

  it("prefers explicit from/to over date", () => {
    const r = range("date=2026-01-01&from=2026-09-20");
    expect(r).toEqual({ ok: true, range: { from: "2026-09-20", to: null } });
  });

  it("accepts an open-ended range (only from, or only to)", () => {
    expect(range("from=2026-09-01")).toMatchObject({ range: { from: "2026-09-01", to: null } });
    expect(range("to=2026-09-30")).toMatchObject({ range: { from: null, to: "2026-09-30" } });
  });

  it("rejects a malformed date", () => {
    expect(range("from=2026-9-1")).toEqual({ ok: false, error: "invalid_from" });
    expect(range("to=nope")).toEqual({ ok: false, error: "invalid_to" });
    expect(range("date=2026/09/27")).toEqual({ ok: false, error: "invalid_date" });
  });

  it("rejects an inverted range", () => {
    expect(range("from=2026-09-27&to=2026-09-20")).toEqual({ ok: false, error: "invalid_range" });
  });

  it("allows from == to", () => {
    expect(range("from=2026-09-27&to=2026-09-27")).toMatchObject({ ok: true });
  });
});

describe("parseLimit", () => {
  it("falls back on missing/invalid, clamps to max, floors", () => {
    expect(parseLimit(null, 10, 60)).toBe(10);
    expect(parseLimit("abc", 10, 60)).toBe(10);
    expect(parseLimit("0", 10, 60)).toBe(10);
    expect(parseLimit("-5", 10, 60)).toBe(10);
    expect(parseLimit("5", 10, 60)).toBe(5);
    expect(parseLimit("999", 10, 60)).toBe(60);
    expect(parseLimit("7.9", 10, 60)).toBe(7);
  });
});

describe("stripHtml", () => {
  it("flattens tags and decodes basic entities", () => {
    // Each closing block tag emits one newline; inline tags are just removed.
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p><p>Line&amp;two</p>")).toBe(
      "Hello world\nLine&two",
    );
  });

  it("collapses 3+ newlines to a paragraph break and trims", () => {
    // </div>+3×<br> = 4 newlines → collapsed to \n\n; trailing \n trimmed.
    expect(stripHtml("<div>a</div><br><br><br><div>b</div>")).toBe("a\n\nb");
  });
});
