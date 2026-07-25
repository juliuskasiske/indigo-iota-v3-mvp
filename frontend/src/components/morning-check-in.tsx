"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Sun,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Flag,
  Inbox,
  Plus,
  X,
  Send,
  Check,
  Loader2,
  GripVertical,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate, initials, sleep } from "@/lib/utils";
import type {
  Project,
  Task,
  TaskPriority,
} from "@/lib/mock/types";

// --- icons + colors by highlight type ----------------------------------------

const HIGHLIGHT_ICON = {
  decision: CheckCircle2,
  deliverable: FileCheck,
  risk: AlertTriangle,
  milestone: Flag,
  request: Inbox,
};
const HIGHLIGHT_COLOR = {
  decision: "text-success",
  deliverable: "text-accent",
  risk: "text-destructive",
  milestone: "text-warning",
  request: "text-primary",
};
const HIGHLIGHT_BG = {
  decision: "bg-success/10 border-success/30",
  deliverable: "bg-accent/10 border-accent/30",
  risk: "bg-destructive/10 border-destructive/30",
  milestone: "bg-warning/10 border-warning/30",
  request: "bg-primary/10 border-primary/30",
};

const PRIORITY_STYLES: Record<
  TaskPriority,
  { label: string; classes: string }
> = {
  high: { label: "High", classes: "text-destructive border-destructive/30 bg-destructive/10" },
  medium: { label: "Medium", classes: "text-warning border-warning/30 bg-warning/10" },
  low: { label: "Low", classes: "text-foreground-muted border-border bg-background-soft" },
};

// --- main component ----------------------------------------------------------

