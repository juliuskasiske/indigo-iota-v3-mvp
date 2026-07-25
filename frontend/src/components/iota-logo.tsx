import { cn } from "@/lib/utils";

interface IotaLogoProps {
  className?: string;
  /** Approximate cap-height in pixels. Defaults to 28. */
  size?: number;
  /** Override the brand color (defaults to #3812f3). */
  color?: string;
}

/**
 * The indigo iota wordmark.
 * "indigo" is set in Albert Sans (heavy weight, tightly tracked).
 * "iota"   is set in Instrument Serif italic, sliding into "indigo"
 *          with a small gap. The whole mark is one colour by default
 *          (#3812f3).
 *
 * The wordmark IS the logo — no icon. Use this anywhere the brand
 * needs to appear (sidebar, app shell, etc.).
 */
export function IotaLogo({
  className,
  size = 28,
  color = "#3812f3",
}: IotaLogoProps) {
  return (
    <span
      aria-label="indigo iota"
      className={cn(
        "inline-flex items-baseline leading-none select-none",
        className
      )}
      style={{ fontSize: size, color }}
    >
      <span
        className="font-sans font-extrabold tracking-tight"
        style={{ letterSpacing: "-0.03em", color }}
      >
        indigo
      </span>
      <span
        className="italic"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          fontSize: "1em",
          marginLeft: "0.04em",
          color,
        }}
      >
        iota
      </span>
    </span>
  );
}
