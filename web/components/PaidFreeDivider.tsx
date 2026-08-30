/**
 * Full-width divider dropped between the paid (recent) and free (older) cards in
 * a news list grid. `col-span-full` forces a fresh row, so the paid cards sit
 * above the line and the free ones below it.
 */
export function PaidFreeDivider({ label }: { label: string }) {
  return (
    <div className="col-span-full my-1 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-fg-dim">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
