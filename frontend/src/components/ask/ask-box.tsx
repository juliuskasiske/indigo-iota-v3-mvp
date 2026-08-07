"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  ArrowUp,
  Network,
  Search,
  Loader2,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/ask/markdown";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type QaAnswer,
  type QaSource,
  type QaQuestionSummary,
} from "@/lib/api";

/**
 * The "Ask your brain" Q&A surface: a question box + recent-questions sidebar +
 * the cited answer. Extracted from the old Ask page so the unified dashboard can
 * render it as the "Ask" tab. `onCited` lifts the cited entity ids so the Graph
 * tab can spotlight them; `onViewInGraph` switches to the Graph tab.
 */
export function AskBox({
  onAuthError,
  onCited,
  onViewInGraph,
}: {
  onAuthError: (reason: string) => void;
  onCited: (ids: string[]) => void;
  onViewInGraph: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QaAnswer | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QaQuestionSummary[]>([]);

  const handleAuth = useCallback(
    (e: ApiError) => {
      onAuthError(
        e.status === 403
          ? "Your session lacks access to this workspace. Sign in again."
          : "Your session expired. Please sign in again.",
      );
    },
    [onAuthError],
  );

  const liftCited = useCallback(
    (sources: QaSource[]) => {
      onCited(
        Array.from(
          new Set(
            sources
              .map((s) => s.entity_id)
              .filter((id): id is number => id != null)
              .map((id) => String(id)),
          ),
        ),
      );
    },
    [onCited],
  );

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.questions();
      setHistory(res.questions);
    } catch {
      // History is non-critical; a failure shouldn't block asking.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setAsked(q);
    try {
      const res = await api.ask(q);
      setResult(res);
      liftCited(res.sources);
      void loadHistory();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        handleAuth(e);
        return;
      }
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Replay a past question from history — renders the stored answer + sources
  // with no LLM/retrieval cost.
  async function openQuestion(id: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const q = await api.question(id);
      setAsked(q.question);
      setQuestion(q.question);
      setResult({ question_id: q.id, answer: q.answer, sources: q.sources });
      liftCited(q.sources);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        handleAuth(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load that question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      {/* History sidebar */}
      <aside className="order-2 md:order-1">
        <p className="mb-2 flex items-center gap-1.5 text-xs text-foreground-subtle">
          <History className="h-3.5 w-3.5" />
          Recent
        </p>
        {history.length === 0 ? (
          <p className="text-xs leading-relaxed text-foreground-subtle">
            Your asked questions show up here — click one to replay its answer.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => openQuestion(h.id)}
                  className={cn(
                    "w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                    result?.question_id === h.id
                      ? "bg-accent/10 text-foreground"
                      : "text-foreground-muted hover:bg-background-soft/60 hover:text-foreground",
                  )}
                  title={h.question}
                >
                  {h.question}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Ask + answer */}
      <div className="order-1 max-w-3xl space-y-5 md:order-2">
        <div className="relative">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
            }}
            placeholder="e.g. What did we promise the customer about the Q3 rollout?"
            className="min-h-[96px] pr-12"
            disabled={busy}
          />
          <Button
            size="icon"
            className="absolute bottom-3 right-3 h-8 w-8 rounded-full"
            onClick={ask}
            disabled={busy || !question.trim()}
            title="Ask (⌘/Ctrl + Enter)"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-foreground-subtle">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching the brain and writing an answer…
          </p>
        )}

        {result && !busy && (
          <Answer asked={asked} result={result} onViewInGraph={onViewInGraph} />
        )}
      </div>
    </div>
  );
}

function Answer({
  asked,
  result,
  onViewInGraph,
}: {
  asked: string | null;
  result: QaAnswer;
  onViewInGraph: () => void;
}) {
  const citedCount = new Set(
    result.sources.map((s) => s.entity_id).filter((id) => id != null),
  ).size;

  return (
    <div className="space-y-4">
      {asked && (
        <p className="text-sm font-medium text-foreground-muted">{asked}</p>
      )}
      <Card>
        <CardContent className="pt-5">
          <Markdown>{result.answer}</Markdown>
        </CardContent>
      </Card>

      {result.sources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-foreground-subtle">
              Sources
            </p>
            {citedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-accent"
                onClick={onViewInGraph}
              >
                <Network className="h-3.5 w-3.5" />
                Show in graph
              </Button>
            )}
          </div>
          <ol className="space-y-2">
            {result.sources.map((s, i) => (
              <SourceRow key={i} index={i + 1} source={s} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SourceRow({ index, source }: { index: number; source: QaSource }) {
  // A source with no entity is a Google Drive document chunk (documents live
  // only as chunks, never as graph nodes). Its text is prefixed "<filename>: …",
  // so derive the filename from that prefix to label the reference.
  const isDoc = !source.entity;
  const docName = isDoc
    ? source.text?.split(/:\s/, 1)[0]?.trim() || "Document"
    : null;
  const name = source.entity?.name ?? docName ?? "Untitled";
  const etype = source.entity?.type ?? (isDoc ? "document" : undefined);
  const viaGraph = source.method === "graph_neighbor";
  const isPrincipal = source.method === "principal";

  return (
    <li className="rounded-md border border-border/60 bg-background-soft/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-foreground-subtle">[{index}]</span>
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {etype && (
            <span className="shrink-0 text-[10px] text-foreground-subtle">{etype}</span>
          )}
        </div>
        <Badge
          variant={isPrincipal ? "success" : viaGraph ? "accent" : "default"}
          className="shrink-0"
        >
          {isPrincipal ? (
            <Sparkles className="h-3 w-3" />
          ) : viaGraph ? (
            <Network className="h-3 w-3" />
          ) : (
            <Search className="h-3 w-3" />
          )}
          {isPrincipal ? "center" : viaGraph ? "graph" : "match"}
        </Badge>
      </div>
      {source.text && (
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-foreground-muted">
          {source.text}
        </p>
      )}
    </li>
  );
}
