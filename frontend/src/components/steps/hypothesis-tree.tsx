"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Mail,
  FileText,
  Package,
  Hash,
  Loader2,
  Radar,
} from "lucide-react";
import {
  api,
  ApiError,
  type SwarmTree,
  type SwarmNode,
  type SwarmFact,
  type SwarmLogEvent,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Overview — the live tally of what the agent loop is investigating. Reads the
// hypothesis tree + event log the swarm writes to the brain; branches are
// hypotheses, leaves are initiatives, and every node is justified by facts.

function countLeaves(n: SwarmNode): number {
  if (!n.children?.length) return 1;
  return n.children.reduce((s, c) => s + countLeaves(c), 0);
}
function countFacts(n: SwarmNode): number {
  const here = n.facts?.length ?? 0;
  return here + (n.children?.reduce((s, c) => s + countFacts(c), 0) ?? 0);
}

function dotClass(status: string | null, depth: number): string {
  if (status === "investigating") return "bg-amber-400";
  if (status === "supported") return "bg-emerald-400";
  if (status === "needs_evidence") return "bg-orange-400";
  if (status === "discarded") return "bg-foreground-subtle/50";
  return depth === 0 ? "bg-accent" : "bg-emerald-400";
}

function sourceIcon(source: string | null) {
  const s = (source ?? "").toLowerCase();
  if (s.includes("email") || s.includes("mail")) return Mail;
  if (s.includes("order")) return Package;
  return FileText;
}

function FactCard({ fact }: { fact: SwarmFact }) {
  const Icon = sourceIcon(fact.source);
  return (
    <div className="rounded-lg border border-border bg-background-elevated/50 px-3 py-2">
      <p className="text-[13px] leading-snug text-foreground-muted">{fact.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {fact.source && (
          <span className="inline-flex items-center gap-1 rounded-full bg-background-soft px-2 py-0.5 text-[11px] text-foreground-subtle">
            <Icon className="h-3 w-3" />
            {fact.source}
          </span>
        )}
        {fact.metric && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Hash className="h-3 w-3" />
            {fact.metric}
          </span>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: SwarmNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = !!node.children?.length;
  const hasFacts = !!node.facts?.length;
  const expandable = hasChildren || hasFacts;

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
          expandable ? "hover:bg-background-soft" : "cursor-default",
        )}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
            open && "rotate-90",
            !expandable && "opacity-0",
          )}
        />
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(node.status, depth))} />
        <span
          className={cn(
            "flex-1 text-sm",
            depth === 0
              ? "font-semibold text-foreground"
              : depth === 1
                ? "font-medium text-foreground"
                : "text-foreground",
          )}
        >
          {node.label}
        </span>
        {node.status === "investigating" && (
          <span className="hidden items-center gap-1 text-[11px] text-amber-600 sm:inline-flex dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            investigating
          </span>
        )}
        {node.status === "needs_evidence" && (
          <span className="hidden text-[11px] text-orange-600 sm:inline dark:text-orange-400">
            needs interview
          </span>
        )}
        {node.metric && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            {node.metric}
          </span>
        )}
      </button>

      {open && expandable && (
        <div className="ml-[11px] border-l border-border pl-4">
          {hasFacts && (
            <div className="my-2 space-y-1.5">
              {node.facts.map((f, i) => (
                <FactCard key={i} fact={f} />
              ))}
            </div>
          )}
          {node.children?.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  system: "system",
  hypothesis: "hypothesis",
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

function LogFeed({ events }: { events: SwarmLogEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="rounded-xl border border-border bg-background-elevated/50 p-3">
      <p className="mb-2 px-1 text-xs font-semibold text-foreground">Activity log</p>
      <ol className="max-h-72 space-y-0.5 overflow-y-auto">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-baseline gap-2 rounded px-1.5 py-1 text-[13px]"
          >
            <span className="w-[72px] shrink-0 font-mono text-[10px] uppercase tracking-wide text-accent">
              {ROLE_LABEL[e.role] ?? e.role}
            </span>
            <span className="flex-1 text-foreground-muted">{e.message}</span>
            <span className="shrink-0 text-[11px] text-foreground-subtle">
              {ago(e.ts)}
            </span>
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
  const root = tree?.tree ?? null;

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
              : root
                ? "Swarm stopped — last investigation shown"
                : "Swarm idle"}
          </span>
        </div>
        {root && (
          <div className="flex items-center gap-4 text-xs text-foreground-subtle">
            <span>
              <b className="font-semibold text-foreground">{countLeaves(root)}</b>{" "}
              initiatives
            </span>
            <span>
              <b className="font-semibold text-foreground">{countFacts(root)}</b>{" "}
              facts cited
            </span>
          </div>
        )}
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {root ? (
        <>
          <div className="rounded-xl border border-border bg-background/40 p-3">
            <TreeNode node={root} depth={0} />
          </div>
          <LogFeed events={events} />
        </>
      ) : (
        !err && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-elevated/40 px-6 py-16 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Radar className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              Nothing investigated yet
            </p>
            <p className="mt-1 max-w-md text-sm text-foreground-muted">
              Start the swarm from the Agent Swarm tab. As the agents read the
              brain, their hypotheses and the facts behind them appear here in
              real time.
            </p>
          </div>
        )
      )}

      {root && (
        <p className="px-1 text-xs text-foreground-subtle">
          Every branch is a hypothesis and every leaf an initiative — each
          justified by facts pulled straight from the brain, with the numbers
          attached.
        </p>
      )}
    </div>
  );
}
