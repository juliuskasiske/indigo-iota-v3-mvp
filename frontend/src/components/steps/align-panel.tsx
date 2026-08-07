"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ArrowUp,
  ArrowDown,
  X,
  Loader2,
  Save,
  Sparkles,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import {
  api,
  ApiError,
  type ImpactMetric,
  type ImpactType,
  type Objective,
  type ObjectiveInput,
  type ReportingCadence,
  type TargetBasis,
} from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Objectives — the compass the whole diagnosis runs against. Three things get
// set here and they build on each other:
//
//   1. the value levers, ranked      — WHAT matters, in what order
//   2. the program                   — in what unit, against what number, by when
//   3. the one-sentence objective    — all of the above compressed by an agent
//
// That third one is not decoration: it becomes the root node of the hypothesis
// tree, so the user gets to read and correct the sentence the entire diagnosis
// hangs off before any agent time is spent building on it.

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

const DEFAULT_SELECTED = ["margin", "cost", "automation"];

const METRICS: { value: ImpactMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "ebit", label: "EBIT" },
  { value: "ebitda", label: "EBITDA" },
  { value: "gross_margin", label: "Gross margin" },
  { value: "cash", label: "Cash" },
  { value: "custom", label: "Custom…" },
];

const CADENCES: { value: ReportingCadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];

const TARGET_BASES: { value: TargetBasis; label: string; suffix: string }[] = [
  { value: "absolute", label: "Absolute", suffix: "total" },
  { value: "percent", label: "Percent", suffix: "%" },
  { value: "multiple", label: "Multiple", suffix: "×" },
];

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground " +
  "placeholder:text-foreground-subtle focus:border-accent focus:outline-none " +
  "focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** 6200000 → "€6.2M". Mirrors the server's formatter so the readback agrees. */
