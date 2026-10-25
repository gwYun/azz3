import { describe, it, expect, vi } from "vitest";
import { selectWithReplyCount } from "./reply-count";

describe("selectWithReplyCount", () => {
  it("adds reply_count to the columns", async () => {
    const run = vi.fn(async () => ({ data: [], error: null }));
    await selectWithReplyCount("a, b", run);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("a, b, reply_count");
  });

  it("retries without it when the column is missing (migration not applied)", async () => {
    const run = vi.fn(async (cols: string) =>
      cols.includes("reply_count")
        ? { data: null, error: { message: "column kbo_articles.reply_count does not exist" } }
        : { data: [1], error: null },
    );
    const res = await selectWithReplyCount("a", run);
    expect(run).toHaveBeenLastCalledWith("a");
    expect(res.data).toEqual([1]);
  });
});
