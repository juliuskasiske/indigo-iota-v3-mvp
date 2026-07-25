"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Brand marks for the Sources network (ingress source types + egress
 * assistants).
 *
 * The recognisable brand logos (Outlook, Slack, SharePoint, Notion, OneNote,
 * Claude) are the official marks, served from `public/providers/*.svg` and shown
 * via <img> — each <img> is its own SVG document, so the Microsoft logos' inner
 * gradient ids can't collide when a logo renders twice on one page. The simpler,
 * non-trademarked glyphs (generic IMAP envelope, ChatGPT swirl, etc.) stay inline.
 * "Coming soon" types render greyscaled.
 *
 * Home Turf is NOT here — it's a styled wordmark (see HomeTurfLogo) that mirrors
 * the indigo iota brand split rather than an icon.
 */
export type ProviderId =
  | "outlook"
  | "imap"
  | "teams"
  | "slack"
  | "googledrive"
  | "sharepoint"
  | "notion"
  | "onenote"
  | "claude"
  | "chatgpt";

// Ids rendered from a bundled official SVG file (public/providers/<id>.svg)
// instead of an inline glyph.
const FILE_LOGOS = new Set<ProviderId>([
  "outlook",
  "slack",
  "sharepoint",
  "notion",
  "onenote",
  "claude",
]);

function mark(id: ProviderId, size: number): ReactNode {
  switch (id) {
    case "imap":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <rect
            x="2.5"
            y="5"
            width="19"
            height="14"
            rx="2.5"
            fill="none"
            stroke="#3812f3"
            strokeWidth="1.7"
          />
          <path
            d="M3.5 6.5 L12 13 L20.5 6.5"
            fill="none"
            stroke="#3812f3"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "teams":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="#6264A7" />
          <text
            x="12"
            y="16.5"
            fontFamily="Arial"
            fontSize="12"
            fontWeight="700"
            fill="#fff"
            textAnchor="middle"
          >
            T
          </text>
        </svg>
      );
    case "googledrive":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M8 3 L16 3 L22 13 L14 13 Z" fill="#FFCF44" />
          <path d="M8 3 L2 13 L6 20 L12 9.5 Z" fill="#3777E3" />
          <path d="M22 13 L18 20 L6 20 L10 13 Z" fill="#11A861" />
        </svg>
      );
    case "chatgpt": {
      // Official OpenAI mark: green rounded square + white swirl (one petal,
      // rotated 6× around the centre). Petal is drawn 6× directly (no <use>/id)
      // so two instances on one page can't collide on a shared element id.
      const petal =
        "M1107.3 299.1c-197.999 0-373.9 127.3-435.2 315.3L650 743.5v427.9c0 21.4 11 40.4 29.4 51.4l344.5 198.515V833.3h.1v-27.9L1372.7 604c33.715-19.52 70.44-32.857 108.47-39.828L1447.6 450.3C1361 353.5 1237.1 298.5 1107.3 299.1zm0 117.5-.6.6c79.699 0 156.3 27.5 217.6 78.4-2.5 1.2-7.4 4.3-11 6.1L952.8 709.3c-18.4 10.4-29.4 30-29.4 51.4V1248l-155.1-89.4V755.8c-.1-187.099 151.601-338.9 339-339.2z";
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 2406 2406"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M1 578.4C1 259.5 259.5 1 578.4 1h1249.1c319 0 577.5 258.5 577.5 577.4V2406H578.4C259.5 2406 1 2147.5 1 1828.6V578.4z"
            fill="#74aa9c"
          />
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <path
              key={deg}
              d={petal}
              fill="#fff"
              transform={deg ? `rotate(${deg} 1203 1203)` : undefined}
            />
          ))}
        </svg>
      );
    }
  }
}

export function ProviderLogo({
  id,
  size = 26,
  grey = false,
  className,
}: {
  id: ProviderId;
  size?: number;
  grey?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      style={{
        width: size,
        height: size,
        filter: grey ? "grayscale(1)" : undefined,
      }}
    >
      {FILE_LOGOS.has(id) ? (
        // Official brand mark from public/providers/<id>.svg. Plain <img> (not
        // next/image) — the site is a static export and these are tiny inline-
        // sized icons that don't need the loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/providers/${id}.svg`}
          alt=""
          width={size}
          height={size}
          style={{ display: "block", width: size, height: size }}
        />
      ) : (
        mark(id, size)
      )}
    </span>
  );
}

/**
 * The "Home Turf" egress wordmark — Indigo Iota's own brain consumer (this app).
 * Mirrors IotaLogo's indigo/iota split so it reads as a sibling of the brand:
 * "home" in Albert Sans 800, "turf" in Instrument Serif italic, both indigo,
 * all lowercase (consistent with the "indigo iota" logo wordmark).
 */
export function HomeTurfLogo({
  size = 18,
  color = "#3812f3",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <span
      aria-label="home turf"
      className={cn("inline-flex items-baseline leading-none select-none", className)}
      style={{ fontSize: size, color }}
    >
      <span
        className="font-sans font-extrabold tracking-tight"
        style={{ letterSpacing: "-0.02em", color }}
      >
        home
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
        turf
      </span>
    </span>
  );
}