function money(amount: number | null, currency: string): string {
  if (amount === null || Number.isNaN(amount)) return "—";
  const symbol = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF " }[currency] ?? `${currency} `;
  const abs = Math.abs(amount);
  let body: string;
  if (abs >= 1e9) body = `${(amount / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) body = `${(amount / 1e6).toFixed(2)}M`;
  else if (abs >= 1e3) body = `${(amount / 1e3).toFixed(0)}k`;
  else body = `${amount.toFixed(0)}`;
  if (body.includes(".")) body = body.replace(/0+([A-Z]?)$/, "$1").replace(/\.([A-Z]?)$/, "$1");
  return `${symbol}${body}`;
}

function parseNum(s: string): number | null {
  const cleaned = s.replace(/[\s,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The absolute target, whatever basis it was entered in — the same arithmetic
 *  the server does, so the readback and the agents never disagree. */
function resolveTarget(
  baseline: number | null,
  basis: TargetBasis,
  target: number | null,
): number | null {
  if (target === null) return null;
  if (basis === "absolute") return target;
  if (baseline === null) return null;
  if (basis === "percent") return baseline * (1 + target / 100);
  return baseline * target;
}

function StepHead({ n, title, desc }: { n: number; title: string; desc: string }) {
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-foreground-subtle">{hint}</span>}
    </label>
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

  // Program. Numeric fields are held as STRINGS and parsed on save: a numeric
  // input bound to a number fights the user on partial entry ("1.") and on
  // locale separators.
  const [metric, setMetric] = useState<ImpactMetric>("revenue");
  const [metricLabel, setMetricLabel] = useState("");
  const [impactType, setImpactType] = useState<ImpactType>("recurring");
  const [currency, setCurrency] = useState("EUR");
  const [baseline, setBaseline] = useState("");
  const [basis, setBasis] = useState<TargetBasis>("absolute");
  const [target, setTarget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [runRateYear, setRunRateYear] = useState("");
  const [yearTouched, setYearTouched] = useState(false);
  const [cadence, setCadence] = useState<ReportingCadence>("monthly");

  const [headline, setHeadline] = useState("");
  const [headlineStale, setHeadlineStale] = useState(false);
  const [editingHeadline, setEditingHeadline] = useState(false);
  const [headlineDraft, setHeadlineDraft] = useState("");
  const [generating, setGenerating] = useState(false);

  const [canEdit, setCanEdit] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touch = () => {
    setDirty(true);
    setSavedAt(false);
  };

  // Only a 401 means the session died. A 403 is a permissions ANSWER — treating
  // it as a dead session logs the user out for asking a legitimate question.
  const handleError = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) {
        onAuthError?.(e);
        return;
      }
      setError(e instanceof Error ? e.message : fallback);
    },
    [onAuthError],
  );

  const applyObjective = useCallback((obj: Objective) => {
    const ranked = [...obj.priorities]
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.id)
      .filter((id) => id in ALL_ITEMS);
    if (ranked.length) setSelected(ranked);
    setContext(obj.context ?? "");
    setMetric(obj.impact_metric ?? "revenue");
    setMetricLabel(obj.impact_metric_label ?? "");
    setImpactType(obj.impact_type ?? "recurring");
    setCurrency(obj.currency ?? "EUR");
    setBaseline(obj.baseline_amount === null ? "" : String(obj.baseline_amount));
    setBasis(obj.target_basis ?? "absolute");
    setTarget(obj.target_amount === null ? "" : String(obj.target_amount));
    setStartDate(obj.program_start_date ?? "");
    setEndDate(obj.program_end_date ?? "");
    setRunRateYear(obj.run_rate_year === null ? "" : String(obj.run_rate_year));
    setCadence(obj.reporting_cadence ?? "monthly");
    setHeadline(obj.headline ?? "");
    setHeadlineStale(obj.headline_stale);
    setCanEdit(obj.can_edit);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const obj = await api.objective();
        if (alive) applyObjective(obj);
      } catch (e) {
        if (alive) handleError(e, "Could not load the objective.");
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyObjective, handleError]);

  // The run-rate year follows the deadline unless the user overrode it.
  //
  // Sliced from the string, NOT via new Date(): "2027-12-31" parses as UTC
  // midnight and reports 2026 in any negative-offset timezone.
  const derivedYear = endDate.length >= 4 ? endDate.slice(0, 4) : "";
  useEffect(() => {
    if (!yearTouched && derivedYear) setRunRateYear(derivedYear);
  }, [derivedYear, yearTouched]);

  const baselineNum = parseNum(baseline);
  const targetNum = parseNum(target);
  const resolved = resolveTarget(baselineNum, basis, targetNum);
  const metricName =
    metric === "custom" ? metricLabel.trim() || "impact" : METRICS.find((m) => m.value === metric)?.label.toLowerCase() ?? "impact";

  // A deterministic restatement of the fields — no model involved — so the form
  // stays legible while it is being filled in.
  const readback = useMemo(() => {
    if (resolved === null) return `Improve ${metricName}.`;
    const from = baselineNum !== null ? ` from ${money(baselineNum, currency)}` : "";
    const kind = impactType === "recurring" ? "recurring run-rate" : "one-time";
    const when = runRateYear ? ` by FY${runRateYear}` : "";
    return `Grow ${metricName}${from} to ${money(resolved, currency)} as a ${kind} impact${when}, reviewed ${cadence}.`;
  }, [resolved, metricName, baselineNum, currency, impactType, runRateYear, cadence]);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
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

  const buildBody = useCallback(
    (overrides: Partial<ObjectiveInput> = {}): ObjectiveInput => ({
      priorities: selected.map((id, i) => ({
        id,
        label: ALL_ITEMS[id].label,
        bucket: ALL_ITEMS[id].bucket,
        rank: i,
      })),
      context,
      impact_metric: metric,
      impact_metric_label: metricLabel,
      impact_type: impactType,
      currency,
      baseline_amount: baselineNum,
      target_basis: basis,
      target_amount: targetNum,
      program_start_date: startDate || null,
      program_end_date: endDate || null,
      run_rate_year: runRateYear ? Number(runRateYear) : null,
      reporting_cadence: cadence,
      ...overrides,
    }),
    [
      selected, context, metric, metricLabel, impactType, currency, baselineNum,
      basis, targetNum, startDate, endDate, runRateYear, cadence,
    ],
  );

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      applyObjective(await api.saveObjective(buildBody()));
      setDirty(false);
      setSavedAt(true);
    } catch (e) {
      handleError(e, "Could not save the objective.");
    } finally {
      setSaving(false);
    }
  }, [saving, buildBody, applyObjective, handleError]);

  const regenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const obj = await api.generateHeadline();
      applyObjective(obj);
      if (obj.headline_error) setError(obj.headline_error);
    } catch (e) {
      handleError(e, "Could not write the objective sentence.");
    } finally {
      setGenerating(false);
    }
  }, [generating, applyObjective, handleError]);

  const saveHeadline = useCallback(async () => {
    setSaving(true);
    try {
      applyObjective(await api.saveObjective(buildBody({ headline: headlineDraft })));
      setEditingHeadline(false);
    } catch (e) {
      handleError(e, "Could not save the sentence.");
    } finally {
      setSaving(false);
    }
  }, [buildBody, headlineDraft, applyObjective, handleError]);

  const ro = !canEdit;

  return (
    <div className="space-y-10">
      {/* Save bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <p className="text-sm text-foreground-muted">
          {ro
            ? "Only workspace admins can change the objective."
            : "This is the compass the agent swarm optimizes for. Save to apply it to the next run."}
        </p>
        {!ro && (
          <div className="flex items-center gap-3">
            {savedAt && !dirty && (
              <span className="text-xs text-success">Saved</span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !loaded || !dirty}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save objective"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* The one-sentence objective — the root of the hypothesis tree. */}
      <section>
        <div
          className={cn(
            "rounded-xl border bg-background-elevated/60 p-5",
            headlineStale ? "border-warning/50" : "border-border",
          )}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-accent">
              The objective, in one sentence
            </p>
            {!ro && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setHeadlineDraft(headline);
                    setEditingHeadline(true);
                  }}
                  disabled={editingHeadline}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generating ? "Writing…" : "Regenerate"}
                </button>
              </div>
            )}
          </div>

          {editingHeadline ? (
            <div className="space-y-2">
              <textarea
                value={headlineDraft}
                onChange={(e) => setHeadlineDraft(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-input p-3 text-sm text-foreground focus:border-accent focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveHeadline}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
                >
                  Save sentence
                </button>
                <button
                  type="button"
                  onClick={() => setEditingHeadline(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : headline ? (
            <blockquote className="border-l-2 border-accent pl-4 font-serif text-lg italic leading-snug text-foreground">
              {headline}
            </blockquote>
          ) : (
            <p className="text-sm text-foreground-subtle">
              Not written yet. Fill in the program below and hit Regenerate — this
              sentence becomes the root of the hypothesis tree.
            </p>
          )}

          {headlineStale && !editingHeadline && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              The objective changed after this sentence was written.
            </p>
          )}
        </div>
      </section>

      {/* Step 1 — the value levers */}
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
                      disabled={ro}
                      onClick={() => toggle(it.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60",
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

        <div className="mt-5 rounded-xl border border-border bg-background-elevated/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Ranked priorities</p>
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
                    <p className="truncate text-sm text-foreground">{ALL_ITEMS[id].label}</p>
                    <p className="text-[11px] text-foreground-subtle">{ALL_ITEMS[id].bucket}</p>
                  </div>
                  {!ro && (
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
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Step 2 — the program: unit, size, horizon, cadence */}
      <section>
        <StepHead
          n={2}
          title="Program"
          desc="What the impact is measured in, how big it has to be, and by when. This is what lets the agents size every initiative in the same unit and judge whether it can land inside the window."
        />

        <div className="rounded-xl border border-border bg-background-elevated/60 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Impact metric">
              <Select
                value={metric}
                disabled={ro}
                onValueChange={(v) => {
                  setMetric(v as ImpactMetric);
                  touch();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Impact type"
              hint={
                impactType === "recurring"
                  ? "A sustained annual level the business keeps earning."
                  : "A one-off gain that does not repeat next year."
              }
            >
              <div className="flex gap-1.5">
                {(["recurring", "one_time"] as ImpactType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={ro}
                    onClick={() => {
                      setImpactType(t);
                      touch();
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-60",
                      impactType === t
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-foreground-muted hover:border-foreground/30",
                    )}
                  >
                    {t === "recurring" ? "Recurring run-rate" : "One-time"}
                  </button>
                ))}
              </div>
            </Field>

            {metric === "custom" && (
              <Field label="Metric name">
                <input
                  className={INPUT_CLASS}
                  disabled={ro}
                  value={metricLabel}
                  placeholder="e.g. contribution margin"
                  onChange={(e) => {
                    setMetricLabel(e.target.value);
                    touch();
                  }}
                />
              </Field>
            )}

            <Field label="Baseline today" hint="Where the metric stands now.">
              <div className="flex gap-2">
                <input
                  className={INPUT_CLASS}
                  disabled={ro}
                  inputMode="decimal"
                  value={baseline}
                  placeholder="6200000"
                  onChange={(e) => {
                    setBaseline(e.target.value);
                    touch();
                  }}
                />
                <Select
                  value={currency}
                  disabled={ro}
                  onValueChange={(v) => {
                    setCurrency(v);
                    touch();
                  }}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>

            <Field
              label="Target"
              hint={
                basis === "absolute"
                  ? "The number the metric must reach."
                  : basis === "percent"
                    ? "An uplift on the baseline."
                    : "A factor of the baseline — 2 means double."
              }
            >
              <div className="flex gap-2">
                <Select
                  value={basis}
                  disabled={ro}
                  onValueChange={(v) => {
                    setBasis(v as TargetBasis);
                    touch();
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_BASES.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  className={INPUT_CLASS}
                  disabled={ro}
                  inputMode="decimal"
                  value={target}
                  placeholder={basis === "multiple" ? "2" : basis === "percent" ? "25" : "12400000"}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    touch();
                  }}
                />
              </div>
            </Field>

            <Field label="Program start">
              <input
                type="date"
                className={INPUT_CLASS}
                disabled={ro}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  touch();
                }}
              />
            </Field>

            <Field label="Program end" hint="The deadline the run-rate must be achieved by.">
              <input
                type="date"
                className={INPUT_CLASS}
                disabled={ro}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  touch();
                }}
              />
            </Field>

            <Field
              label="Run-rate year"
              hint={
                yearTouched && derivedYear && runRateYear !== derivedYear
                  ? `Overridden — the end date implies FY${derivedYear}.`
                  : "The fiscal year the impact is measured in."
              }
            >
              <input
                className={INPUT_CLASS}
                disabled={ro}
                inputMode="numeric"
                value={runRateYear}
                placeholder="2027"
                onChange={(e) => {
                  setRunRateYear(e.target.value);
                  setYearTouched(true);
                  touch();
                }}
              />
            </Field>

            <Field label="Reporting cadence" hint="How often impact is measured and reviewed.">
              <Select
                value={cadence}
                disabled={ro}
                onValueChange={(v) => {
                  setCadence(v as ReportingCadence);
                  touch();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background/60 px-3.5 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">
              What you&apos;ve defined
            </p>
            <p className="mt-1 text-sm text-foreground-muted">{readback}</p>
          </div>
        </div>
      </section>

      {/* Step 3 — free-text context */}
      <section>
        <StepHead
          n={3}
          title="Context"
          desc="Anything the agents should hold in mind — constraints, focus areas, sacred cows, what 'good' looks like here."
        />
        <textarea
          value={context}
          disabled={ro}
          onChange={(e) => {
            setContext(e.target.value);
            touch();
          }}
          rows={5}
          placeholder="e.g. Protect the Alexandria relationship, they're strategic. Don't touch headcount in Ops. We care more about margin than top-line this year."
          className="w-full resize-y rounded-xl border border-border bg-background-elevated/60 p-3.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none disabled:opacity-60"
        />
      </section>
    </div>
  );
}
