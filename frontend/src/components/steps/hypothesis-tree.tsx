"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Radar } from "lucide-react";
import { api, ApiError, type SwarmTree, type SwarmLogEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HypothesisCanvas } from "./hypothesis-canvas";

// Overview — what the agent loop is investigating, drawn as a board: the
// one-sentence objective at the root, MECE branches carrying the reasoning for
// each cut, and concrete initiatives at the leaves.

const ROLE_LABEL: Record<string, string> = {
  system: "system",
  framer: "framer",
  decomposition: "decompose",
  initiative: "initiative",
  planning: "planning",
  validator: "validator",
  sizer: "sizer",
  judge: "judge",
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function money(amount: number, currency: string): string {
  const symbol = { EUR: "€", USD: "$", GBP: "£" }[currency] ?? `${currency} `;
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${symbol}${(amount / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${symbol}${(amount / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${symbol}${Math.round(amount / 1e3)}k`;
  return `${symbol}${Math.round(amount)}`;
}

/** How much of the program's target the sized initiatives account for.
 *
 *  Split by verdict, because "€4M found" means something different when it is
 *  all still unproven. One-time value is shown on its own line and never added
 *  into a recurring run-rate goal. */
function CoverageBar({ tree }: { tree: SwarmTree }) {
  const cov = tree.coverage;
  const obj = tree.objective;
  if (!cov || !obj) return null;

  const currency = obj.currency || "EUR";
  const target = cov.target;
  const supported = cov.by_status?.supported ?? 0;
  const unproven = cov.sized_total - supported;

  return (
    <div className="rounded-xl border border-border bg-background-elevated/60 px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          <b className="font-semibold">{money(cov.sized_total, currency)}</b>
          {target ? (
            <>
              {" "}of {money(target, currency)} {obj.metric_label} target
              <span className="ml-1.5 text-foreground-subtle">
                , {Math.round((cov.sized_total / target) * 100)}% covered
              </span>
            </>
          ) : (
            <> sized across the tree</>
          )}
        </p>
        <p className="text-xs text-foreground-subtle">
          {cov.initiatives_sized} of {cov.initiatives} initiatives sized
        </p>
      </div>

      {target ? (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-background-soft">
          <div
            className="h-full bg-success transition-[width] duration-500"
            style={{ width: `${Math.min(100, (supported / target) * 100)}%` }}
          />
          <div
            className="h-full bg-warning/70 transition-[width] duration-500"
            style={{ width: `${Math.min(100, (unproven / target) * 100)}%` }}
          />
        </div>
      ) : null}

      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {money(supported, currency)} supported
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-warning/70" />
          {money(unproven, currency)} still unproven
        </span>
        {cov.one_time_total > 0 && (
          <span>
            {money(cov.one_time_total, currency)} one-time, counted separately
          </span>
        )}
      </p>
    </div>
  );
}

function LogFeed({ events }: { events: SwarmLogEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="rounded-xl border border-border bg-background-elevated/50 p-3">
      <p className="mb-2 px-1 text-xs font-semibold text-foreground">Activity log</p>
      <ol className="max-h-72 space-y-0.5 overflow-y-auto">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2 rounded px-1.5 py-1 text-[13px]">
            <span className="w-[76px] shrink-0 font-mono text-[10px] uppercase tracking-wide text-accent">
              {ROLE_LABEL[e.role] ?? e.role}
            </span>
            <span className="flex-1 text-foreground-muted">{e.message}</span>
            <span className="shrink-0 text-[11px] text-foreground-subtle">{ago(e.ts)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function OverviewPanel({
  onAuthError,
}: {
  onAuthError?: (e: ApiError) => void;
}) {
  const [tree, setTree] = useState<SwarmTree | null>(null);
  const [events, setEvents] = useState<SwarmLogEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [t, l] = await Promise.all([api.swarmTree(), api.swarmLog()]);
      setTree(t);
      setEvents(l.events);
      setErr(null);
      return t.running;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return false;
      }
      setErr(e instanceof Error ? e.message : "Could not reach the swarm.");
      return false;
    }
  }, [onAuthError]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const running = await load();
      if (!alive) return;
      timer.current = setTimeout(tick, running ? 2500 : 8000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const running = tree?.running ?? false;
  const nodes = tree?.nodes ?? [];
  const hasTree = nodes.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          ) : (
            <Radar className="h-4 w-4 text-foreground-subtle" />
          )}
          <span className="text-sm text-foreground">
            {running
              ? "Agents investigating — the loop is running"
              : hasTree
                ? tree?.status === "complete"
                  ? "Diagnosis complete — the last pass is shown"
                  : "Swarm stopped — the last pass is shown"
                : "Swarm idle"}
          </span>
        </div>
        {hasTree && (
          <span className="text-xs text-foreground-subtle">
            <b className="font-semibold text-foreground">{nodes.length}</b> nodes
          </span>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {hasTree ? (
        <>
          {tree && <CoverageBar tree={tree} />}
          <HypothesisCanvas
            nodes={nodes}
            objective={tree?.objective ?? null}
            runKey={String(tree?.run_id ?? "none")}
          />
          <LogFeed events={events} />
          <p className="px-1 text-xs text-foreground-subtle">
            The root is the objective. Every branch is a cut of the problem with its
            reasoning attached, and every leaf an initiative you could start on —
            each justified by facts pulled straight from the brain.
          </p>
        </>
      ) : (
        !err && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-elevated/40 px-6 py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Radar className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-foreground">Nothing investigated yet</p>
            <p className="mt-1 max-w-md text-sm text-foreground-muted">
              Set the objective on the Objectives tab, then start the swarm from the
              Agent Swarm tab. The tree builds itself here as the agents work.
            </p>
          </div>
        )
      )}
    </div>
  );
}
