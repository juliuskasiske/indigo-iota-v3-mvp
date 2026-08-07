"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Plus,
  Minus,
  Loader2,
  FileText,
  Mail,
  Target,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Trash2,
} from "lucide-react";
import type { TreeNode, TreeObjective } from "@/lib/api";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { clamp, layoutTree, type LaidNode } from "./tree-layout";

// The hypothesis board: the tree as boxes and arrows on a pannable canvas
// rather than an indented list, because the SHAPE of the decomposition is the
// argument. Hovering a node lights its whole path back to the objective, which
// is what makes the tree read as reasoning instead of decoration.

interface View {
  x: number;
  y: number;
  k: number;
}

// Module-scoped so pan/zoom survives the Radix TabsContent unmount when you
// switch tabs and come back. Keyed by run so a NEW run starts fit-to-view.
const viewMemory = new Map<string, View>();

const MIN_K = 0.3;
const MAX_K = 1.8;

function statusColor(status: string): string {
  switch (status) {
    case "supported":
      return "var(--color-success)";
    case "needs_evidence":
      return "var(--color-warning)";
    case "discarded":
      return "var(--color-foreground-subtle)";
    default:
      return "var(--color-accent)";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "supported":
      return "supported";
    case "needs_evidence":
      return "needs evidence";
    case "discarded":
      return "discarded";
    default:
      return "investigating";
  }
}

