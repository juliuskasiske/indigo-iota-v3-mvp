"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ArrowUp, ArrowDown, X, Loader2, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// Align, step 1: the objective function. The consultant picks the value levers
// the agent swarm should optimize for, grouped by the four balanced-scorecard
// perspectives, then ranks the selected ones by relevance. Step 2 is a free-text
// context field. All client-side — this is the "set the compass" surface.

type Item = { id: string; label: string };
type Bucket = { key: string; name: string; blurb: string; items: Item[] };

const BUCKETS: Bucket[] = [
  {
    key: "financial",
    name: "Financial",
    blurb: "Value that lands in the P&L and balance sheet.",
    items: [
      { id: "revenue", label: "Revenue growth" },
      { id: "margin", label: "Gross margin" },
      { id: "cost", label: "Cost reduction" },
      { id: "cash", label: "Cash & working capital" },
      { id: "roce", label: "Return on capital" },
    ],
  },
  {
    key: "customer",
    name: "Customer",
    blurb: "How the market and customers experience you.",
    items: [
      { id: "winrate", label: "Win rate" },
      { id: "retention", label: "Retention & churn" },
      { id: "csat", label: "Customer satisfaction" },
      { id: "pricing", label: "Pricing power" },
      { id: "share", label: "Market share" },
    ],
  },
  {
    key: "process",
    name: "Internal Process",
    blurb: "How efficiently the work actually runs.",
    items: [
      { id: "efficiency", label: "Operational efficiency" },
      { id: "automation", label: "Automation of manual work" },
      { id: "cycle", label: "Cycle time" },
      { id: "quality", label: "Quality & rework" },
      { id: "procurement", label: "Procurement & supplier consolidation" },
    ],
  },
  {
    key: "growth",
    name: "Learning & Growth",
    blurb: "The capability that compounds over time.",
    items: [
      { id: "productivity", label: "Employee productivity" },
      { id: "aiadoption", label: "AI adoption" },
      { id: "skills", label: "Capability & skills" },
      { id: "innovation", label: "Innovation" },
      { id: "data", label: "Data & tooling" },
    ],
  },
];

const ALL_ITEMS: Record<string, { id: string; label: string; bucket: string }> =
  Object.fromEntries(
    BUCKETS.flatMap((b) => b.items.map((i) => [i.id, { ...i, bucket: b.name }])),
  );

// A sensible pre-selection so the ranked list isn't empty on first view.
const DEFAULT_SELECTED = ["margin", "cost", "automation"];

function StepHead({
  n,
  title,
  desc,
}: {
  n: number;
  title: string;
  desc: string;
}) {
  return (
    <div className="mb-4 flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 text-xs font-semibold text-accent">
        {n}
      </span>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-foreground-muted">{desc}</p>
      </div>
    </div>
  );
}

export function AlignPanel({
  onAuthError,
}: {
  onAuthError?: (e: ApiError) => void;
}) {
  // `selected` is ordered — the order IS the ranking (index 0 = most relevant).
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [context, setContext] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  // Load the saved objective function on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const obj = await api.objective();
        if (!alive) return;
        const ranked = [...obj.priorities]
          .sort((a, b) => a.rank - b.rank)
          .map((p) => p.id)
          .filter((id) => id in ALL_ITEMS);
        if (ranked.length) setSelected(ranked);
        setContext(obj.context ?? "");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError?.(e);
        }
        // otherwise keep the defaults
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [onAuthError]);

  const touch = () => {
    setDirty(true);
    setSavedAt(false);
  };

  const toggle = (id: string) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
    touch();
  };

  const move = (i: number, dir: -1 | 1) => {
    setSelected((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
    touch();
  };

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const priorities = selected.map((id, i) => ({
        id,
        label: ALL_ITEMS[id].label,
        bucket: ALL_ITEMS[id].bucket,
        rank: i,
      }));
      await api.saveObjective({ priorities, context });
      setDirty(false);
      setSavedAt(true);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
      }
    } finally {
      setSaving(false);
    }
  }, [saving, selected, context, onAuthError]);

  return (
    <div className="space-y-10">
      {/* Save bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <p className="text-sm text-foreground-muted">
          This is the compass the agent swarm optimizes for. Save to apply it to
          the next run.
        </p>
        <div className="flex items-center gap-3">
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !loaded || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? "Saving…" : "Save objective"}
          </button>
        </div>
      </div>

      {/* Step 1 — the objective function */}
      <section>
        <StepHead
          n={1}
          title="Objective function"
          desc="Pick the value levers the agents should optimize for, then rank them by how much they matter. This becomes the weighting every downstream agent scores against."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {BUCKETS.map((b) => (
            <div
              key={b.key}
              className="rounded-xl border border-border bg-background-elevated/60 p-4"
            >
              <p className="text-sm font-semibold text-foreground">{b.name}</p>
              <p className="mb-3 text-xs text-foreground-subtle">{b.blurb}</p>
              <div className="flex flex-wrap gap-1.5">
                {b.items.map((it) => {
                  const on = selected.includes(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggle(it.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        on
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border text-foreground-muted hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Ranked priorities */}
        <div className="mt-5 rounded-xl border border-border bg-background-elevated/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              Ranked priorities
            </p>
            <span className="text-xs text-foreground-subtle">
              {selected.length} selected · order sets the weight
            </span>
          </div>

          {selected.length === 0 ? (
            <p className="text-sm text-foreground-subtle">
              Select levers above to rank them.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {selected.map((id, i) => (
                <li
                  key={id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {ALL_ITEMS[id].label}
                    </p>
                    <p className="text-[11px] text-foreground-subtle">
                      {ALL_ITEMS[id].bucket}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="rounded p-1 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === selected.length - 1}
                      className="rounded p-1 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className="rounded p-1 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Step 2 — free-text context */}
      <section>
        <StepHead
          n={2}
          title="Context"
          desc="Anything the agents should hold in mind — constraints, focus areas, sacred cows, what 'good' looks like here."
        />
        <textarea
          value={context}
          onChange={(e) => {
            setContext(e.target.value);
            touch();
          }}
          rows={5}
          placeholder="e.g. Protect the Alexandria relationship, they're strategic. Don't touch headcount in Ops. We care more about margin than top-line this year."
          className="w-full resize-y rounded-xl border border-border bg-background-elevated/60 p-3.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
        />
      </section>
    </div>
  );
}
