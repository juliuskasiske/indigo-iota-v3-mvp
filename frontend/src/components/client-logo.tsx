import { cn } from "@/lib/utils";

/** Available logo styles. Each maps to a distinct SVG mark + color theme.
 *  Used by the init flow to let the manager pick a logo for a new client. */
export const LOGO_VARIANTS = [
  "lattice",
  "peak",
  "compass",
  "hex",
  "wave",
  "spark",
] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

interface ClientLogoProps {
  /** Company id from mock data — used to resolve to a built-in mark. If
   *  unknown, falls back to `variant` (or a generic mark). */
  companyId?: string;
  /** Explicit logo style. Overrides companyId-based resolution. */
  variant?: LogoVariant;
  /** Pixel size (square). Defaults to 32. */
  size?: number;
  /** When true, renders the mark + the wordmark side-by-side. */
  withWordmark?: boolean;
  /** The display name to render in wordmark mode. */
  name?: string;
  className?: string;
}

/**
 * Fictional client logos. Each is a small, distinct SVG mark with a flat
 * colored tile + a white-ish glyph, so they read cleanly at 24-48px.
 *  - Lattice Pay   →  rotated diamond outline + center dot (payments rails)
 *  - Atlas Mfg.    →  angular mountain-peak silhouette (industrial)
 *  - Polaris Cap.  →  4-point compass star (finance / direction)
 */
export function ClientLogo({
  companyId,
  variant,
  size = 32,
  withWordmark = false,
  name,
  className,
}: ClientLogoProps) {
  const resolvedVariant: LogoVariant | undefined =
    variant ?? (companyId ? COMPANY_TO_VARIANT[companyId] : undefined);
  const Mark = resolvedVariant ? VARIANT_MARKS[resolvedVariant] : FallbackMark;

  if (!withWordmark) {
    return (
      <span
        className={cn("inline-flex shrink-0", className)}
        style={{ width: size, height: size }}
      >
        <Mark size={size} />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="inline-flex shrink-0"
        style={{ width: size, height: size }}
      >
        <Mark size={size} />
      </span>
      {name && (
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {name}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Individual marks. Each accepts `size` so we don't depend on outer styling.
// ---------------------------------------------------------------------------

interface MarkProps {
  size: number;
}

function LatticeMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lattice-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0e7490" />
          <stop offset="1" stopColor="#155e75" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#lattice-grad)" />
      {/* Diamond outline */}
      <path
        d="M16 6 L26 16 L16 26 L6 16 Z"
        fill="none"
        stroke="#a5f3fc"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Inner cross — suggests routing / lattice */}
      <path
        d="M16 11 L16 21 M11 16 L21 16"
        stroke="#67e8f9"
        strokeWidth="1.1"
        strokeOpacity="0.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3" fill="#a5f3fc" />
    </svg>
  );
}

function AtlasMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="atlas-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c2d12" />
          <stop offset="1" stopColor="#9a3412" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#atlas-grad)" />
      {/* Two overlapping peaks */}
      <path
        d="M5 25 L12 11 L17 19 L20 14 L27 25 Z"
        fill="#fed7aa"
      />
      {/* Sun / focal dot */}
      <circle cx="22" cy="9" r="1.8" fill="#fef3c7" />
    </svg>
  );
}

function PolarisMark({ size }: MarkProps) {
  // 4-point compass star. The vertical axis is longer (classic Polaris look).
  // Stretched-diamond + thinner crossbar.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="polaris-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#312e81" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#polaris-grad)" />
      {/* Vertical (longer) axis */}
      <path d="M16 4 L18 16 L16 28 L14 16 Z" fill="#fef3c7" />
      {/* Horizontal (shorter) axis */}
      <path d="M5 16 L16 14.5 L27 16 L16 17.5 Z" fill="#fde68a" />
      <circle cx="16" cy="16" r="1.3" fill="#92400e" />
    </svg>
  );
}

function HexMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hex-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#065f46" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#hex-grad)" />
      {/* Filled hexagon */}
      <path
        d="M16 5 L25 10.5 L25 21.5 L16 27 L7 21.5 L7 10.5 Z"
        fill="#a7f3d0"
        opacity="0.95"
      />
      <path
        d="M16 11 L21 14 L21 18 L16 21 L11 18 L11 14 Z"
        fill="#065f46"
      />
    </svg>
  );
}

function WaveMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wave-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#075985" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#wave-grad)" />
      {/* Two stacked waves */}
      <path
        d="M4 14 Q10 9, 16 14 T28 14"
        stroke="#bae6fd"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M4 21 Q10 16, 16 21 T28 21"
        stroke="#7dd3fc"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

function SparkMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#581c87" />
          <stop offset="1" stopColor="#6b21a8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#spark-grad)" />
      {/* Sparkle / asterisk burst */}
      <path
        d="M16 6 L16 26 M6 16 L26 16 M9 9 L23 23 M23 9 L9 23"
        stroke="#e9d5ff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.5" fill="#fef3c7" />
    </svg>
  );
}

function FallbackMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="7" fill="hsl(230 18% 18%)" />
      <circle cx="16" cy="16" r="6" fill="hsl(220 12% 65%)" />
    </svg>
  );
}

const VARIANT_MARKS: Record<LogoVariant, (props: MarkProps) => React.JSX.Element> = {
  lattice: LatticeMark,
  peak: AtlasMark,
  compass: PolarisMark,
  hex: HexMark,
  wave: WaveMark,
  spark: SparkMark,
};

const COMPANY_TO_VARIANT: Record<string, LogoVariant> = {
  co_lattice: "lattice",
  co_atlas: "peak",
  co_polaris: "compass",
};
