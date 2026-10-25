/**
 * Run a list query with `reply_count` added to its columns; if the column doesn't
 * exist yet (report_replies migration not applied), retry without it so the
 * report lists keep working — cards then show 0.
 */
export async function selectWithReplyCount<R extends { error: { message: string } | null }>(
  base: string,
  run: (cols: string) => PromiseLike<R>,
): Promise<R> {
  const res = await run(`${base}, reply_count`);
  if (res.error && /reply_count/.test(res.error.message)) return run(base);
  return res;
}
