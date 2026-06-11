/**
 * ValueTrack (밸류트랙) brand lockup — inline SVG so it stays crisp at any size,
 * carries no white-box background on the translucent nav, and inherits the slate
 * brand color via `currentColor` (text-neutral-900 ≈ the logo's #2B3440).
 *
 * The mark is a "VT" monogram: a bold V whose right stroke shares the stem of a
 * T, drawn as filled polygons. `wordmark` toggles the "ValueTrack" text.
 */
type LogoProps = {
  className?: string;
  wordmark?: boolean;
};

export function Logo({ className, wordmark = true }: LogoProps) {
  return (
    <span className={"inline-flex items-center gap-2 text-neutral-900 " + (className ?? "")}>
      <svg
        viewBox="0 0 78 60"
        className="h-7 w-auto"
        role="img"
        aria-label="ValueTrack"
        fill="currentColor"
      >
        {/* V — left arm down to the apex */}
        <path d="M2 4 H17 L31 42 L24 60 Z" />
        {/* V — right (inner) arm */}
        <path d="M30 4 H44 L33 42 L25 42 Z" />
        {/* T — top bar */}
        <path d="M40 4 H76 L70 17 H46 Z" />
        {/* T — stem */}
        <path d="M52 17 H66 L57 42 H48 Z" />
      </svg>
      {wordmark && (
        <span className="font-display text-base font-semibold tracking-tight">
          <span>Value</span>
          <span className="text-neutral-500">Track</span>
        </span>
      )}
    </span>
  );
}
