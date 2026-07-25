"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  FileText,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Lightbulb,
  Mail,
  History,
  Play,
  Download,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type DeliveryPool,
  type DeliveryUrgency,
} from "@/lib/api";
import {
  draftFile,
  iterateFile,
  downloadFile,
  MAX_ITERATIONS,
  type DeliveryFile,
} from "@/lib/delivery-mock";

type Status = "open" | "configuring" | "drafting" | "review" | "done";
type Kind = "todo" | "suggestion";

// A persisted record of work started / delivered / emailed, so it stays visible
// across reloads (localStorage; moves server-side when the real agent lands).
type ActionKind = "started" | "delivered" | "emailed";
interface Activity {
  id: string;
  ts: string;
  action: ActionKind;
  title: string;
  detail?: string;
}
const ACTIVITY_KEY = "iota_delivery_activity";

interface ItemView {
  id: string;
  title: string;
  context: string;
  source: string;
  suggested_ask: string;
  due_in_hours?: number;
  urgency?: DeliveryUrgency;
  kind: Kind;
  status: Status;
  files: DeliveryFile[];
  askDraft: string;
  feedback: string[];
}

const URGENCY: Record<
  DeliveryUrgency,
  { variant: "destructive" | "warning" | "accent"; rail: string }
> = {
  critical: { variant: "destructive", rail: "bg-destructive" },
  soon: { variant: "warning", rail: "bg-warning" },
  today: { variant: "accent", rail: "bg-accent" },
};

function dueLabel(h: number): string {
  return h <= 0 ? "overdue" : `due in ${h}h`;
}

