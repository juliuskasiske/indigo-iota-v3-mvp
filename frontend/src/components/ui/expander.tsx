"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A lightweight titled collapsible section. Used to stack several panels (e.g.
 * Credits / Brain activity / Mail sync) on one tab without them all being open
 * at once. Uncontrolled; `defaultOpen` sets the initial state.
 */
export function Expander({
  title,
  icon,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  // Optional right-aligned summary shown in the collapsed header (e.g. a count).
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-background-soft/40"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
            open && "rotate-90",
          )}
        />
        {icon}
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {subtitle && (
          <span className="shrink-0 text-xs text-foreground-subtle">{subtitle}</span>
        )}
      </button>
      {open && <div className="border-t border-border/60 p-4">{children}</div>}
    </div>
  );
}
