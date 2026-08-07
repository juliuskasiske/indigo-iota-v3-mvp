"use client";

import { useEffect, useState } from "react";
import { Brain, FileText, Users, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, type Usage, type ScopeTree } from "@/lib/api";

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function UsagePanel({
  onAuthError,
  embedded,
}: {
  onAuthError: (e: ApiError) => void;
  embedded?: boolean;
}) {
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.usage());
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load activity.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = (
    <div className="space-y-4 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : data ? (
          <>
            <p className="text-xs text-foreground-subtle">
              What your workspace brain has read and built so far.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={FileText} label="Documents analyzed" value={fmtInt(data.files_analyzed)} />
              <Metric icon={Users} label="People & companies mapped" value={fmtInt(data.entities_mapped)} />
              <Metric
                icon={MessageSquare}
                label="Questions answered"
                value={fmtInt(data.questions_answered)}
              />
            </div>

            <EmailProcessing
              inScope={data.emails_analyzed}
              processed={data.emails_processed}
            />

            <div className="border-t border-border/40 pt-4 space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-accent">
                  How email is sorted
                </p>
                <p className="text-xs leading-relaxed text-foreground-subtle">
                  Every email is voted on twice. Step 1 sorts it into one of four
                  buckets; only <span className="text-success">in scope</span> mail
                  goes on to Step 2, the <span className="text-destructive">red zone</span>{" "}
                  runoff. Only emails voted in scope twice are analyzed and stored in
                  your workspace&apos;s brains.
                </p>
              </div>
              <ScopeDecisionTree
                tree={data.scope_tree}
                processed={data.emails_processed}
              />
            </div>
          </>
        ) : (
          <p className="text-destructive">{error ?? "Could not load activity."}</p>
        )}
    </div>
  );
  if (embedded) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          Brain activity
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

// Its own section so it isn't crammed in with the other counters: of the
// in-scope emails (captured the moment they pass the gate), how many the
// comprehend step has actually turned into brain content.
function EmailProcessing({
  inScope,
  processed,
}: {
  inScope: number;
  processed: number;
}) {
  const pct = inScope > 0 ? Math.round((processed / inScope) * 100) : 0;
  const pending = Math.max(0, inScope - processed);
  return (
    <div className="space-y-2.5 border-t border-border/40 pt-4">
      <p className="text-xs text-accent">
        Email processing
      </p>
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          <span className="text-2xl font-semibold text-foreground">
            {fmtInt(processed)}
          </span>{" "}
          of {fmtInt(inScope)} in-scope emails comprehended into the brain
        </p>
        <span className="shrink-0 text-xs tabular-nums text-foreground-subtle">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-soft">
        <div
          className="h-full rounded-full bg-success transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        {pending > 0
          ? `${fmtInt(pending)} captured and queued for the next sync cycle.`
          : "Caught up — all captured email has been comprehended."}
      </p>
    </div>
  );
}

type NodeKind = "in_scope" | "redzone" | "neutral" | "root";

function colorFor(kind: NodeKind): string {
  switch (kind) {
    case "in_scope":
      return "var(--color-success)";
    case "redzone":
      return "var(--color-destructive)";
    case "root":
      return "var(--color-foreground)";
    default:
      return "var(--color-foreground-subtle)";
  }
}

// Smooth left-to-right connector between the right edge of a parent box and
// the left edge of a child box.
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function TreeNode({
  x,
  cy,
  w,
  label,
  count,
  kind,
}: {
  x: number;
  cy: number;
  w: number;
  label: string;
  count: number;
  kind: NodeKind;
}) {
  const h = 36;
  const y = cy - h / 2;
  const color = colorFor(kind);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill="var(--color-background-soft)"
        stroke="var(--color-border-strong)"
        strokeWidth={1}
      />
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={color} />
      <text
        x={x + 11}
        y={cy - 3}
        fontSize={8.5}
        fill="var(--color-foreground-muted)"
      >
        {label}
      </text>
      <text
        x={x + 11}
        y={cy + 12}
        fontSize={13}
        fontWeight={600}
        fill={color}
      >
        {fmtInt(count)}
      </text>
    </g>
  );
}

function ScopeDecisionTree({
  tree,
  processed,
}: {
  tree: ScopeTree;
  processed: number;
}) {
  const l1 = tree.layer1;
  const l2 = tree.layer2;
  const total = l1.in_scope + l1.redzone + l1.spam + l1.out_of_scope;

  // Layout in SVG user units; the viewBox makes the whole thing scale to fit.
  const boxW = 122;
  const rootX = 8;
  const col1X = 168;
  const col2X = 330;
  const col3X = 496; // the "Processed into brain" leaf off Layer-2 in-scope
  const rootCy = 100;

  const layer1 = [
    { key: "in_scope", label: "In scope", count: l1.in_scope, kind: "in_scope" as NodeKind, cy: 28 },
    { key: "redzone", label: "Red zone", count: l1.redzone, kind: "redzone" as NodeKind, cy: 76 },
    { key: "spam", label: "Spam", count: l1.spam, kind: "neutral" as NodeKind, cy: 124 },
    { key: "out_of_scope", label: "Out of scope", count: l1.out_of_scope, kind: "neutral" as NodeKind, cy: 172 },
  ];
  const layer2 = [
    { key: "in_scope", label: "In scope", count: l2.in_scope, kind: "in_scope" as NodeKind, cy: 28 },
    { key: "redzone", label: "Red zone", count: l2.redzone, kind: "redzone" as NodeKind, cy: 76 },
  ];

  const rootW = 96;
  const rootRightEdge = rootX + rootW;
  const col1RightEdge = col1X + boxW;
  const col2RightEdge = col2X + boxW;

  return (
    <svg
      viewBox="0 0 626 204"
      className="w-full h-auto"
      role="img"
      aria-label="Decision tree of how emails are sorted by the scope gate, then comprehended into the brain"
    >
      {/* Root -> each Layer 1 bucket */}
      {layer1.map((n) => (
        <path
          key={`e1-${n.key}`}
          d={edgePath(rootRightEdge, rootCy, col1X, n.cy)}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={1.25}
        />
      ))}
      {/* Layer 1 in_scope -> each Layer 2 leaf */}
      {layer2.map((n) => (
        <path
          key={`e2-${n.key}`}
          d={edgePath(col1RightEdge, 28, col2X, n.cy)}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={1.25}
        />
      ))}
      {/* Layer 2 in_scope -> Processed into brain */}
      <path
        d={edgePath(col2RightEdge, 28, col3X, 28)}
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth={1.25}
      />

      <TreeNode
        x={rootX}
        cy={rootCy}
        w={rootW}
        label="All email"
        count={total}
        kind="root"
      />
      {layer1.map((n) => (
        <TreeNode
          key={`n1-${n.key}`}
          x={col1X}
          cy={n.cy}
          w={boxW}
          label={n.label}
          count={n.count}
          kind={n.kind}
        />
      ))}
      {layer2.map((n) => (
        <TreeNode
          key={`n2-${n.key}`}
          x={col2X}
          cy={n.cy}
          w={boxW}
          label={n.label}
          count={n.count}
          kind={n.kind}
        />
      ))}
      <TreeNode
        x={col3X}
        cy={28}
        w={boxW}
        label="Processed"
        count={processed}
        kind="in_scope"
      />
    </svg>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-soft/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
