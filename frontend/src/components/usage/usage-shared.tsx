"use client";

// Shared building blocks for the Ingestion-vs-Q&A usage analytics view (the
// approved "Option B": range picker + Day/Week + $/Tokens, three stat cards, a
// comparison line chart, and a per-row breakdown table). Used by both the
// Admin Center (customer dollars) and the Control Tower (raw cost) panels.

import type { UsageTimeseriesPoint } from "@/lib/api";

// --- range / metric / granularity vocabulary --------------------------------

export type Metric = "$" | "tok";
export type Granularity = "day" | "week";

export interface RangePreset {
  id: string;
  label: string;
  days: number;
}

export const PRESETS: RangePreset[] = [
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "12mo", label: "Last 12 months", days: 365 },
];

export const DEFAULT_PRESET = "30d";

export function presetById(id: string): RangePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[1];
}

// --- formatting -------------------------------------------------------------

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(iso: string): string {
  // iso = "YYYY-MM-DD"; render as "7 May" (no zero-pad).
  const [y, m, d] = iso.split("-").map(Number);
  void y;
  return `${d} ${MON[(m || 1) - 1]}`;
}

const money0 = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const money2 = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Tokens are ALWAYS expressed in millions — never K.
const tokTop = (v: number) => Math.round(v / 1e6).toLocaleString("en-US") + "M tok";
const tokDet = (v: number) => (v / 1e6).toFixed(1) + "M tok";
const tokAxis = (v: number) => (v <= 0 ? "0" : (v / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M");
// Dollar axis labels adapt precision to magnitude — sub-dollar daily spend must
// NOT collapse to "$1, $1, $0"; large values stay grouped (e.g. "$1,200"), never K.
const moneyAxis = (v: number) => {
  if (v <= 0) return "$0";
  if (v < 1) return "$" + v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (v < 100) return "$" + (Math.round(v * 10) / 10).toString();
  return "$" + Math.round(v).toLocaleString("en-US");
};

/** Big aggregate numbers (stat cards): $X (no decimals) / XM tok. */
export const fmtTop = (v: number, m: Metric) => (m === "$" ? money0(v) : tokTop(v));
/** Detail rows (per-member / per-workspace): $X.XX / X.XM tok. */
export const fmtVal = (v: number, m: Metric) => (m === "$" ? money2(v) : tokDet(v));
/** Chart Y-axis ticks. */
export const axisFmt = (v: number, m: Metric) => (m === "$" ? moneyAxis(v) : tokAxis(v));

/** A "nice" axis step (1·2·2.5·5 × 10^k) so ticks land on round values
 *  regardless of the metric's magnitude (cents, dollars, or millions of tokens). */
function niceStep(rawMax: number, targetTicks: number): number {
  const rough = (rawMax > 0 ? rawMax : 1) / targetTicks;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const f = rough / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * base;
}

// --- bucketing --------------------------------------------------------------

export interface Bucketed {
  labels: string[];
  /** Ingestion series (amber). */
  A: number[];
  /** Q&A series (accent). */
  B: number[];
}

function pick(p: UsageTimeseriesPoint, m: Metric, kind: "ing" | "qa"): number {
  if (m === "$") return Number(kind === "ing" ? p.ingestion_cost : p.qa_cost);
  return kind === "ing" ? p.ingestion_tokens : p.qa_tokens;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** Re-bucket the daily series into the chosen granularity (day = raw, week =
 *  consecutive 7-day sums) for the chosen metric. */
export function bucketize(series: UsageTimeseriesPoint[], g: Granularity, m: Metric): Bucketed {
  const ing = series.map((p) => pick(p, m, "ing"));
  const qa = series.map((p) => pick(p, m, "qa"));
  if (g === "day") {
    return { labels: series.map((p) => dayLabel(p.period_start)), A: ing, B: qa };
  }
  const labels: string[] = [];
  const A: number[] = [];
  const B: number[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const j = Math.min(i + 7, series.length);
    labels.push(dayLabel(series[i].period_start));
    A.push(sum(ing.slice(i, j)));
    B.push(sum(qa.slice(i, j)));
  }
  return { labels, A, B };
}

/** Period totals (over the full window) for the chosen metric. */
export function totalsOf(series: UsageTimeseriesPoint[], m: Metric) {
  const ing = sum(series.map((p) => pick(p, m, "ing")));
  const qa = sum(series.map((p) => pick(p, m, "qa")));
  return { ing, qa, tot: ing + qa };
}

/** Human "7 Apr – 7 May 2026" from the series endpoints. */
export function rangeText(series: UsageTimeseriesPoint[]): string {
  if (series.length === 0) return "";
  const first = series[0].period_start;
  const last = series[series.length - 1].period_start;
  const year = last.split("-")[0];
  return `${dayLabel(first)} – ${dayLabel(last)} ${year}`;
}

// --- controls ---------------------------------------------------------------

export function UsageControls({
  preset,
  granularity,
  metric,
  onPreset,
  onGranularity,
  onMetric,
}: {
  preset: string;
  granularity: Granularity;
  metric: Metric;
  onPreset: (id: string) => void;
  onGranularity: (g: Granularity) => void;
  onMetric: (m: Metric) => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <div className="relative inline-flex">
        <select
          value={preset}
          onChange={(e) => onPreset(e.target.value)}
          className="cursor-pointer appearance-none rounded-[9px] bg-background-soft px-3 py-[7px] pr-7 text-xs font-medium leading-none text-foreground"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-foreground-subtle">
          ▾
        </span>
      </div>
      <Seg
        value={granularity}
        options={[
          ["day", "Day"],
          ["week", "Week"],
        ]}
        onChange={(v) => onGranularity(v as Granularity)}
      />
      <Seg
        value={metric}
        options={[
          ["$", "$"],
          ["tok", "Tokens"],
        ]}
        onChange={(v) => onMetric(v as Metric)}
      />
    </div>
  );
}

function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[9px] bg-background-soft p-[3px]">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={
            "w-[58px] rounded-[7px] py-[5px] text-center text-xs font-medium leading-none transition-all " +
            (v === value
              ? "bg-background-elevated text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.10)]"
              : "text-foreground-subtle")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// --- stat cards -------------------------------------------------------------

export function StatCards({
  metric,
  totals,
  range,
}: {
  metric: Metric;
  totals: { ing: number; qa: number; tot: number };
  range: string;
}) {
  const pi = totals.tot > 0 ? (totals.ing / totals.tot) * 100 : 0;
  const pq = totals.tot > 0 ? (totals.qa / totals.tot) * 100 : 0;
  return (
    <div className="my-[18px] grid grid-cols-3 gap-3">
      <div className="rounded-xl border border-border px-[15px] py-[13px]">
        <div className="flex items-center text-[11.5px] text-foreground-subtle">Total spend</div>
        <div className="mt-[7px] text-[22px] font-[660] tracking-[-0.01em] tabular-nums">
          {fmtTop(totals.tot, metric)}
        </div>
        <div className="mt-[3px] text-[11px] text-foreground-subtle">{range}</div>
      </div>
      <div className="rounded-xl border border-border px-[15px] py-[13px]">
        <div className="flex items-center text-[11.5px] text-foreground-subtle">
          <span className="mr-[7px] inline-block h-2 w-2 rounded-full bg-amber-500" />
          Ingestion · automated
        </div>
        <div className="mt-[7px] text-[22px] font-[660] tracking-[-0.01em] tabular-nums">
          {fmtTop(totals.ing, metric)}
        </div>
        <div className="mt-[3px] text-[11px] text-foreground-subtle">{pi.toFixed(0)}% of spend</div>
      </div>
      <div className="rounded-xl border border-accent/15 bg-gradient-to-b from-accent/[0.04] to-transparent px-[15px] py-[13px]">
        <div className="flex items-center text-[11.5px] text-foreground-subtle">
          <span className="mr-[7px] inline-block h-2 w-2 rounded-full bg-accent" />
          Q&amp;A · interactive
        </div>
        <div className="mt-[7px] text-[22px] font-[660] tracking-[-0.01em] tabular-nums">
          {fmtTop(totals.qa, metric)}
        </div>
        <div className="mt-[3px] text-[11px] text-foreground-subtle">{pq.toFixed(0)}% of spend</div>
      </div>
    </div>
  );
}

// --- chart ------------------------------------------------------------------

const AMBER = "#f59e0b"; // amber-500 — Ingestion
const ACCENT = "hsl(var(--accent))"; // Q&A
const LINE = "hsl(var(--border))";
const SUBTLE = "hsl(var(--foreground-subtle))";

export function UsageChart({ data, metric }: { data: Bucketed; metric: Metric }) {
  const { A, B, labels } = data;
  const n = labels.length;
  const W = 900;
  const H = 250;
  const L = 54;
  const R = 14;
  const T = 14;
  const Bm = 26;
  const x0 = L;
  const x1 = W - R;
  const y0 = T;
  const y1 = H - Bm;
  void y0;
  const pw = x1 - x0;
  const ph = y1 - y0;
  // Round the axis to nice ticks instead of a flat ×1.18 headroom, so the
  // labels read as round values at any scale (cents → millions of tokens).
  const rawMax = Math.max(0, ...A, ...B);
  const yStep = niceStep(rawMax || 1, 4);
  let ticks = Math.max(1, Math.ceil((rawMax || 1) / yStep));
  if (ticks * yStep <= rawMax + yStep * 1e-6) ticks += 1; // keep the peak off the top line
  const max = yStep * ticks;
  const X = (i: number) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * pw);
  const Y = (v: number) => y1 - (v / max) * ph;

  const gridlines = [];
  const yLabels = [];
  for (let t = 0; t <= ticks; t++) {
    const val = yStep * t;
    const y = Y(val);
    gridlines.push(
      <line key={`g${t}`} x1={x0} y1={y.toFixed(1)} x2={x1} y2={y.toFixed(1)} stroke={LINE} strokeWidth={1} />,
    );
    yLabels.push(
      <text key={`y${t}`} x={x0 - 10} y={(y + 3.5).toFixed(1)} textAnchor="end" fontSize={10.5} fill={SUBTLE}>
        {axisFmt(val, metric)}
      </text>,
    );
  }

  const step = Math.max(1, Math.ceil(n / 7));
  const xLabels = labels
    .map((lb, i) =>
      i % step === 0 || i === n - 1 ? (
        <text key={`x${i}`} x={X(i).toFixed(1)} y={H - 8} textAnchor="middle" fontSize={10.5} fill={SUBTLE}>
          {lb}
        </text>
      ) : null,
    )
    .filter(Boolean);

  const linePath = (S: number[]) =>
    S.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const areaPath = (S: number[]) =>
    `M${X(0).toFixed(1)},${y1} ` +
    S.map((v, i) => `L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ") +
    ` L${X(n - 1).toFixed(1)},${y1} Z`;

  return (
    <div className="mt-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-auto w-full">
        <defs>
          <linearGradient id="usage-gi" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={AMBER} stopOpacity="0.18" />
            <stop offset="1" stopColor={AMBER} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="usage-gq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ACCENT} stopOpacity="0.18" />
            <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridlines}
        {yLabels}
        {xLabels}
        {n > 0 && (
          <>
            <path d={areaPath(A)} fill="url(#usage-gi)" />
            <path d={areaPath(B)} fill="url(#usage-gq)" />
            <path d={linePath(A)} fill="none" stroke={AMBER} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath(B)} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={X(n - 1).toFixed(1)} cy={Y(A[n - 1]).toFixed(1)} r={3.2} fill={AMBER} />
            <circle cx={X(n - 1).toFixed(1)} cy={Y(B[n - 1]).toFixed(1)} r={3.2} fill={ACCENT} />
          </>
        )}
      </svg>
    </div>
  );
}

// --- split bar (mix) for table rows -----------------------------------------

export function SplitBar({ ing, qa, max }: { ing: number; qa: number; max: number }) {
  const iw = max > 0 ? (ing / max) * 100 : 0;
  const qw = max > 0 ? (qa / max) * 100 : 0;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-border/30">
      <div className="bg-amber-500/85" style={{ width: `${iw.toFixed(1)}%` }} />
      <div className="bg-accent/85" style={{ width: `${qw.toFixed(1)}%` }} />
    </div>
  );
}
