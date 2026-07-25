"use client";

import { useState } from "react";
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Flag,
  Mail,
  Edit2,
  Check,
  X,
  Clock,
  CircleDot,
  CircleDashed,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatDate, initials, relativeTime } from "@/lib/utils";
import type {
  ActivityItem,
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

const ACTIVITY_ICON = {
  email: Mail,
  decision: CheckCircle2,
  deliverable: FileCheck,
  risk: AlertTriangle,
  milestone: Flag,
};
const ACTIVITY_COLOR = {
  email: "text-foreground-subtle",
  decision: "text-success",
  deliverable: "text-accent",
  risk: "text-destructive",
  milestone: "text-warning",
};

export function ProjectWorkstreamTab({ project }: { project: Project }) {
  // Currently selected workstream id; defaults to first.
  const [selectedId, setSelectedId] = useState<string>(
    project.workstreams[0]?.id ?? ""
  );
  const [deadlineOverrides, setDeadlineOverrides] = useState<
    Record<string, string>
  >({});

  const updateDeadline = (id: string, iso: string) => {
    setDeadlineOverrides((prev) => ({ ...prev, [id]: iso }));
  };

  const selected = project.workstreams.find((w) => w.id === selectedId);

  if (!selected) return null;

  const owner = project.team.find((p) => p.id === selected.owner);
  const wsDeliverables = project.deliverables.filter(
    (d) => d.workstreamId === selected.id
  );
  const upcoming = wsDeliverables
    .filter((d) => d.status !== "done")
    .map((d) => ({
      ...d,
      dueDate: deadlineOverrides[d.id] ?? d.dueDate,
    }))
    .sort(
      (a, b) =>
        new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );

  const activity = project.recentActivity
    .filter((a) => a.workstreamId === selected.id)
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      {/* --- Left: workstream selector --- */}
      <aside>
        <div className="text-[10px] uppercase tracking-wider text-foreground-subtle font-mono mb-2 px-2">
          {project.workstreams.length} workstreams
        </div>
        <nav className="flex flex-col gap-1">
          {project.workstreams.map((ws) => {
            const isActive = ws.id === selectedId;
            const owner = project.team.find((p) => p.id === ws.owner);
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => setSelectedId(ws.id)}
                className={cn(
                  "group text-left rounded-md px-3 py-2.5 transition-colors border",
                  isActive
                    ? "bg-accent/10 border-accent/30 text-foreground"
                    : "bg-transparent border-transparent hover:bg-background-elevated text-foreground-muted hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      isActive
                        ? "bg-accent"
                        : "bg-foreground-subtle group-hover:bg-foreground-muted"
                    )}
                  />
                  <span className="text-sm font-medium leading-tight truncate">
                    {ws.name}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 ml-auto shrink-0 transition-opacity",
                      isActive
                        ? "opacity-100 text-accent"
                        : "opacity-0 group-hover:opacity-100"
                    )}
                  />
                </div>
                {owner && (
                  <div className="text-[10px] text-foreground-subtle pl-3.5 truncate">
                    {owner.name}
                  </div>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* --- Right: workstream content --- */}
      <section className="space-y-6">
        {/* Page title + context */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground-subtle mb-1.5">
            Workstream
          </p>
          <h2 className="text-2xl font-semibold tracking-tight mb-2">
            {selected.name}
          </h2>
          <p className="text-sm text-foreground-muted leading-relaxed max-w-3xl">
            {selected.description}
          </p>
          <div className="mt-4 flex items-center gap-5 flex-wrap text-xs">
            {owner && (
              <span className="inline-flex items-center gap-2 text-foreground-muted">
                <span className="text-foreground-subtle uppercase tracking-wider text-[10px]">
                  Owner
                </span>
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[9px]">
                    {initials(owner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-foreground">{owner.name}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-2 text-foreground-muted">
              <span className="text-foreground-subtle uppercase tracking-wider text-[10px]">
                Progress
              </span>
              <span className="inline-block w-24 relative h-1 rounded-full overflow-hidden bg-background-soft">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0",
                    selected.status === "at-risk"
                      ? "bg-warning"
                      : selected.status === "blocked"
                      ? "bg-destructive"
                      : "bg-gradient-to-r from-primary to-accent"
                  )}
                  style={{ width: `${selected.progress}%` }}
                />
              </span>
              <span className="font-mono text-foreground">
                {selected.progress}%
              </span>
            </span>
          </div>
        </div>

        {/* Upcoming deliverables */}
        <div>
          <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-border">
            <h3 className="text-base font-semibold tracking-tight">
              Upcoming deliverables
            </h3>
            <span className="text-xs text-foreground-subtle font-mono">
              {upcoming.length} open
            </span>
          </div>
          {upcoming.length === 0 ? (
            <div className="text-xs text-foreground-subtle italic py-6 text-center border border-dashed border-border rounded-md">
              Nothing upcoming. All deliverables for this workstream are done.
            </div>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((d) => (
                <DeliverableUpcomingRow
                  key={d.id}
                  deliverable={d}
                  owner={project.team.find((p) => p.id === d.ownerId) ?? null}
                  onDeadlineChange={(iso) => updateDeadline(d.id, iso)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Workstream history */}
        <div>
          <div className="mb-3 pb-2 border-b border-border">
            <h3 className="text-base font-semibold tracking-tight">
              Workstream history
            </h3>
          </div>
          {activity.length === 0 ? (
            <div className="text-xs text-foreground-subtle italic py-6 text-center border border-dashed border-border rounded-md">
              No activity yet on this workstream.
            </div>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-5">
              {activity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming deliverable row — title, status, owner, editable due-date
// ---------------------------------------------------------------------------

interface DeliverableUpcomingRowProps {
  deliverable: Deliverable;
  owner: Person | null;
  onDeadlineChange: (iso: string) => void;
}

function DeliverableUpcomingRow({
  deliverable: d,
  owner,
  onDeadlineChange,
}: DeliverableUpcomingRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => d.dueDate.slice(0, 10));

  const status = STATUS_META[d.status];
  const StatusIcon = status.icon;

  const due = new Date(d.dueDate);
  const isOverdue = due.getTime() < Date.now() && d.status !== "done";
  const daysOut = Math.round(
    (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="rounded-md border border-border bg-background-soft/30 p-3.5 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
            status.bg
          )}
        >
          <StatusIcon className={cn("h-4 w-4", status.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h4 className="text-sm font-medium leading-tight flex-1">
              {d.title}
            </h4>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {status.label}
            </Badge>
          </div>
          <p className="text-xs text-foreground-muted leading-relaxed line-clamp-2 mb-2">
            {d.description}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {owner && (
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px]">
                    {initials(owner.name)}
                  </AvatarFallback>
                </Avatar>
                {owner.name}
              </span>
            )}
            {editing ? (
              <div className="inline-flex items-center gap-1.5">
                <Input
                  type="date"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-7 text-xs w-[140px]"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (draft) {
                      const newIso = new Date(
                        draft + "T17:00:00.000Z"
                      ).toISOString();
                      onDeadlineChange(newIso);
                    }
                    setEditing(false);
                  }}
                  title="Save"
                  className="h-7 w-7"
                >
                  <Check className="h-3 w-3 text-success" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setDraft(d.dueDate.slice(0, 10));
                    setEditing(false);
                  }}
                  title="Cancel"
                  className="h-7 w-7"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn(
                  "group inline-flex items-center gap-1.5 text-xs rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-background-elevated",
                  isOverdue
                    ? "text-destructive"
                    : daysOut <= 3
                    ? "text-warning"
                    : "text-foreground-muted"
                )}
                title="Click to edit deadline"
              >
                <Calendar className="h-3 w-3" />
                <span className="font-mono">{formatDate(d.dueDate)}</span>
                <span className="text-foreground-subtle">
                  {isOverdue
                    ? `· overdue`
                    : daysOut === 0
                    ? "· today"
                    : daysOut === 1
                    ? "· tomorrow"
                    : daysOut > 0
                    ? `· in ${daysOut}d`
                    : ""}
                </span>
                <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity row (reverse-chrono history)
// ---------------------------------------------------------------------------

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = ACTIVITY_ICON[item.type];
  return (
    <li className="ml-5 fade-in-up">
      <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-background bg-background-elevated">
        <span
          className={cn(
            "absolute inset-0.5 rounded-full",
            ACTIVITY_COLOR[item.type].replace("text-", "bg-")
          )}
        />
      </span>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-3.5 w-3.5", ACTIVITY_COLOR[item.type])} />
        <span className="text-[10px] uppercase tracking-wider font-mono text-foreground-subtle">
          {item.type}
        </span>
        <span className="ml-auto text-[10px] text-foreground-subtle font-mono">
          {relativeTime(item.date)}
        </span>
      </div>
      <h5 className="text-sm font-medium text-foreground mb-1">{item.title}</h5>
      <p className="text-xs text-foreground-muted leading-relaxed">
        {item.summary}
      </p>
      <p className="mt-1.5 text-[10px] text-foreground-subtle font-mono truncate">
        ↳ {item.source}
      </p>
    </li>
  );
}