function agoLabel(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

const toItems = (pool: DeliveryPool): ItemView[] => {
  const base = (kind: Kind) => (t: {
    id: string;
    title: string;
    context: string;
    source: string;
    suggested_ask: string;
    due_in_hours?: number;
    urgency?: DeliveryUrgency;
  }): ItemView => ({
    ...t,
    kind,
    status: "open",
    files: [],
    askDraft: t.suggested_ask,
    feedback: [],
  });
  return [
    ...(pool.todos ?? []).map(base("todo")),
    ...(pool.suggestions ?? []).map(base("suggestion")),
  ];
};

/**
 * The Delivery tab. Two sections: "To-dos" (actions due in the next 24h — a real
 * brain inference, refreshed every ~3h + on demand) and "Suggested next steps"
 * (proactive ways to move work forward, always present so the tab is useful even
 * when nothing is strictly due). Any item can be delegated to Indigo Iota, which
 * drafts a file the user reviews + iterates on (up to 5×) and approves. The pool
 * is real; file drafting/iteration is simulated this phase (lib/delivery-mock).
 */
export function DeliveryTab({ onAuthError }: { onAuthError: (e: ApiError) => void }) {
  const [items, setItems] = useState<ItemView[] | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"agenda" | "timeline">("agenda");
  const [modal, setModal] = useState<{ id: string; version: number } | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);

  // Hydrate the activity log from localStorage so started/done work persists.
  // Collapse to one row per task (keeps the latest, since stored latest-first) —
  // this also heals any multi-row history written by an earlier build.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACTIVITY_KEY);
      if (!raw) return;
      const seen = new Set<string>();
      const deduped = (JSON.parse(raw) as Activity[]).filter((a) => {
        if (seen.has(a.title)) return false;
        seen.add(a.title);
        return true;
      });
      setActivity(deduped);
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(deduped));
    } catch {
      /* ignore corrupt/absent storage */
    }
  }, []);

  const logActivity = useCallback(
    (action: ActionKind, title: string, detail?: string) => {
      setActivity((prev) => {
        // One row per task: replace any existing entry for this title and move it
        // to the top, so the log reads as one line per task at its latest state.
        const entry: Activity = {
          id: title,
          ts: new Date().toISOString(),
          action,
          title,
          detail,
        };
        const next = [entry, ...prev.filter((a) => a.title !== title)].slice(0, 100);
        try {
          localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const apply = useCallback((pool: DeliveryPool) => {
    setItems(toItems(pool));
    setRefreshedAt(pool.refreshed_at);
  }, []);

  const handleErr = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load your delivery queue.");
    },
    [onAuthError],
  );

  useEffect(() => {
    (async () => {
      try {
        apply(await api.delivery());
      } catch (e) {
        handleErr(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [apply, handleErr]);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      apply(await api.refreshDelivery());
    } catch (e) {
      handleErr(e);
    } finally {
      setSyncing(false);
    }
  }

  const patch = (id: string, next: Partial<ItemView>) =>
    setItems((cur) => cur?.map((t) => (t.id === id ? { ...t, ...next } : t)) ?? cur);
  const get = (id: string) => items?.find((t) => t.id === id);

  async function approveAsk(id: string) {
    const t = get(id);
    if (!t) return;
    patch(id, { status: "drafting" });
    logActivity("started", t.title, "Indigo Iota started the deliverable");
    // Mark it acted-on server-side so the next regeneration (Sync / 3h cadence)
    // won't re-surface it and fills the slot with a different next step.
    void api.dismissDelivery(t.title).catch(() => {});
    const file = await draftFile(t);
    patch(id, { status: "review", files: [file] });
  }

  async function sendFeedback(id: string, text: string) {
    const t = get(id);
    if (!t || t.files.length >= MAX_ITERATIONS) return;
    const file = await iterateFile(t, t.files);
    patch(id, { files: [...t.files, file], feedback: [...t.feedback, text] });
    setModal(null);
  }

  function approveFile(id: string) {
    const t = get(id);
    patch(id, { status: "done" });
    if (t) {
      const latest = t.files[t.files.length - 1];
      logActivity("delivered", t.title, latest ? `Approved ${latest.name}` : undefined);
      // Completing writes a dated, self-reported entry back to the brain (and
      // stops re-surfacing it), so Q&A and the next agenda pull know it's done.
      void api.completeDelivery(t.title).catch(() => {});
    }
    setModal(null);
  }

  const todos = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.kind === "todo")
        .sort((a, b) => (a.due_in_hours ?? 99) - (b.due_in_hours ?? 99)),
    [items],
  );
  const suggestions = useMemo(
    () => (items ?? []).filter((i) => i.kind === "suggestion"),
    [items],
  );

  if (loading) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <span className="text-sm">Loading your delivery queue…</span>
        </div>
      </Card>
    );
  }

  const modalItem = modal ? get(modal.id) : undefined;
  const modalFile = modalItem?.files.find((f) => f.version === modal?.version);
  const nothingAtAll = todos.length === 0 && suggestions.length === 0;

  const card = (t: ItemView) => (
    <TodoCard
      key={t.id}
      item={t}
      onConfigure={() => patch(t.id, { status: "configuring" })}
      onCancel={() => patch(t.id, { status: "open", askDraft: t.suggested_ask })}
      onAskChange={(v) => patch(t.id, { askDraft: v })}
      onApproveAsk={() => approveAsk(t.id)}
      onOpenFile={(version) => setModal({ id: t.id, version })}
    />
  );

  return (
    <div className="space-y-5">
      {/* Header: freshness + sync-now + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-foreground-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> refreshed {agoLabel(refreshedAt)} · auto every 3h
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={sync}
            disabled={syncing}
            className="w-[112px] justify-center overflow-hidden"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            <span>{syncing ? "Syncing" : "Sync now"}</span>
          </Button>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {(["agenda", "timeline"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-xs capitalize transition-colors",
                view === v
                  ? "bg-background-soft text-foreground"
                  : "text-foreground-subtle hover:bg-background-soft/50",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {nothingAtAll ? (
        <Card className="flex h-[420px] items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <ClipboardCheck className="h-7 w-7 text-foreground-subtle" />
            <p className="text-sm font-medium text-foreground">Nothing to surface right now</p>
            <p className="text-xs leading-relaxed text-foreground-muted">
              Indigo Iota checks your brain every 3 hours for action-due to-dos and
              ways to move work forward. Try Sync now, or check back shortly.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* ---- To-dos ---- */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">To-dos</h2>
              <Badge variant="outline" className="text-[10px]">
                next 24h
              </Badge>
            </div>
            {view === "timeline" ? (
              todos.length > 0 ? (
                <TimelineView items={todos} />
              ) : (
                <p className="text-xs text-foreground-subtle">Nothing strictly due in the next 24 hours.</p>
              )
            ) : todos.length > 0 ? (
              todos.map(card)
            ) : (
              <p className="text-xs text-foreground-subtle">
                Nothing strictly due in the next 24 hours — see suggested next steps below.
              </p>
            )}
          </section>

          {/* ---- Suggested next steps ---- */}
          {suggestions.length > 0 && (
            <section className="space-y-2.5 border-t border-border/50 pt-5">
              <div>
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-accent" />
                  <h2 className="text-sm font-semibold text-foreground">Suggested next steps</h2>
                </div>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  Proactive ways to move different lines of work forward — not deadlines.
                </p>
              </div>
              {suggestions.map(card)}
            </section>
          )}
        </>
      )}

      {/* ---- Activity log (persisted, latest first) ---- */}
      {activity.length > 0 && <ActivityLog activity={activity} />}

      <Dialog open={modal !== null} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-3xl">
          {modalItem && modalFile && (
            <ReviewBody
              item={modalItem}
              file={modalFile}
              onSend={(text) => sendFeedback(modalItem.id, text)}
              onApprove={() => approveFile(modalItem.id)}
              onEmailed={(to, subject) =>
                logActivity("emailed", modalItem.title, `${modalFile.name} → ${to} · “${subject}”`)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ACTION_META: Record<ActionKind, { icon: typeof Play; label: string; cls: string }> = {
  started: { icon: Play, label: "started", cls: "text-accent" },
  delivered: { icon: CircleCheck, label: "delivered", cls: "text-success" },
  emailed: { icon: Mail, label: "emailed", cls: "text-foreground-muted" },
};

function ActivityLog({ activity }: { activity: Activity[] }) {
  // Final guarantee: one row per task, whatever is in state/storage. Keeps the
  // first occurrence per title (the list is latest-first).
  const seen = new Set<string>();
  const rows = activity.filter((a) => {
    const key = (a.title || "").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <section className="border-t border-border/50 pt-5">
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <span className="text-xs text-foreground-subtle">one line per task · latest first</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((a) => {
          const m = ACTION_META[a.action];
          const Icon = m.icon;
          return (
            <li key={a.id} className="flex items-start gap-2 text-xs">
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", m.cls)} />
              <span className="min-w-0 flex-1 text-foreground-muted">
                <span className="font-medium text-foreground">{a.title}</span> — {m.label}
                {a.detail ? <span className="text-foreground-subtle"> · {a.detail}</span> : null}
              </span>
              <span className="shrink-0 text-foreground-subtle">{agoLabel(a.ts)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function TodoCard({
  item,
  onConfigure,
  onCancel,
  onAskChange,
  onApproveAsk,
  onOpenFile,
}: {
  item: ItemView;
  onConfigure: () => void;
  onCancel: () => void;
  onAskChange: (v: string) => void;
  onApproveAsk: () => void;
  onOpenFile: (version: number) => void;
}) {
  const isSug = item.kind === "suggestion";
  const u = item.urgency ? URGENCY[item.urgency] : null;
  const rail = isSug ? "bg-accent/30" : u?.rail ?? "bg-accent";
  return (
    <div className="flex overflow-hidden rounded-lg border border-border/60 bg-background-soft/30">
      <div className={cn("w-1 shrink-0", rail)} />
      <div className="min-w-0 flex-1 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isSug ? (
                <Badge variant="accent" className="gap-1">
                  <Lightbulb className="h-3 w-3" /> next step
                </Badge>
              ) : (
                <Badge variant={u?.variant ?? "accent"}>{dueLabel(item.due_in_hours ?? 24)}</Badge>
              )}
              <span className="text-sm font-medium text-foreground">{item.title}</span>
            </div>
            {item.context && (
              <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{item.context}</p>
            )}
            {item.source && (
              <p className="mt-1 text-[11px] text-foreground-subtle">{item.source}</p>
            )}
            {item.files.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {item.files.map((f, i) => {
                  const latest = i === item.files.length - 1 && item.files.length > 1;
                  return (
                    <button
                      key={f.version}
                      type="button"
                      onClick={() => onOpenFile(f.version)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-background-soft",
                        latest
                          ? "border-accent/40 bg-accent/5 text-accent"
                          : "border-border/60 bg-background-soft/40 text-foreground",
                      )}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {f.name}
                      {latest ? " · latest" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="shrink-0">
            {item.status === "open" && (
              <Button size="sm" onClick={onConfigure}>
                <Sparkles className="h-3.5 w-3.5" /> Deliver with Indigo Iota
              </Button>
            )}
            {item.status === "drafting" && (
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground-subtle">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Drafting…
              </span>
            )}
            {item.status === "done" && (
              <Badge variant="success" className="gap-1">
                <CircleCheck className="h-3 w-3" /> delivered
              </Badge>
            )}
          </div>
        </div>

        {item.status === "configuring" && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <p className="mb-1.5 text-xs text-foreground-muted">
              <Sparkles className="mr-1 inline h-3.5 w-3.5" />
              Indigo Iota suggests this ask for itself — adjust or approve:
            </p>
            <Textarea
              value={item.askDraft}
              onChange={(e) => onAskChange(e.target.value)}
              className="min-h-[64px] text-sm"
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={onApproveAsk} disabled={!item.askDraft.trim()}>
                <CircleCheck className="h-3.5 w-3.5" /> Approve &amp; generate
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewBody({
  item,
  file,
  onSend,
  onApprove,
  onEmailed,
}: {
  item: ItemView;
  file: DeliveryFile;
  onSend: (text: string) => void;
  onApprove: () => void;
  onEmailed: (to: string, subject: string) => void;
}) {
  const [text, setText] = useState("");
  const [iterating, setIterating] = useState(false);
  const [mode, setMode] = useState<"review" | "email">("review");
  const maxed = item.files.length >= MAX_ITERATIONS;

  async function sendFeedback() {
    if (!text.trim() || maxed) return;
    setIterating(true);
    await onSend(text.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-accent" />
          {file.name}
          <span className="text-xs font-normal text-foreground-subtle">
            · iteration {file.version} of up to {MAX_ITERATIONS}
          </span>
        </DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_260px]">
        {/* File preview */}
        <div className="rounded-md border border-border/60 bg-background-soft/30 p-4">
          <div className="min-h-[300px] rounded-md border border-border/60 bg-background p-5 text-sm leading-relaxed">
            <p className="font-medium">
              {item.title} {file.version > 1 ? `(v${file.version} — feedback applied)` : ""}
            </p>
            <p className="mt-3 whitespace-pre-wrap text-foreground-muted">{item.askDraft}</p>
            <p className="mt-4 text-xs italic text-foreground-subtle">
              Preview is illustrative — file generation is simulated in this phase.
            </p>
          </div>
        </div>

        {/* Right pane: review (feedback + approve + email) OR the email composer */}
        {mode === "review" ? (
          <div className="flex flex-col">
            <p className="mb-2 text-xs text-foreground-muted">Feedback</p>
            <div className="mb-2 flex-1 space-y-1.5 text-xs">
              {item.feedback.length === 0 ? (
                <p className="text-foreground-subtle">No feedback yet.</p>
              ) : (
                item.feedback.map((f, i) => (
                  <p key={i} className="text-foreground-muted">
                    &ldquo;{f}&rdquo; ✓ applied
                  </p>
                ))
              )}
            </div>
            {maxed ? (
              <p className="mb-2 text-xs text-foreground-subtle">
                Reached the max of {MAX_ITERATIONS} iterations.
              </p>
            ) : (
              <Textarea
                value={text}
                disabled={iterating}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Make the opening warmer…"
                className="min-h-[60px] text-sm"
              />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={sendFeedback}
                disabled={iterating || maxed || !text.trim()}
              >
                {iterating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {iterating ? "Iterating…" : "Send feedback"}
              </Button>
              <Button size="sm" onClick={onApprove} disabled={iterating}>
                <CircleCheck className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadFile(file)} disabled={iterating}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("email")} disabled={iterating}>
                <Mail className="h-3.5 w-3.5" /> Email
              </Button>
            </div>
          </div>
        ) : (
          <EmailComposer
            file={file}
            defaultSubject={item.title}
            onCancel={() => setMode("review")}
            onOpened={(to, subject) => {
              onEmailed(to, subject);
              setMode("review");
            }}
          />
        )}
      </div>
    </>
  );
}

function EmailComposer({
  file,
  defaultSubject,
  onCancel,
  onOpened,
}: {
  file: DeliveryFile;
  defaultSubject: string;
  onCancel: () => void;
  onOpened: (to: string, subject: string) => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached "${file.name}".\n\nBest regards`,
  );
  // To is optional — they can fill it in their mail app; subject just needs text.
  const valid = subject.trim().length > 0 && (!to.trim() || EMAIL_RE.test(to.trim()));

  function openInMailApp() {
    if (!valid) return;
    // mailto can't carry an attachment, so download the file first — the user
    // drags it into the draft. (Real server-side send-with-attachment needs
    // Microsoft Graph Mail.Send, which we don't have yet.)
    downloadFile(file);
    const url =
      `mailto:${encodeURIComponent(to.trim())}` +
      `?subject=${encodeURIComponent(subject.trim())}` +
      `&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    onOpened(to.trim(), subject.trim());
  }

  const field = "h-8 text-sm";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Email this</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-foreground-subtle hover:text-foreground"
        >
          ← Back
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        Downloads the file and opens a prefilled draft in your own email app —
        drag the downloaded file into the draft, then send from your mailbox.
        (Email apps can&rsquo;t be handed an attachment automatically.)
      </p>
      <label className="text-[11px] text-foreground-subtle">
        To
        <Input
          type="email"
          value={to}
          placeholder="recipient@email.com"
          onChange={(e) => setTo(e.target.value)}
          className={cn(field, "mt-0.5")}
        />
      </label>
      <label className="text-[11px] text-foreground-subtle">
        Subject
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={cn(field, "mt-0.5")}
        />
      </label>
      <label className="text-[11px] text-foreground-subtle">
        Message
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-0.5 min-h-[90px] text-sm"
        />
      </label>
      <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background-soft/40 px-2.5 py-1.5 text-xs text-foreground">
        <FileText className="h-3.5 w-3.5 text-accent" /> {file.name}
        <span className="text-foreground-subtle">— downloads, then attach in your mail app</span>
      </div>
      <Button size="sm" className="justify-center" onClick={openInMailApp} disabled={!valid}>
        <Mail className="h-3.5 w-3.5" /> Download &amp; open email
      </Button>
    </div>
  );
}

function TimelineView({ items }: { items: ItemView[] }) {
  return (
    <Card className="p-4">
      <div className="space-y-2">
        {items.map((t) => {
          const u = t.urgency ? URGENCY[t.urgency] : null;
          const h = t.due_in_hours ?? 24;
          const left = Math.min(96, (h / 24) * 100);
          return (
            <div key={t.id} className="flex items-center gap-3">
              <div className="w-40 shrink-0 truncate text-xs text-foreground" title={t.title}>
                {t.title}
              </div>
              <div className="relative h-5 flex-1 rounded-md bg-background-soft">
                <div
                  className={cn(
                    "absolute top-0 flex h-5 min-w-[3rem] -translate-x-full items-center justify-center rounded-md px-1.5 text-[11px] text-white",
                    u?.rail ?? "bg-accent",
                  )}
                  style={{ left: `${left}%` }}
                >
                  {h}h
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-border/50 pt-2 text-[11px] text-foreground-subtle">
        <span>now</span>
        <span>+6h</span>
        <span>+12h</span>
        <span>+18h</span>
        <span>+24h</span>
      </div>
    </Card>
  );
}