function money(amount: number | null, currency: string): string {
  if (amount === null) return "";
  const symbol = { EUR: "€", USD: "$", GBP: "£" }[currency] ?? `${currency} `;
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${symbol}${(amount / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${symbol}${(amount / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${symbol}${Math.round(amount / 1e3)}k`;
  return `${symbol}${Math.round(amount)}`;
}

function valueBadge(node: TreeNode): string {
  const card = node.card;
  if (!card?.value_amount) return "";
  const amount = money(card.value_amount, card.value_currency);
  const kind = card.value_type === "one_time" ? "one-time" : "recurring";
  const year = card.value_year ? `, FY${card.value_year}` : "";
  return `${amount} ${kind}${year}`;
}

function sourceIcon(source: string | null) {
  const s = (source ?? "").toLowerCase();
  if (s.includes("email") || s.includes("mail")) return Mail;
  return FileText;
}

/** One box on the board. */
function NodeBox({
  item,
  lit,
  selected,
  onHover,
  onSelect,
}: {
  item: LaidNode;
  lit: boolean;
  selected: boolean;
  onHover: (id: number | null) => void;
  onSelect: (item: LaidNode) => void;
}) {
  const n = item.node;
  const dim = !lit;
  const color = statusColor(n.status);
  const badge = valueBadge(n);

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(item)}
      style={{ left: item.x - item.w / 2, top: item.y, width: item.w, height: item.h }}
      className={cn(
        "absolute flex flex-col justify-center gap-1.5 overflow-hidden rounded-xl border p-3.5 text-left",
        "transition-[transform,box-shadow,opacity,border-color] duration-150 ease-out",
        "hover:z-10 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-y-0",
        n.kind === "objective"
          ? "border-2 border-accent bg-background-elevated shadow-md shadow-accent/10"
          : n.kind === "branch"
            ? "border-border-strong bg-background-elevated"
            : "border-border bg-background-soft",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-background",
        lit && !selected && n.kind !== "objective" && "border-accent",
        // A rejected node stays on the board — the reasoning is part of the
        // record — but must never be mistaken for live work.
        n.status === "discarded" && "opacity-50 line-through decoration-foreground-subtle",
        dim && "opacity-35 saturate-50",
      )}
    >
      {/* Status band across the top — the edge the incoming arrow lands on.
          A left spine would read as a bulleted list once siblings sit in a row. */}
      {n.kind !== "objective" && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px] rounded-t-xl"
          style={{ background: color }}
        />
      )}

      {n.kind === "objective" ? (
        <>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-accent">
            Objective
          </span>
          <span className="shrink-0 line-clamp-3 font-serif text-[15px] italic leading-snug text-foreground">
            {n.label}
          </span>
        </>
      ) : n.kind === "branch" ? (
        <>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
            Branch
          </span>
          <span className="shrink-0 line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">
            {n.label}
          </span>
          {n.evidence.length > 0 && (
            <span className="shrink-0 text-[11px] text-foreground-subtle">
              {n.evidence.length} {n.evidence.length === 1 ? "fact" : "facts"}
            </span>
          )}
        </>
      ) : (
        <>
          {/* No context preview here — at the zoom this board opens at, a third
              line of small text is noise. It is the first thing in the drawer. */}
          <span className="shrink-0 line-clamp-3 text-[13px] font-semibold leading-snug text-foreground">
            {n.label}
          </span>
          <span className="mt-0.5 flex shrink-0 flex-wrap items-center gap-1.5">
            {badge && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
              >
                {badge}
              </span>
            )}
            <span className="text-[11px]" style={{ color }}>
              {statusLabel(n.status)}
            </span>
          </span>
        </>
      )}
    </button>
  );
}

/** Discard or steer a node. Both send the agents back to redo this part of the
 *  tree, so both demand a sentence: an unexplained rejection tells them nothing. */
function ReviewActions({
  node,
  onSubmit,
}: {
  node: TreeNode;
  onSubmit: (kind: "discard" | "feedback", comment: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"discard" | "feedback" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = node.interventions.some((i) => i.status === "pending");
  const isRoot = node.kind === "objective";
  const gone = node.status === "discarded";

  if (gone) {
    return (
      <div className="rounded-lg border border-border bg-background/60 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
          Discarded
        </p>
        {node.discard_reason && (
          <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
            {node.discard_reason}
          </p>
        )}
      </div>
    );
  }

  if (pending) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 text-sm text-accent">
        <Loader2 className="h-4 w-4 animate-spin" />
        The agents are redoing this part of the tree.
      </p>
    );
  }

  const submit = async () => {
    if (!mode || !comment.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(mode, comment.trim());
      setMode(null);
      setComment("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("feedback")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-accent hover:text-accent"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Give feedback
          </button>
          {!isRoot && (
            <button
              type="button"
              onClick={() => setMode("discard")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Discard
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-[11px] text-foreground-subtle">
            {mode === "discard"
              ? node.kind === "initiative"
                ? "This initiative is dropped and replaced. Say why, so the replacement doesn't repeat it."
                : "This branch and everything under it are dropped and replaced. Say why, so the replacement doesn't repeat it."
              : "This node and everything under it are rebuilt with your note in hand."}
          </p>
          <textarea
            autoFocus
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              mode === "discard"
                ? "e.g. We tried this last year and it didn't stick — the constraint is capacity, not the target."
                : "e.g. Size this against the top 50 SKUs only, and assume we can't touch list price."
            }
            className="w-full resize-y rounded-lg border border-border bg-input p-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!comment.trim() || busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-50",
                mode === "discard" ? "bg-destructive" : "bg-accent",
              )}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === "discard" ? "Discard and replace" : "Send feedback"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setError(null);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground-muted"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The detail panel: branch reasoning, or the full initiative card. */
function NodeDetail({
  node,
  objective,
  onSubmit,
}: {
  node: TreeNode;
  objective: TreeObjective | null;
  onSubmit: (kind: "discard" | "feedback", comment: string) => Promise<void>;
}) {
  const card = node.card;
  const color = statusColor(node.status);

  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
          {node.kind === "objective" ? "Objective" : node.kind === "branch" ? "Branch" : "Initiative"}
        </p>
        <h3
          className={cn(
            "mt-1.5 leading-snug text-foreground",
            node.kind === "objective"
              ? "font-serif text-lg italic"
              : "text-base font-semibold",
          )}
        >
          {node.label}
        </h3>
        {node.kind !== "objective" && (
          <span
            className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
          >
            {statusLabel(node.status)}
            {card?.confidence ? `, ${card.confidence} confidence` : ""}
          </span>
        )}
      </div>

      {node.rationale && (
        <Section title={node.kind === "objective" ? "The program" : "Why this branch"}>
          <p className="text-sm leading-relaxed text-foreground-muted">{node.rationale}</p>
        </Section>
      )}

      {node.mece_note && (
        <Section title="Why these branches are exhaustive">
          <p className="text-sm leading-relaxed text-foreground-muted">{node.mece_note}</p>
        </Section>
      )}

      {card && (
        <>
          {card.value_amount !== null && (
            <Section title="What it could be worth">
              <p className="text-lg font-semibold text-foreground">{valueBadge(node)}</p>
              {card.value_basis && (
                <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
                  {card.value_basis}
                </p>
              )}
              {card.feasible_by_end !== null && objective?.program_end_date && (
                <p
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 text-xs",
                    card.feasible_by_end ? "text-success" : "text-warning",
                  )}
                >
                  {card.feasible_by_end ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  {card.feasible_by_end
                    ? `Can be at run-rate by ${objective.program_end_date}`
                    : `Unlikely to be at run-rate by ${objective.program_end_date}`}
                </p>
              )}
            </Section>
          )}

          {card.context && (
            <Section title="What this means">
              <p className="text-sm leading-relaxed text-foreground-muted">{card.context}</p>
            </Section>
          )}

          {card.sizing_approach && (
            <Section title="How it could be sized">
              <p className="text-sm leading-relaxed text-foreground-muted">
                {card.sizing_approach}
              </p>
            </Section>
          )}

          {card.what_must_be_true.length > 0 && (
            <Section title="What would need to be true">
              <ul className="space-y-2">
                {card.what_must_be_true.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {c}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {card.next_steps.length > 0 && (
            <Section title="Immediate next steps">
              <ol className="space-y-2">
                {card.next_steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground-muted">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/40 text-[10px] font-semibold text-accent">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </>
      )}

      {node.evidence.length > 0 && (
        <Section title={`Evidence (${node.evidence.length})`}>
          <div className="space-y-2">
            {node.evidence.map((e, i) => {
              const Icon = e.kind === "objective" ? Target : sourceIcon(e.source);
              return (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-background/60 px-3 py-2.5"
                >
                  <p className="text-[13px] leading-snug text-foreground-muted">{e.text}</p>
                  {e.source && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-background-soft px-2 py-0.5 text-[11px] text-foreground-subtle">
                      <Icon className="h-3 w-3" />
                      {e.source}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {node.kind === "initiative" && !card && (
        <p className="flex items-center gap-2 text-sm text-foreground-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          The agents are still working on this one.
        </p>
      )}

      {/* What a reviewer already said about this node, oldest first, so the
          current wording can be read against what caused it. */}
      {node.interventions.length > 0 && (
        <Section title="Review history">
          <ol className="space-y-2">
            {node.interventions.map((iv) => (
              <li
                key={iv.id}
                className="rounded-lg border border-border bg-background/60 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      iv.kind === "discard" ? "text-destructive" : "text-accent",
                    )}
                  >
                    {iv.kind === "discard" ? "Discarded" : "Feedback"}
                  </span>
                  <span className="text-[11px] text-foreground-subtle">
                    {iv.status === "pending"
                      ? "redoing…"
                      : iv.status === "failed"
                        ? `failed, ${iv.error}`
                        : "applied"}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-foreground-muted">
                  {iv.comment}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Review this node">
        <ReviewActions node={node} onSubmit={onSubmit} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function HypothesisCanvas({
  nodes,
  objective,
  runKey,
  onReview,
}: {
  nodes: TreeNode[];
  objective: TreeObjective | null;
  runKey: string;
  /** Discard or steer a node; resolves once the agents have been asked. */
  onReview: (nodeId: number, kind: "discard" | "feedback", comment: string) => Promise<void>;
}) {
  const layout = useMemo(() => layoutTree(nodes), [nodes]);
  const stageRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<View>(() => viewMemory.get(runKey) ?? { x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<LaidNode | null>(null);
  // Tracks whether the USER moved the view — not whether we auto-fitted it.
  // Keeping the two apart matters during a live run: the tree grows every poll,
  // so it has to keep re-fitting until someone takes control, but the moment
  // they pan or zoom it must stop moving under them.
  const userMoved = useRef(viewMemory.has(runKey));
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    return () => {
      // Only remember a view the user actually chose. Persisting unconditionally
      // means the next mount sees a stored view, assumes they had panned, and
      // never fits again — so after one tab switch the board opens stuck at 1:1
      // with most of it off-screen.
      if (userMoved.current) viewMemory.set(runKey, viewRef.current);
    };
  }, [runKey]);

  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el || !layout.width) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (!cw || !ch) return;
    const k = clamp(Math.min(cw / layout.width, ch / layout.height, 1), MIN_K, MAX_K);
    // Centre only when the content FITS. Once the zoom floor bites — a wide
    // top-down tree hits it easily — centring yields a negative offset that
    // parks half the board off-screen, so pin to the edge and let them pan.
    const centre = (viewport: number, content: number) =>
      content <= viewport ? (viewport - content) / 2 : 0;
    setView({
      k,
      x: centre(cw, layout.width * k),
      y: centre(ch, layout.height * k),
    });
  }, [layout.width, layout.height]);

  // Re-fit as the tree grows AND as the stage resizes, until the user takes
  // over. The resize part matters on first paint: without it the fit can run
  // against a stage that has not reached its final width, and the board opens
  // scrolled off to one side.
  useEffect(() => {
    if (!userMoved.current) fit();
  }, [fit, layout.width, layout.height]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Wheel must be a NON-PASSIVE native listener: React attaches wheel handlers
  // passively at the root, so preventDefault() inside onWheel is ignored and the
  // page scrolls behind the canvas instead of zooming it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as a ctrl-wheel.
        const k2 = clamp(v.k * Math.exp(-e.deltaY * 0.01), MIN_K, MAX_K);
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setView({
          k: k2,
          x: px - (px - v.x) * (k2 / v.k),
          y: py - (py - v.y) * (k2 / v.k),
        });
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag the background to pan. A drag that travels more than a few pixels
  // suppresses the click, so panning never opens the drawer by accident.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    userMoved.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) => {
    const el = stageRef.current;
    if (!el) return;
    userMoved.current = true;
    const { width, height } = el.getBoundingClientRect();
    setView((v) => {
      const k2 = clamp(v.k * factor, MIN_K, MAX_K);
      const cx = width / 2;
      const cy = height / 2;
      return { k: k2, x: cx - (cx - v.x) * (k2 / v.k), y: cy - (cy - v.y) * (k2 / v.k) };
    });
  };

  // The drawer holds a snapshot from when the box was clicked, but polling
  // replaces the node array every couple of seconds while a regeneration runs.
  // Re-read the open node from the latest data so the panel shows the discard
  // landing and the replacement arriving, instead of freezing on a stale copy.
  const liveActive = useMemo(
    () => (active ? nodes.find((n) => n.id === active.id) : undefined),
    [active, nodes],
  );

  // The lit set is the hovered (or selected) node plus its whole chain back to
  // the objective — the chain of thought that produced it.
  const focus = hover ?? active?.id ?? null;
  const lit = useMemo(() => {
    if (focus === null) return null;
    return new Set<number>([focus, ...(layout.ancestors.get(focus) ?? [])]);
  }, [focus, layout]);

  if (!layout.nodes.length) return null;

  return (
    <>
      <div className="relative overflow-hidden rounded-xl border border-border bg-background-soft/40">
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            onPointerUp();
            setHover(null);
          }}
          className="relative h-[540px] w-full cursor-grab touch-none active:cursor-grabbing"
        >
          <div
            className="absolute origin-top-left"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              width: layout.width,
              height: layout.height,
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={layout.width}
              height={layout.height}
              aria-hidden
            >
              <defs>
                <marker
                  id="tree-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,1 L9,5 L0,9 z" fill="var(--color-border-strong)" />
                </marker>
                <marker
                  id="tree-arrow-lit"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,1 L9,5 L0,9 z" fill="var(--color-accent)" />
                </marker>
              </defs>
              {layout.edges.map((e) => {
                // An edge is lit only when BOTH ends are — which is exactly the
                // chain from the root down to the hovered node.
                const on = lit ? lit.has(e.from) && lit.has(e.to) : false;
                return (
                  <path
                    key={`${e.from}-${e.to}`}
                    d={e.d}
                    fill="none"
                    stroke={on ? "var(--color-accent)" : "var(--color-border-strong)"}
                    strokeWidth={on ? 2.2 : 1.5}
                    opacity={lit && !on ? 0.2 : 0.9}
                    markerEnd={on ? "url(#tree-arrow-lit)" : "url(#tree-arrow)"}
                    className="transition-opacity duration-150"
                  />
                );
              })}
            </svg>

            {layout.nodes.map((item) => (
              <NodeBox
                key={item.id}
                item={item}
                lit={!lit || lit.has(item.id)}
                selected={active?.id === item.id}
                onHover={setHover}
                onSelect={(n) => {
                  if (drag.current?.moved) return;
                  setActive(n);
                }}
              />
            ))}
          </div>
        </div>

        {/* view controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-border bg-background-elevated/90 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={fit}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-background-soft hover:text-foreground"
            aria-label="Fit to view"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-foreground-subtle">
          Drag to pan, pinch or ⌘-scroll to zoom, click a box for the detail
        </p>
      </div>

      {/* Non-modal so the board stays visible AND interactive behind the panel —
          clicking another box swaps the detail instead of closing it. */}
      <Sheet
        modal={false}
        open={active !== null}
        onOpenChange={(o) => {
          if (!o) setActive(null);
        }}
      >
        <SheetContent
          showOverlay={false}
          className="max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {active && (
            <>
              <SheetTitle className="sr-only">{active.node.label}</SheetTitle>
              <SheetDescription className="sr-only">
                Detail for this {active.node.kind}
              </SheetDescription>
              <NodeDetail
                node={liveActive ?? active.node}
                objective={objective}
                onSubmit={(kind, comment) => onReview(active.id, kind, comment)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
