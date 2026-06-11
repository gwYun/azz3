/**
 * ValueTrack (밸류트랙) brand lockup — rendered from the cleaned transparent PNGs.
 *
 * The source art is flattened to a single flat color with all glossy reflections /
 * ghost artifacts removed and letter counters knocked transparent. Each tone ships
 * as three assets so the mark can stand alone:
 *   - *_light.png  bright (#e6ebf2) — for the dark UI (default; matches `fg`)
 *   - *.png        slate  (#2B3440) — for light surfaces (print / PDF on white)
 * with `logo*` = full lockup, `logo_vt*` = "VT" monogram, `logo_wordmark*` = wordmark.
 *
 * The app is dark-only, so `tone` defaults to "light". `wordmark` toggles between
 * the full lockup and the standalone monogram.
 */
import Image from "next/image";

type LogoProps = {
  className?: string;
  wordmark?: boolean;
  tone?: "light" | "dark";
};

export function Logo({ className, wordmark = true, tone = "light" }: LogoProps) {
  const suffix = tone === "light" ? "_light" : "";
  const src = wordmark ? `/logo${suffix}.png` : `/logo_vt${suffix}.png`;
  // Intrinsic sizes of the cropped assets (keep aspect ratio crisp).
  const dims = wordmark ? { w: 926, h: 177 } : { w: 280, h: 177 };
  return (
    <span className={"inline-flex items-center " + (className ?? "")}>
      <Image
        src={src}
        alt="ValueTrack"
        width={dims.w}
        height={dims.h}
        priority
        className="h-7 w-auto"
      />
    </span>
  );
}
