"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/utils";

/**
 * Renders a relative timestamp ("23h ago") without causing hydration
 * mismatches.
 *
 * relativeTime() depends on Date.now(), which differs between the
 * server/build render and the client render — so rendering it directly
 * during SSR/prerender throws a "server text didn't match client" error.
 *
 * We defer the computation to a useEffect (client, post-mount). The server
 * and the first client render both emit an empty placeholder (so hydration
 * matches), then the real value fills in a frame later. This also means the
 * value is always relative to the moment the page is actually viewed.
 */
export function RelativeTime({
  date,
  className,
}: {
  date: string | Date;
  className?: string;
}) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(relativeTime(date));
  }, [date]);

  return (
    <span className={className} suppressHydrationWarning>
      {label || " "}
    </span>
  );
}
