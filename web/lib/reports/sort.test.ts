import { describe, it, expect } from "vitest";
import { sortReports } from "./sort";

const c = (id: string, view_count: number, reply_count: number, article_date = "2026-10-01") => ({
  id,
  view_count,
  reply_count,
  article_date,
});

describe("sortReports", () => {
  const cards = [c("a", 5, 1), c("b", 9, 0), c("c", 5, 4), c("d", 0, 7, "2026-10-05")];

  it("views: most viewed, then most replied", () => {
    expect(sortReports(cards, "views").map((x) => x.id)).toEqual(["b", "c", "a", "d"]);
  });
  it("replies: most replied, then most viewed", () => {
    expect(sortReports(cards, "replies").map((x) => x.id)).toEqual(["d", "c", "a", "b"]);
  });
  it("latest keeps server order", () => {
    expect(sortReports(cards, "latest")).toBe(cards);
  });
  it("ties fall back to newest", () => {
    const tie = [c("old", 1, 1, "2026-10-01"), c("new", 1, 1, "2026-10-02")];
    expect(sortReports(tie, "views").map((x) => x.id)).toEqual(["new", "old"]);
  });
});
