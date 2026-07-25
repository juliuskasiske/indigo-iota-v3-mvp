"use client";

import {
  Lightbulb,
  ListChecks,
  FlaskConical,
  Calculator,
  Scale,
  Loader2,
  Clock,
  type LucideIcon,
} from "lucide-react";

// Agent Swarm — for now, the roster of agent roles running on the loop, with how
// many instances of each are live. (A live graph of the swarm comes later.)

type AgentRole = {
  key: string;
  name: string;
  Icon: LucideIcon;
  instances: number;
  desc: string;
};

const ROLES: AgentRole[] = [
  {
    key: "hypothesis",
    name: "Hypothesis generation",
    Icon: Lightbulb,
    instances: 2,
    desc: "Reads the hypothesis tree — including which hypotheses were discarded and why — and proposes the next ones worth testing, weighted by the objective function.",
  },
  {
    key: "planning",
    name: "Planning",
    Icon: ListChecks,
    instances: 5,
    desc: 'For a hypothesis, asks "what would need to be true for this to hold?" and works out exactly which data and facts would confirm or kill it. Outputs a step-by-step validation plan.',
  },
  {
    key: "validator",
    name: "Validator",
    Icon: FlaskConical,
    instances: 8,
    desc: "Gathers the required facts and data from the brain — and later, interviews — and runs the plan to validate or discard the hypothesis.",
  },
  {
    key: "sizer",
    name: "Opportunity sizer",
    Icon: Calculator,
    instances: 4,
    desc: "Puts a number on each validated opportunity — the recoverable value, sized from the facts the Validator gathered.",
  },
  {
    key: "judge",
    name: "Judge",
    Icon: Scale,
    instances: 3,
    desc: "Sense-checks every output of every other agent in between, catching weak evidence, logical leaps, and hallucinations before they propagate.",
  },
];

export function AgentSwarmPanel() {
  const total = ROLES.reduce((s, r) => s + r.instances, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span className="text-sm text-foreground">
            <b className="font-semibold">{total}</b> agents running across{" "}
            {ROLES.length} roles
          </span>
        </div>
        <span className="text-xs text-foreground-subtle">
          Hypothesis generation → Planning → Validator → Opportunity sizer, with
          the Judge checking every step
        </span>
      </div>

      <div className="space-y-3">
        {ROLES.map((r) => (
          <div
            key={r.key}
            className="flex gap-4 rounded-xl border border-border bg-background-elevated/60 p-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <r.Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{r.name}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {r.instances} running
                </span>
              </div>
              <p className="mt-1 text-sm leading-snug text-foreground-muted">
                {r.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="px-1 text-xs text-foreground-subtle">
        A live graph of the swarm is coming — for now, the roles and how many of
        each are running.
      </p>
    </div>
  );
}

export function ComingSoon({ blurb }: { blurb?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-elevated/40 px-6 py-16 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Clock className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">Coming soon</p>
      {blurb && (
        <p className="mt-1 max-w-md text-sm text-foreground-muted">{blurb}</p>
      )}
    </div>
  );
}
