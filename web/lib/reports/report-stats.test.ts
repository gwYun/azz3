import { describe, it, expect, vi } from "vitest";
import { selectWithReportStats } from "./report-stats";

const missing = (col: string) => ({ data: null, error: { message: `column kbo_articles.${col} does not exist` } });

describe("selectWithReportStats", () => {
  it("adds both stats columns", async () => {
    const run = vi.fn(async () => ({ data: [], error: null }));
    await selectWithReportStats("a, b", run);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("a, b, reply_count, view_count");
  });

  it("drops view_count when only the replies migration is applied", async () => {
    const run = vi.fn(async (cols: string) => (cols.includes("view_count") ? missing("view_count") : { data: [1], error: null }));
    const res = await selectWithReportStats("a", run);
    expect(run).toHaveBeenLastCalledWith("a, reply_count");
    expect(res.data).toEqual([1]);
  });

  it("falls back to the base columns when neither is applied", async () => {
    const run = vi.fn(async (cols: string) =>
      cols.includes("view_count") ? missing("view_count") : cols.includes("reply_count") ? missing("reply_count") : { data: [1], error: null },
    );
    const res = await selectWithReportStats("a", run);
    expect(run).toHaveBeenLastCalledWith("a");
    expect(res.data).toEqual([1]);
  });
});
