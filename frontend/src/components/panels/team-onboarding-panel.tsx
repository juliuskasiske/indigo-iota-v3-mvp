"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  UserPlus,
  Sparkles,
  Loader2,
  Mail,
  CheckCircle2,
  Copy,
  Check,
  Send,
  Inbox,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { onboardingExamples } from "@/lib/mock/data";
import { cn, initials, sleep } from "@/lib/utils";
import type { Project } from "@/lib/mock/types";

type Stage = "form" | "generating" | "ready" | "sent";

const workstreamFallback = "ws_regulatory";

export function TeamOnboardingPanel({ project }: { project: Project }) {
  const [stage, setStage] = useState<Stage>("form");
  const [workstreamId, setWorkstreamId] = useState<string>(project.workstreams[0]?.id ?? "");
  const [newHireName, setNewHireName] = useState("Léa Martin");
  const [newHireEmail, setNewHireEmail] = useState("lea.martin@meridianstrategy.com");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage === "generating" && outputRef.current) {
      outputRef.current.scrollTo({
        top: outputRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [output, stage]);

  const generate = async () => {
    const key = onboardingExamples[workstreamId] ? workstreamId : workstreamFallback;
    const example = onboardingExamples[key];
    // Replace the canned name with whatever the user typed
    const doc = example.doc.replace(/Léa Martin/g, newHireName).replace(/Léa/g, newHireName.split(" ")[0]);

    setStage("generating");
    setOutput("");

    const tokens = doc.split(/(\s+)/);
    let acc = "";
    for (const token of tokens) {
      acc += token;
      setOutput(acc);
      await sleep(6 + Math.random() * 14);
    }
    setStage("ready");
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    setStage("sent");
  };

  const selectedWorkstream = project.workstreams.find((w) => w.id === workstreamId);
  const selectedWorkstreamOwner = project.team.find(
    (p) => p.id === selectedWorkstream?.owner
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
      <div className="space-y-5">
        {/* Header */}
        <Card className="p-5 bg-gradient-to-br from-background-elevated/80 to-primary/5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold mb-1">
                Onboard a new team member
              </h2>
              <p className="text-sm text-foreground-muted leading-relaxed">
                Pick a workstream and a new hire. Iota will compile their onboarding
                brief from the project brain — context, decisions, open questions, and
                first-week priorities — then subscribe their inbox so the graph keeps
                growing.
              </p>
            </div>
          </div>
        </Card>

        {/* Form / preview */}
        {stage === "form" && (
          <Card className="p-6">
            <div className="space-y-5">
              <div>
                <Label className="block mb-2">1. Which workstream are they owning?</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {project.workstreams.map((ws) => {
                    const isSelected = workstreamId === ws.id;
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => setWorkstreamId(ws.id)}
                        className={cn(
                          "text-left rounded-md border p-3 transition-all",
                          isSelected
                            ? "border-accent bg-accent/5"
                            : "border-border bg-background-soft/30 hover:border-border-strong hover:bg-background-elevated"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-sm font-medium">{ws.name}</div>
                          {isSelected && (
                            <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-foreground-subtle">
                          Currently owned by{" "}
                          <span className="text-foreground-muted">
                            {project.team.find((p) => p.id === ws.owner)?.name ?? "—"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="hire-name" className="block mb-1.5">
                    2. New team member name
                  </Label>
                  <Input
                    id="hire-name"
                    value={newHireName}
                    onChange={(e) => setNewHireName(e.target.value)}
                    placeholder="Léa Martin"
                  />
                </div>
                <div>
                  <Label htmlFor="hire-email" className="block mb-1.5">
                    Email
                  </Label>
                  <Input
                    id="hire-email"
                    type="email"
                    value={newHireEmail}
                    onChange={(e) => setNewHireEmail(e.target.value)}
                    placeholder="lea.martin@meridianstrategy.com"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between">
                <div className="text-xs text-foreground-muted leading-relaxed max-w-md">
                  Iota will compile the brief from the project brain and start
                  syncing{" "}
                  <span className="font-mono text-foreground">{newHireEmail}</span>
                  &apos;s email, Slack DMs, and shared files into the project.
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={generate}
                  disabled={!workstreamId || !newHireName || !newHireEmail}
                >
                  <Sparkles className="h-4 w-4" />
                  Generate onboarding brief
                </Button>
              </div>
            </div>
          </Card>
        )}

        {(stage === "generating" || stage === "ready" || stage === "sent") && (
          <Card className="overflow-hidden fade-in-up">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background-soft/40">
              <div className="flex items-center gap-2 text-xs text-foreground-muted min-w-0">
                <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="truncate">
                  Onboarding brief for{" "}
                  <span className="text-foreground">{newHireName}</span>
                </span>
                <span className="text-foreground-subtle">·</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {selectedWorkstream?.name}
                </Badge>
                {stage === "generating" && (
                  <span className="inline-flex items-center gap-1 text-accent shrink-0">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    streaming
                  </span>
                )}
              </div>
              {stage !== "generating" && (
                <div className="flex items-center gap-2 shrink-0">
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
                  <Button variant="ghost" size="sm" onClick={() => setStage("form")}>
                    Start over
                  </Button>
                </div>
              )}
            </div>

            <div
              ref={outputRef}
              className="p-6 max-h-[600px] overflow-y-auto prose-iota text-sm"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
              {stage === "generating" && (
                <span className="inline-block w-2 h-4 bg-accent ml-0.5 align-middle animate-pulse" />
              )}
            </div>

            {stage === "ready" && (
              <div className="border-t border-border bg-background-soft/40 px-5 py-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
                  <div className="flex items-start gap-3">
                    <Inbox className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        Ready to subscribe{" "}
                        <span className="font-mono">{newHireEmail}</span>
                      </div>
                      <div className="text-xs text-foreground-muted mt-0.5">
                        On send, Iota will OAuth into their inbox and start
                        scanning for Lattice Pay-relevant emails immediately.
                      </div>
                    </div>
                  </div>
                  <Button variant="primary" onClick={handleSend}>
                    <Send className="h-4 w-4" />
                    Send & subscribe inbox
                  </Button>
                </div>
              </div>
            )}

            {stage === "sent" && (
              <div className="border-t border-border bg-success/10 px-5 py-4 flex items-start gap-3 fade-in-up">
                <div className="h-10 w-10 rounded-full bg-success/20 flex items-center justify-center shrink-0 pulse-glow">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    Done — onboarding sent & inbox subscribed
                  </div>
                  <ul className="mt-2 text-xs text-foreground-muted space-y-1 leading-relaxed">
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-success" />
                      Email delivered to{" "}
                      <span className="font-mono text-foreground">{newHireEmail}</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-success" />
                      OAuth invite queued — they&apos;ll see a one-click connect link in
                      their inbox
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-success" />
                      Once connected, last 14 days of email backfill will run automatically
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-success" />
                      {selectedWorkstreamOwner?.name ?? "Workstream owner"} CC&apos;d
                      for context
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-foreground-subtle mb-3">
            What goes in the brief
          </div>
          <ul className="space-y-2.5 text-xs text-foreground-muted leading-relaxed">
            <Tip>Project context — what, why, who, by when.</Tip>
            <Tip>
              State of their workstream — locked decisions, in-flight work, open
              questions.
            </Tip>
            <Tip>
              Key people to know — outgoing owner, manager, client contacts.
            </Tip>
            <Tip>
              Cultural notes on the client — pulled from email patterns over the
              engagement.
            </Tip>
            <Tip>A specific first-week plan they can act on Monday.</Tip>
          </ul>
        </Card>

        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-foreground-subtle mb-2">
            Already on the team
          </div>
          <div className="space-y-2">
            {project.team.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <div className="h-6 w-6 rounded-full bg-background-soft flex items-center justify-center text-[9px] font-mono shrink-0">
                  {initials(p.name)}
                </div>
                <span className="text-foreground truncate">{p.name}</span>
                <span className="inline-flex h-1 w-1 rounded-full bg-success ml-auto shrink-0" />
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border text-[10px] text-foreground-subtle leading-relaxed">
            Iota is in sync with {project.team.length} consultants&apos; email, Slack,
            and shared files for this engagement. Adding a teammate brings the{" "}
            {project.team.length + 1}th into the loop.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <ArrowRight className="h-3 w-3 text-accent mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
