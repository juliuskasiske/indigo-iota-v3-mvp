"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  Calendar,
  ArrowRight,
  Copy,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  History,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { briefingExamples, DEMO_NOW } from "@/lib/mock/data";
import { cn, initials, sleep } from "@/lib/utils";
import type { Project } from "@/lib/mock/types";

const SUGGESTED_QUESTIONS = [
  {
    label: "What happened on the engagement this week?",
    key: "default",
    icon: Sparkles,
  },
  {
    label: "What's the state of the regulatory workstream?",
    key: "regulatory",
    icon: MessageSquare,
  },
  {
    label: "Are any team members overloaded or blocked?",
    key: "team",
    icon: MessageSquare,
  },
];

const DATE_PRESETS = [
  { label: "This week", days: 7, key: "week" },
  { label: "Last 2 weeks", days: 14, key: "twoweeks" },
  { label: "This month", days: 30, key: "month" },
  { label: "Since kickoff", days: 90, key: "all" },
];

interface BriefingHistory {
  id: string;
  question: string;
  date: string;
  range: string;
}

export function PartnerBriefingPanel({
  project,
  forPartnerName,
}: {
  project: Project;
  /** When invoked from the Team tab on a specific partner, we pre-frame
   *  the briefing for them in the header copy. */
  forPartnerName?: string;
}) {
  const [question, setQuestion] = useState("");
  const [dateRange, setDateRange] = useState("week");
  const [streaming, setStreaming] = useState(false);
  const [output, setOutput] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history] = useState<BriefingHistory[]>([
    {
      id: "h1",
      question: "How are we tracking against the original scope?",
      date: "2 days ago",
      range: "Since kickoff",
    },
    {
      id: "h2",
      question: "Where do I need to weigh in next week?",
      date: "5 days ago",
      range: "This week",
    },
  ]);

  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll while streaming
  useEffect(() => {
    if (streaming && outputRef.current) {
      outputRef.current.scrollTo({
        top: outputRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [output, streaming]);

  const generate = async (key: string, qOverride?: string) => {
    const example = briefingExamples[key] ?? briefingExamples.default;
    setQuestion(qOverride ?? example.question);
    setActiveKey(key);
    setStreaming(true);
    setOutput("");

    // Token-by-token reveal of the canned answer
    const tokens = example.answer.split(/(\s+)/);
    let acc = "";
    for (const token of tokens) {
      acc += token;
      setOutput(acc);
      // tiny jitter so it doesn't feel mechanical
      await sleep(8 + Math.random() * 18);
    }
    setStreaming(false);
  };

  const handleSubmit = () => {
    if (!question.trim() || streaming) return;
    // Pick the canned answer that best matches the question
    const q = question.toLowerCase();
    let key = "default";
    if (q.includes("regul")) key = "regulatory";
    else if (q.includes("team") || q.includes("overload") || q.includes("block"))
      key = "team";
    generate(key, question);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dateRangeLabel =
    DATE_PRESETS.find((p) => p.key === dateRange)?.label ?? "This week";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
      <div className="space-y-5">
        {/* Header context */}
        <Card className="p-5 bg-gradient-to-br from-background-elevated/80 to-accent/5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold mb-1">
                {forPartnerName
                  ? `Briefing for ${forPartnerName}`
                  : "Partner Briefing"}
              </h2>
              <p className="text-sm text-foreground-muted leading-relaxed">
                Ask anything about the engagement. Iota will synthesize an answer
                from the team&apos;s email traffic, decisions, and deliverables —
                with citations back to the source email or document.
              </p>
            </div>
          </div>
        </Card>

        {/* Question input */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-foreground-subtle">
              Your question
            </span>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>

          <Textarea
            placeholder="e.g. What happened on Lattice Pay this week? Anything I should be worried about?"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={streaming}
            className="resize-none mb-3"
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={streaming}
                    onClick={() => generate(s.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                      "border-border bg-background-elevated text-foreground-muted",
                      "hover:text-foreground hover:border-border-strong",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    <Icon className="h-3 w-3 text-accent" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!question.trim() || streaming}
            >
              {streaming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Synthesizing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate briefing
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Output */}
        {(streaming || output) && (
          <Card className="overflow-hidden fade-in-up">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background-soft/40">
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span>
                  Briefing for <span className="text-foreground">{project.name}</span>
                </span>
                <span className="text-foreground-subtle">·</span>
                <Calendar className="h-3 w-3" />
                <span className="font-mono">{dateRangeLabel}</span>
                {streaming && (
                  <span className="ml-2 inline-flex items-center gap-1 text-accent">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    streaming
                  </span>
                )}
              </div>
              {!streaming && output && (
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              )}
            </div>
            <div
              ref={outputRef}
              className="p-6 max-h-[600px] overflow-y-auto prose-iota text-sm"
            >
              {output ? (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
                  {streaming && (
                    <span className="inline-block w-2 h-4 bg-accent ml-0.5 align-middle animate-pulse" />
                  )}
                </>
              ) : (
                <BriefingSkeleton />
              )}
            </div>
            {!streaming && output && (
              <BriefingFooter project={project} />
            )}
          </Card>
        )}

        {!streaming && !output && <BriefingEmptyHint />}
      </div>

      {/* Sidebar — history + tips */}
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-foreground-subtle inline-flex items-center gap-1.5">
              <History className="h-3 w-3" />
              Recent briefings
            </span>
          </div>
          <div className="space-y-2">
            {history.map((h) => (
              <button
                key={h.id}
                className="w-full text-left rounded-md border border-border bg-background-soft/30 hover:bg-background-elevated px-3 py-2 transition-colors"
              >
                <div className="text-xs text-foreground mb-0.5 line-clamp-2">
                  {h.question}
                </div>
                <div className="text-[10px] text-foreground-subtle font-mono">
                  {h.date} · {h.range}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-foreground-subtle mb-2">
            What partners ask
          </div>
          <ul className="space-y-2 text-xs text-foreground-muted leading-relaxed">
            <li>
              <span className="text-foreground">·</span> &ldquo;Where are we vs.
              the original scope?&rdquo;
            </li>
            <li>
              <span className="text-foreground">·</span> &ldquo;What does the client
              actually want from next week?&rdquo;
            </li>
            <li>
              <span className="text-foreground">·</span> &ldquo;Anything I should
              raise with [client exec]?&rdquo;
            </li>
            <li>
              <span className="text-foreground">·</span> &ldquo;Is anyone on the
              team stuck?&rdquo;
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = DATE_PRESETS.find((p) => p.key === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background-elevated px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground hover:border-border-strong transition-colors"
      >
        <Calendar className="h-3 w-3" />
        {current?.label ?? "This week"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-40 rounded-md border border-border-strong bg-background-elevated shadow-xl py-1 fade-in-up">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onChange(p.key);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-background-soft",
                  value === p.key ? "text-accent" : "text-foreground-muted"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BriefingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-1/2 shimmer rounded" />
      <div className="h-3 w-full shimmer rounded" />
      <div className="h-3 w-11/12 shimmer rounded" />
      <div className="h-3 w-3/4 shimmer rounded" />
      <div className="mt-5 h-3 w-2/5 shimmer rounded" />
      <div className="h-3 w-full shimmer rounded" />
    </div>
  );
}

function BriefingFooter({ project }: { project: Project }) {
  return (
    <div className="border-t border-border bg-background-soft/40 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 text-xs text-foreground-muted">
        <span>
          Sourced from{" "}
          <span className="text-foreground font-mono">
            {project.emailsScanned}
          </span>{" "}
          emails ·{" "}
          <span className="text-foreground font-mono">{project.brainPages}</span>{" "}
          brain pages
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm">
          <Mail className="h-3.5 w-3.5" />
          Email to partners
        </Button>
        <Button variant="secondary" size="sm">
          <ArrowRight className="h-3.5 w-3.5" />
          Open in Slack
        </Button>
      </div>
    </div>
  );
}

function BriefingEmptyHint() {
  return (
    <Card className="p-8 text-center border-dashed">
      <div className="mx-auto h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center mb-3">
        <Sparkles className="h-5 w-5 text-accent" />
      </div>
      <h3 className="text-sm font-semibold mb-1">No briefing yet</h3>
      <p className="text-xs text-foreground-muted max-w-md mx-auto">
        Pick a suggested question above, or write your own. Iota will pull from
        emails, decisions, and deliverables to synthesize an answer in seconds.
      </p>
    </Card>
  );
}
