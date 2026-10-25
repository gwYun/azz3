/**
 * Run a list query with the report stats columns (`reply_count`, `view_count`)
 * added. If a column doesn't exist yet (its migration not applied), retry with
 * fewer so the report lists keep working — missing stats read as 0.
 */
const STAT_SETS = [", reply_count, view_count", ", reply_count", ""];

export async function selectWithReportStats<R extends { error: { message: string } | null }>(
  base: string,
  run: (cols: string) => PromiseLike<R>,
): Promise<R> {
  let res!: R;
  for (const extra of STAT_SETS) {
    res = await run(base + extra);
    if (!(res.error && /reply_count|view_count/.test(res.error.message))) return res;
  }
  return res;
}
