"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Lightbulb,
  ListChecks,
  FlaskConical,
  Calculator,
  Scale,
  Loader2,
  Clock,
  Play,
  Square,
  type LucideIcon,
} from "lucide-react";
import { api, ApiError, type SwarmStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

// Agent Swarm — the live roster. The project brain stays on; the agents start
// and stop with the button. Everything they do is logged in the Overview.

const ICONS: Record<string, LucideIcon> = {
  hypothesis: Lightbulb,
  planning: ListChecks,
  validator: FlaskConical,
  sizer: Calculator,
  judge: Scale,
};

export function AgentSwarmPanel({
  onAuthError,
}: {
  onAuthError?: (e: ApiError) => void;
}) {
  const [status, setStatus] = useState<SwarmStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<SwarmStatus | null> => {
    try {
      const s = await api.swarmStatus();
      setStatus(s);
      setErr(null);
      return s;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return null;
      }
      setErr(e instanceof Error ? e.message : "Could not reach the swarm.");
      return null;
    }
  }, [onAuthError]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await load();
      if (!alive) return;
      timer.current = setTimeout(tick, s?.running ? 3000 : 8000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const toggle = async () => {
    if (busy || !status) return;
    setBusy(true);
    try {
      const s = status.running ? await api.swarmStop() : await api.swarmStart();
      setStatus(s);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
      } else {
        setErr(e instanceof Error ? e.message : "Action failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background-elevated/60 px-4 py-6 text-sm text-foreground-subtle">
        <Loader2 className="h-4 w-4 animate-spin" />
        {err ?? "Loading the swarm…"}
      </div>
    );
  }

  const { running, total, roles } = status;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-foreground-subtle/50" />
          )}
          <span className="text-sm text-foreground">
            {running ? (
              <>
                <b className="font-semibold">{total}</b> agents running across{" "}
                {roles.length} roles
              </>
            ) : (
              "Swarm idle — the project brain stays on; start the agents to investigate."
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50",
            running
              ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
              : "bg-accent text-accent-foreground hover:bg-accent/90",
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : running ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {running ? "Stop swarm" : "Start swarm"}
        </button>
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      <div className="space-y-3">
        {roles.map((r) => {
          const Icon = ICONS[r.key] ?? Lightbulb;
          return (
            <div
              key={r.key}
              className="flex gap-4 rounded-xl border border-border bg-background-elevated/60 p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{r.name}</p>
                  {running ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {r.active} running
                    </span>
                  ) : (
                    <span className="rounded-full bg-background-soft px-2.5 py-0.5 text-xs text-foreground-subtle">
                      idle
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-snug text-foreground-muted">
                  {r.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="px-1 text-xs text-foreground-subtle">
        The project brain is always on. The agents start and stop with the
        button — everything they do is logged in the Overview.
      </p>
    </div>
  );
}

export function ComingSoon({ blurb }: { blurb?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-elevated/40 px-6 py-16 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Clock className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">Coming soon</p>
      {blurb && (
        <p className="mt-1 max-w-md text-sm text-foreground-muted">{blurb}</p>
      )}
    </div>
  );
}
