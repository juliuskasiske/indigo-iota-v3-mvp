"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  CircleDashed,
  CircleDot,
  Edit2,
  Check,
  X,
  Save,
  FileText,
  Search,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn, formatDate, initials } from "@/lib/utils";
import type {
  Deliverable,
  DeliverableStatus,
  Person,
  Project,
} from "@/lib/mock/types";

const STATUS_META: Record<
  DeliverableStatus,
  { label: string; icon: typeof CircleDashed; color: string; bg: string }
> = {
  todo: {
    label: "Not started",
    icon: CircleDashed,
    color: "text-foreground-subtle",
    bg: "bg-background-soft",
  },
  "in-progress": {
    label: "In progress",
    icon: CircleDot,
    color: "text-warning",
    bg: "bg-warning/10",
  },
  "in-review": {
    label: "In review",
    icon: Clock,
    color: "text-accent",
    bg: "bg-accent/10",
  },
  done: {
    label: "Done",
    icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
  },
};

export function ProjectDeliverableTab({ project }: { project: Project }) {
  // Manager-edited scope description overrides (component-local).
  const [descOverrides, setDescOverrides] = useState<Record<string, string>>(
    {}
  );
  // Manager-edited deadlines (component-local).
  const [deadlineOverrides, setDeadlineOverrides] = useState<
    Record<string, string>
  >({});

  // Gantt popover open id — at most one open at a time.
  const [ganttOpenId, setGanttOpenId] = useState<string | null>(null);
  // List expanded id — at most one row expanded inline.
  const [expandedListId, setExpandedListId] = useState<string | null>(null);

  // Search query for the list below.
  const [query, setQuery] = useState("");

  // Effective deliverables (with overrides applied).
  const deliverables = useMemo(
    () =>
      project.deliverables.map((d) => ({
        ...d,
        description: descOverrides[d.id] ?? d.description,
        dueDate: deadlineOverrides[d.id] ?? d.dueDate,
      })),
    [project.deliverables, descOverrides, deadlineOverrides]
  );

  // Sort by due date for the Gantt; group by workstream for the list.
  const ganttDeliverables = [...deliverables].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  // Filtered list (below the Gantt).
  const filteredDeliverables = useMemo(() => {
    if (!query.trim()) return deliverables;
    const q = query.trim().toLowerCase();
    return deliverables.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q)
    );
  }, [deliverables, query]);

  return (
    <div className="space-y-6">
      {/* --- Gantt chart --- */}
      <DeliverableGantt
        deliverables={ganttDeliverables}
        openId={ganttOpenId}
        onOpenChange={setGanttOpenId}
        team={project.team}
        workstreams={project.workstreams}
        descOverrides={descOverrides}
        onSaveDescription={(id, desc) =>
          setDescOverrides((prev) => ({ ...prev, [id]: desc }))
        }
        onSaveDeadline={(id, iso) =>
          setDeadlineOverrides((prev) => ({ ...prev, [id]: iso }))
        }
      />

      {/* --- Searchable list, grouped by workstream --- */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-border">
          <h3 className="text-base font-semibold tracking-tight">
            All deliverables
          </h3>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle pointer-events-none" />
            <Input
              type="text"
              placeholder="Search deliverables…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {query && filteredDeliverables.length === 0 ? (
          <div className="text-xs text-foreground-subtle italic py-8 text-center border border-dashed border-border rounded-md">
            No deliverables match &ldquo;
            <span className="text-foreground">{query}</span>&rdquo;
          </div>
        ) : (
          <div className="space-y-7">
            {project.workstreams.map((ws) => {
              const wsDels = filteredDeliverables
                .filter((d) => d.workstreamId === ws.id)
                .sort(
                  (a, b) =>
                    new Date(a.dueDate).getTime() -
                    new Date(b.dueDate).getTime()
                );
              if (wsDels.length === 0) return null;
              return (
                <section key={ws.id}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="h-2 w-2 rounded-full bg-entity-workstream" />
                    <h4 className="text-sm font-semibold tracking-tight">
                      {ws.name}
                    </h4>
                    <Badge variant="outline" className="text-[10px]">
                      {wsDels.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {wsDels.map((d) => (
                      <ExpandableDeliverableRow
                        key={d.id}
                        deliverable={d}
                        owner={
                          project.team.find((p) => p.id === d.ownerId) ?? null
                        }
                        isExpanded={expandedListId === d.id}
                        isEdited={!!descOverrides[d.id]}
                        onToggle={() =>
                          setExpandedListId((prev) =>
                            prev === d.id ? null : d.id
                          )
                        }
                        onSaveDescription={(desc) =>
                          setDescOverrides((prev) => ({
                            ...prev,
                            [d.id]: desc,
                          }))
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt chart
// ---------------------------------------------------------------------------

interface DeliverableGanttProps {
  deliverables: Deliverable[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  team: Person[];
  workstreams: Project["workstreams"];
  descOverrides: Record<string, string>;
  onSaveDescription: (id: string, desc: string) => void;
  onSaveDeadline: (id: string, iso: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function DeliverableGantt({
  deliverables,
  openId,
  onOpenChange,
  team,
  workstreams,
  descOverrides,
  onSaveDescription,
  onSaveDeadline,
}: DeliverableGanttProps) {
  // Compute the global date range from earliest createdAt to latest dueDate,
  // padded by a few days on each side for breathing room.
  const range = useMemo(() => {
    if (deliverables.length === 0) {
      const now = Date.now();
      return { start: now - 14 * DAY_MS, end: now + 14 * DAY_MS };
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const d of deliverables) {
      const s = new Date(d.createdAt).getTime();
      const e = new Date(d.dueDate).getTime();
      if (s < min) min = s;
      if (e > max) max = e;
    }
    const pad = 3 * DAY_MS;
    return { start: min - pad, end: max + pad };
  }, [deliverables]);

  const today = Date.now();
  const span = range.end - range.start;
  const pct = (t: number) => ((t - range.start) / span) * 100;

  const ticks = useMemo(() => {
    const days = span / DAY_MS;
    const interval = days > 100 ? 14 : days > 50 ? 7 : 4;
    const out: { t: number; label: string }[] = [];
    const first = new Date(range.start);
    first.setHours(0, 0, 0, 0);
    while (first.getDay() !== 1) first.setDate(first.getDate() + 1);
    let cursor = first.getTime();
    while (cursor <= range.end) {
      const d = new Date(cursor);
      out.push({
        t: cursor,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
      cursor += interval * DAY_MS;
    }
    return out;
  }, [range, span]);

  const ROW_H = 30;
  const GAP = 4;
  const LABEL_W = 220;

  if (deliverables.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <h3 className="text-base font-semibold tracking-tight mb-1">
            No deliverables yet
          </h3>
          <p className="text-xs text-foreground-muted max-w-md mx-auto">
            Iota will create deliverables here as your team produces them — a
            new memo, a draft, a deck. They&apos;ll appear on the Gantt
            automatically the moment they&apos;re mentioned in email, Slack, or
            SharePoint.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Timeline</h3>
            <p className="text-xs text-foreground-muted mt-0.5">
              {deliverables.length} deliverables · earliest due-date at top ·
              click a bar to view &amp; edit
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-foreground-subtle">
            <LegendDot color="bg-accent" label="On track" />
            <LegendDot color="bg-warning" label="At risk" />
            <LegendDot color="bg-destructive" label="Overdue" />
            <LegendDot color="bg-success" label="Done" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: "720px" }} className="relative">
            {/* Axis */}
            <div
              className="relative grid items-end mb-2 border-b border-border"
              style={{
                gridTemplateColumns: `${LABEL_W}px 1fr`,
                height: 28,
              }}
            >
              <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">
                Deliverable
              </div>
              <div className="relative h-full">
                {ticks.map((tick) => (
                  <span
                    key={tick.t}
                    className="absolute bottom-0 -translate-x-1/2 text-[10px] font-mono text-foreground-subtle"
                    style={{ left: `${pct(tick.t)}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div
              className="relative"
              style={{
                height: deliverables.length * (ROW_H + GAP) + 4,
              }}
            >
              {/* Today line */}
              {today >= range.start && today <= range.end && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none z-10"
                  style={{
                    left: `calc(${LABEL_W}px + ${pct(today)}% * (100% - ${LABEL_W}px) / 100%)`,
                  }}
                >
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-accent uppercase tracking-wider whitespace-nowrap">
                    Today
                  </span>
                  <span className="absolute inset-y-0 left-0 w-px bg-accent/60" />
                </div>
              )}

              {/* Bars */}
              {deliverables.map((d, i) => {
                const start = new Date(d.createdAt).getTime();
                const end = new Date(d.dueDate).getTime();
                const left = pct(start);
                const width = Math.max(pct(end) - pct(start), 1.5);
                const isOverdue = end < today && d.status !== "done";
                const isDone = d.status === "done";
                const isAtRisk = !!d.atRisk && !isDone;

                const barColor = isOverdue
                  ? "bg-destructive"
                  : isAtRisk
                  ? "bg-warning"
                  : isDone
                  ? "bg-success"
                  : "bg-accent";
                const trackColor = isOverdue
                  ? "bg-destructive/15"
                  : isAtRisk
                  ? "bg-warning/15"
                  : isDone
                  ? "bg-success/15"
                  : "bg-accent/15";

                const isOpen = d.id === openId;
                const owner = team.find((p) => p.id === d.ownerId) ?? null;
                const workstreamName =
                  workstreams.find((w) => w.id === d.workstreamId)?.name ??
                  "";

                return (
                  <Popover
                    key={d.id}
                    open={isOpen}
                    onOpenChange={(o) => onOpenChange(o ? d.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "absolute left-0 right-0 grid items-center transition-colors group text-left",
                          isOpen && "bg-background-elevated/60",
                          "hover:bg-background-elevated/40"
                        )}
                        style={{
                          top: i * (ROW_H + GAP),
                          height: ROW_H,
                          gridTemplateColumns: `${LABEL_W}px 1fr`,
                        }}
                        title={`${d.title} · ${formatDate(d.createdAt)} → ${formatDate(d.dueDate)}`}
                      >
                        {/* Label */}
                        <div className="pr-3 flex items-center gap-2 min-w-0">
                          <span
                            className={cn(
                              "text-xs truncate",
                              isOpen
                                ? "text-foreground font-medium"
                                : "text-foreground-muted group-hover:text-foreground"
                            )}
                          >
                            {d.title}
                          </span>
                          {d.atRisk && !isDone && (
                            <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                          )}
                        </div>

                        {/* Bar track */}
                        <div className="relative h-full">
                          <span
                            className={cn(
                              "absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full",
                              trackColor
                            )}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              minWidth: 6,
                            }}
                          >
                            <span
                              className={cn(
                                "absolute inset-0 rounded-full",
                                barColor,
                                {
                                  "opacity-80": !isOpen,
                                  "opacity-100 ring-2 ring-offset-2 ring-offset-background ring-accent":
                                    isOpen,
                                }
                              )}
                            />
                          </span>
                        </div>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="end"
                      className="w-96"
                    >
                      <DeliverableCallout
                        deliverable={d}
                        owner={owner}
                        workstreamName={workstreamName}
                        isEdited={!!descOverrides[d.id]}
                        onSaveDescription={(desc) =>
                          onSaveDescription(d.id, desc)
                        }
                        onSaveDeadline={(iso) => onSaveDeadline(d.id, iso)}
                        onClose={() => onOpenChange(null)}
                      />
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gantt callout — small floating detail card anchored to the clicked bar.
// Tight visual footprint, distinct from the inline list expansion below.
// ---------------------------------------------------------------------------

interface DeliverableCalloutProps {
  deliverable: Deliverable;
  owner: Person | null;
  workstreamName: string;
  isEdited: boolean;
  onSaveDescription: (desc: string) => void;
  onSaveDeadline: (iso: string) => void;
  onClose: () => void;
}

function DeliverableCallout({
  deliverable: d,
  owner,
  workstreamName,
  isEdited,
  onSaveDescription,
  onSaveDeadline,
  onClose,
}: DeliverableCalloutProps) {
  const status = STATUS_META[d.status];
  const StatusIcon = status.icon;
  const due = new Date(d.dueDate);
  const isOverdue = due.getTime() < Date.now() && d.status !== "done";

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(d.description);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState(d.dueDate.slice(0, 10));

  return (
    <div className="space-y-3">
      {/* Header — status icon + title + close */}
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
            status.bg
          )}
        >
          <StatusIcon className={cn("h-3.5 w-3.5", status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold leading-tight mb-1">
            {d.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            <Badge variant="outline" className="text-[10px]">
              {status.label}
            </Badge>
            {d.atRisk && d.status !== "done" && (
              <Badge variant="warning" className="text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5" />
                At risk
              </Badge>
            )}
            <span className="text-foreground-subtle">·</span>
            <span className="inline-flex items-center gap-1 text-foreground-muted">
              <span className="h-1 w-1 rounded-full bg-entity-workstream" />
              {workstreamName}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-foreground-subtle hover:text-foreground shrink-0"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Meta — owner + due date */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        {owner && (
          <span className="inline-flex items-center gap-1.5 text-foreground-muted">
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[8px]">
                {initials(owner.name)}
              </AvatarFallback>
            </Avatar>
            {owner.name}
          </span>
        )}
        {editingDate ? (
          <span className="inline-flex items-center gap-1.5">
            <Input
              type="date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              className="h-7 text-xs w-[140px]"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (dateDraft) {
                  const newIso = new Date(
                    dateDraft + "T17:00:00.000Z"
                  ).toISOString();
                  onSaveDeadline(newIso);
                }
                setEditingDate(false);
              }}
            >
              <Check className="h-3 w-3 text-success" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setDateDraft(d.dueDate.slice(0, 10));
                setEditingDate(false);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDate(true)}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-background-soft",
              isOverdue ? "text-destructive" : "text-foreground-muted"
            )}
          >
            <Calendar className="h-3 w-3" />
            <span className="font-mono">{formatDate(d.dueDate)}</span>
            {isOverdue && <span className="font-mono">· overdue</span>}
            <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>

      {/* Scope */}
      <div className="rounded-md border border-border bg-background-soft/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-foreground-subtle font-mono inline-flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Scope
            {isEdited && <span className="text-accent">· edited</span>}
          </div>
          {!editingDesc && (
            <button
              type="button"
              onClick={() => {
                setDescDraft(d.description);
                setEditingDesc(true);
              }}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-foreground-subtle hover:text-foreground transition-colors font-mono"
            >
              <Edit2 className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>

        {editingDesc ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={5}
              className="text-xs"
              placeholder="Define the scope — what's in, what's out, what the team needs to know."
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDescDraft(d.description);
                  setEditingDesc(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onSaveDescription(descDraft.trim());
                  setEditingDesc(false);
                }}
                disabled={!descDraft.trim()}
              >
                <Save className="h-3.5 w-3.5" />
                Save &amp; notify
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-foreground-muted leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto pr-1">
            {d.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable list row — click to toggle, expands inline within the same card.
// ---------------------------------------------------------------------------

interface ExpandableDeliverableRowProps {
  deliverable: Deliverable;
  owner: Person | null;
  isExpanded: boolean;
  isEdited: boolean;
  onToggle: () => void;
  onSaveDescription: (desc: string) => void;
}

function ExpandableDeliverableRow({
  deliverable: d,
  owner,
  isExpanded,
  isEdited,
  onToggle,
  onSaveDescription,
}: ExpandableDeliverableRowProps) {
  const status = STATUS_META[d.status];
  const StatusIcon = status.icon;
  const isOverdue =
    new Date(d.dueDate).getTime() < Date.now() && d.status !== "done";

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(d.description);

  // If we collapse while editing, also exit edit mode so we don't leave a
  // hidden draft floating around.
  if (!isExpanded && editingDesc) setEditingDesc(false);

  return (
    <div
      className={cn(
        "rounded-md border transition-colors overflow-hidden",
        isExpanded
          ? "border-accent/40 bg-accent/[0.04]"
          : "border-border bg-background-soft/30 hover:border-border-strong hover:bg-background-elevated"
      )}
    >
      {/* Header row — always visible, click to toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        <div
          className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
            status.bg
          )}
        >
          <StatusIcon className={cn("h-3.5 w-3.5", status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium truncate">{d.title}</span>
            {d.atRisk && d.status !== "done" && (
              <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
            )}
          </div>
          <div className="text-[10px] text-foreground-subtle font-mono truncate">
            {owner?.name}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Badge variant="outline" className="text-[10px]">
            {status.label}
          </Badge>
          <span
            className={cn(
              "text-xs font-mono",
              isOverdue ? "text-destructive" : "text-foreground-muted"
            )}
          >
            {formatDate(d.dueDate)}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-foreground-subtle transition-transform",
              isExpanded && "rotate-180 text-accent"
            )}
          />
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-border bg-background/40 p-3 fade-in-up">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-foreground-subtle font-mono inline-flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Scope
              {isEdited && <span className="text-accent">· edited</span>}
            </div>
            {!editingDesc && (
              <button
                type="button"
                onClick={() => {
                  setDescDraft(d.description);
                  setEditingDesc(true);
                }}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-foreground-subtle hover:text-foreground transition-colors font-mono"
              >
                <Edit2 className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>

          {editingDesc ? (
            <div className="space-y-2">
              <Textarea
                autoFocus
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={5}
                className="text-sm"
                placeholder="Define the scope — what's in, what's out, what the team needs to know."
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDescDraft(d.description);
                    setEditingDesc(false);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onSaveDescription(descDraft.trim());
                    setEditingDesc(false);
                  }}
                  disabled={!descDraft.trim()}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save &amp; notify team
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted leading-relaxed whitespace-pre-wrap">
              {d.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