export function MorningCheckIn({ project }: { project: Project }) {
  const checkIn = project.todaysCheckIn!;

  // Local editable state. Each proposal carries a copy of its task list so
  // the manager can add / edit / remove without touching the source.
  const [proposalState, setProposalState] = useState(() =>
    checkIn.proposals.map((p) => ({
      personId: p.personId,
      rationale: p.rationale,
      tasks: p.proposedTaskIds
        .map((tid) => project.tasks.find((t) => t.id === tid))
        .filter((t): t is Task => Boolean(t))
        .map((t) => ({ ...t })),
    }))
  );

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const totalTasks = proposalState.reduce((s, p) => s + p.tasks.length, 0);
  const highPriorityCount = proposalState.reduce(
    (s, p) => s + p.tasks.filter((t) => t.priority === "high").length,
    0
  );

  const updateTask = (personId: string, taskId: string, patch: Partial<Task>) => {
    setProposalState((prev) =>
      prev.map((p) =>
        p.personId === personId
          ? {
              ...p,
              tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
            }
          : p
      )
    );
  };

  const removeTask = (personId: string, taskId: string) => {
    setProposalState((prev) =>
      prev.map((p) =>
        p.personId === personId
          ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }
          : p
      )
    );
  };

  const addTask = (personId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setProposalState((prev) =>
      prev.map((p) =>
        p.personId === personId
          ? {
              ...p,
              tasks: [
                ...p.tasks,
                {
                  id: `t_new_${personId}_${Date.now()}`,
                  title: trimmed,
                  assigneeId: personId,
                  status: "proposed",
                  priority: "medium",
                  createdAt: new Date().toISOString(),
                  proposedBy: project.team[0]?.id ?? "iota",
                },
              ],
            }
          : p
      )
    );
  };

  const handleSend = async () => {
    setSending(true);
    await sleep(1400);
    setSending(false);
    setSent(true);
  };

  return (
    <div className="relative z-10 p-6 md:p-10 max-w-5xl mx-auto">
      <div className="mb-5">
        <Link
          href={`/projects/view?id=${project.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to {project.name}
        </Link>
      </div>

      {/* Header */}
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.2em] text-accent mb-3">
            <Sun className="h-3 w-3" />
            Morning check-in · {formatDate(checkIn.date, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Today on {project.name}
          </h1>
          <p className="mt-2 text-foreground-muted max-w-2xl text-sm leading-relaxed">
            Iota reviewed everything that happened yesterday and proposed a focused
            todo list for each team member. Edit anything before sending.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-semibold font-mono leading-none">
              {totalTasks}
            </div>
            <span className="text-xs text-foreground-subtle uppercase tracking-wider">
              tasks queued
            </span>
          </div>
          <div className="text-[10px] text-foreground-subtle font-mono">
            {highPriorityCount} high priority · {proposalState.length} people
          </div>
        </div>
      </header>

      {/* Yesterday recap */}
      <Card className="mb-8 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-background-soft/40 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-foreground-subtle">
            <Sparkles className="h-3 w-3 text-accent" />
            Yesterday recap
          </span>
          <span className="text-[10px] font-mono text-foreground-subtle">
            synthesized from {project.emailsScanned} emails
          </span>
        </div>
        <div className="p-5">
          <p
            className="text-sm leading-relaxed text-foreground-muted mb-4"
            dangerouslySetInnerHTML={{
              __html: checkIn.yesterdaySummary.replace(
                /\*\*(.+?)\*\*/g,
                '<strong class="text-foreground font-semibold">$1</strong>'
              ),
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {checkIn.yesterdayHighlights.map((h, i) => {
              const Icon = HIGHLIGHT_ICON[h.type];
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border px-3 py-2",
                    HIGHLIGHT_BG[h.type]
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", HIGHLIGHT_COLOR[h.type])}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {h.label}
                    </div>
                    <div className="text-xs text-foreground-muted mt-0.5 leading-relaxed">
                      {h.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Per-person proposals */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Today&apos;s proposed tasks</h2>
        <div className="text-xs text-foreground-subtle font-mono">
          {totalTasks} tasks · click any field to edit
        </div>
      </div>

      <div className="space-y-4">
        {proposalState.map((proposal) => {
          const person = [...project.team, ...project.partners].find(
            (p) => p.id === proposal.personId
          );
          if (!person) return null;
          return (
            <PersonProposal
              key={proposal.personId}
              person={person}
              rationale={proposal.rationale}
              tasks={proposal.tasks}
              workstreamLookup={(id) =>
                project.workstreams.find((w) => w.id === id)?.name ?? null
              }
              deliverableLookup={(id) =>
                project.deliverables.find((d) => d.id === id)?.title ?? null
              }
              onUpdateTask={(taskId, patch) =>
                updateTask(proposal.personId, taskId, patch)
              }
              onRemoveTask={(taskId) => removeTask(proposal.personId, taskId)}
              onAddTask={(title) => addTask(proposal.personId, title)}
            />
          );
        })}
      </div>

      {/* Send footer */}
      <div className="mt-8 sticky bottom-4 z-10">
        {!sent ? (
          <Card className="bg-background-elevated/95 backdrop-blur-md shadow-xl shadow-black/40 border-accent/30">
            <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <Send className="h-4 w-4 text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    Send to {proposalState.length} team member
                    {proposalState.length === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    Each person receives their own list. The team sees the yesterday
                    recap above their tasks.
                  </div>
                </div>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={handleSend}
                disabled={sending || totalTasks === 0}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send check-in
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-success/10 border-success/30 fade-in-up">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-success/20 flex items-center justify-center shrink-0 pulse-glow">
                <Check className="h-4 w-4 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  Sent · {totalTasks} tasks delivered to {proposalState.length} team
                  members
                </div>
                <div className="text-xs text-foreground-muted">
                  Iota will track replies and pull any new commitments into tomorrow&apos;s
                  check-in.
                </div>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/projects/view?id=${project.id}`}>Back to project</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// --- per-person proposal block ----------------------------------------------

interface PersonProposalProps {
  person: {
    id: string;
    name: string;
    role: string;
    isPartner?: boolean;
  };
  rationale: string;
  tasks: Task[];
  workstreamLookup: (id: string) => string | null;
  deliverableLookup: (id: string) => string | null;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void;
  onRemoveTask: (taskId: string) => void;
  onAddTask: (title: string) => void;
}

function PersonProposal({
  person,
  rationale,
  tasks,
  workstreamLookup,
  deliverableLookup,
  onUpdateTask,
  onRemoveTask,
  onAddTask,
}: PersonProposalProps) {
  const [newTask, setNewTask] = useState("");
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback>{initials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <CardTitle className="text-base">{person.name}</CardTitle>
              <span className="text-xs text-foreground-subtle">·</span>
              <span className="text-xs text-foreground-muted">{person.role}</span>
            </div>
            <p className="text-xs text-foreground-muted leading-relaxed italic">
              {rationale}
            </p>
          </div>
          <Badge variant="accent" className="font-mono shrink-0">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-xs text-foreground-subtle italic py-3 text-center border border-dashed border-border rounded-md">
            No tasks proposed. Add one below or skip this person.
          </div>
        ) : (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              workstreamName={
                task.workstreamId ? workstreamLookup(task.workstreamId) : null
              }
              deliverableTitle={
                task.deliverableId ? deliverableLookup(task.deliverableId) : null
              }
              onUpdate={(patch) => onUpdateTask(task.id, patch)}
              onRemove={() => onRemoveTask(task.id)}
            />
          ))
        )}

        {adding ? (
          <div className="flex gap-2 fade-in-up">
            <Input
              autoFocus
              value={newTask}
              placeholder="Add a task…"
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTask.trim()) {
                  onAddTask(newTask);
                  setNewTask("");
                  setAdding(false);
                }
                if (e.key === "Escape") {
                  setNewTask("");
                  setAdding(false);
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (newTask.trim()) {
                  onAddTask(newTask);
                  setNewTask("");
                  setAdding(false);
                }
              }}
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNewTask("");
                setAdding(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full text-left text-xs text-foreground-subtle hover:text-foreground inline-flex items-center gap-1.5 py-1.5 px-2 rounded transition-colors hover:bg-background-soft"
          >
            <Plus className="h-3 w-3" />
            Add another task
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// --- single task row --------------------------------------------------------

interface TaskRowProps {
  task: Task;
  workstreamName: string | null;
  deliverableTitle: string | null;
  onUpdate: (patch: Partial<Task>) => void;
  onRemove: () => void;
}

function TaskRow({
  task,
  workstreamName,
  deliverableTitle,
  onUpdate,
  onRemove,
}: TaskRowProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description ?? "");

  const priorityStyle = PRIORITY_STYLES[task.priority];
  const cyclePriority = () => {
    const order: TaskPriority[] = ["low", "medium", "high"];
    const next = order[(order.indexOf(task.priority) + 1) % order.length];
    onUpdate({ priority: next });
  };

  return (
    <div className="group rounded-md border border-border bg-background-soft/30 hover:border-border-strong hover:bg-background-soft/60 transition-colors p-3">
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-foreground-subtle opacity-0 group-hover:opacity-100 mt-1 shrink-0 cursor-grab" />

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Title row — title on the left, priority pill vertically centered
              with it on the right, then the remove button. */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {editingTitle ? (
                <Input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (titleDraft.trim()) onUpdate({ title: titleDraft.trim() });
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setTitleDraft(task.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="h-8 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="text-sm font-medium text-foreground text-left w-full hover:text-accent transition-colors"
                >
                  {task.title}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={cyclePriority}
              title="Cycle priority"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors shrink-0",
                priorityStyle.classes
              )}
            >
              <AlertCircle className="h-2.5 w-2.5" />
              {priorityStyle.label}
            </button>

            <button
              type="button"
              onClick={onRemove}
              className="text-foreground-subtle hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              title="Remove task"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Description — only show if present or editing */}
          {editingDesc ? (
            <Textarea
              autoFocus
              value={descDraft}
              rows={2}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => {
                onUpdate({ description: descDraft.trim() || undefined });
                setEditingDesc(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDescDraft(task.description ?? "");
                  setEditingDesc(false);
                }
              }}
              className="text-xs"
            />
          ) : task.description ? (
            <button
              type="button"
              onClick={() => setEditingDesc(true)}
              className="text-xs text-foreground-muted leading-relaxed text-left w-full hover:text-foreground transition-colors"
            >
              {task.description}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingDesc(true)}
              className="text-xs text-foreground-subtle italic hover:text-foreground transition-colors"
            >
              + add description
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
