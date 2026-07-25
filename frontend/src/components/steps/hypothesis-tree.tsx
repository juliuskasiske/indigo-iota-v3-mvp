"use client";

import { useState } from "react";
import {
  ChevronRight,
  Mail,
  FileText,
  Package,
  Hash,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Overview — the running tally of what the agent loop is investigating, drawn as
// a hypothesis tree. Branches are hypotheses, leaves are specific initiatives,
// and every node is justified by facts pulled from the brain (emails, quotes,
// orders) with the numbers attached. Illustrative for now (the AcchCo diagnostic).

type Fact = { text: string; source: string; metric?: string };
type HNode = {
  id: string;
  label: string;
  metric?: string;
  status?: "investigating" | "supported";
  facts?: Fact[];
  children?: HNode[];
};

const TREE: HNode = {
  id: "root",
  label: "Recover eroding gross margin in EMEA cargo-handling",
  metric: "€4.1M / €4.0M target",
  status: "investigating",
  facts: [
    {
      text: "Gross margin fell 3.2 points YoY while revenue grew 6% — the gap is margin, not demand.",
      source: "FY24 P&L",
      metric: "−3.2 pts",
    },
  ],
  children: [
    {
      id: "b1",
      label: "Margin is leaking in sales discounting",
      metric: "€2.1M",
      status: "supported",
      children: [
        {
          id: "i1",
          label: "Enforce the discount policy on the Alexandria account",
          metric: "€1.2M",
          status: "supported",
          facts: [
            {
              text: "One rep waived 14% — past the 8% approval cap — across 9 deals.",
              source: "6 emails · 9 quotes",
              metric: "14% vs 8% cap",
            },
            {
              text: "\"I gave Alexandria the extra six points to get it closed before quarter-end.\"",
              source: "email — M. Dempsey · 2024-12-19",
            },
          ],
        },
        {
          id: "i2",
          label: "Re-price three underpriced product lines",
          metric: "€0.9M",
          status: "supported",
          facts: [
            {
              text: "Three SKUs sold 11% below what comparable deals command.",
              source: "quote history · 240 lines",
              metric: "−11%",
            },
          ],
        },
      ],
    },
    {
      id: "b2",
      label: "Cost is leaking in operations",
      metric: "€1.4M",
      status: "supported",
      children: [
        {
          id: "i3",
          label: "Recover demurrage on three lanes",
          metric: "€0.8M / yr",
          status: "supported",
          facts: [
            {
              text: "Demurrage absorbed by us instead of billed to the customer on 3 lanes.",
              source: "40 orders",
              metric: "€0.8M",
            },
          ],
        },
        {
          id: "i4",
          label: "Automate the weekly manifest reconciliation",
          metric: "≈12 hrs / wk",
          status: "investigating",
          facts: [
            {
              text: "\"We redo the manifest reconciliation by hand every week — it's always the same steps.\"",
              source: "email — Ops team · 2025-01-08",
              metric: "~12 hrs / wk",
            },
          ],
        },
      ],
    },
    {
      id: "b3",
      label: "AI can remove repetitive back-office work",
      status: "investigating",
      children: [
        {
          id: "i5",
          label: "Auto-draft repetitive RFQ responses",
          metric: "≈9 hrs / wk",
          status: "investigating",
          facts: [
            {
              text: "\"The same RFQ reply gets retyped for every inbound quote request.\"",
              source: "email — Sales ops",
              metric: "~40 RFQs / mo",
            },
          ],
        },
      ],
    },
  ],
};

function countLeaves(n: HNode): number {
  if (!n.children?.length) return 1;
  return n.children.reduce((s, c) => s + countLeaves(c), 0);
}
function countFacts(n: HNode): number {
  const here = n.facts?.length ?? 0;
  return here + (n.children?.reduce((s, c) => s + countFacts(c), 0) ?? 0);
}

function sourceIcon(source: string) {
  const s = source.toLowerCase();
  if (s.includes("email")) return Mail;
  if (s.includes("order")) return Package;
  return FileText;
}

function FactCard({ fact }: { fact: Fact }) {
  const Icon = sourceIcon(fact.source);
  return (
    <div className="rounded-lg border border-border bg-background-elevated/50 px-3 py-2">
      <p className="text-[13px] leading-snug text-foreground-muted">{fact.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-background-soft px-2 py-0.5 text-[11px] text-foreground-subtle">
          <Icon className="h-3 w-3" />
          {fact.source}
        </span>
        {fact.metric && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Hash className="h-3 w-3" />
            {fact.metric}
          </span>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: HNode; depth: number }) {
  // Top two levels open by default so the shape reads at a glance.
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = !!node.children?.length;
  const hasFacts = !!node.facts?.length;
  const expandable = hasChildren || hasFacts;

  const dot =
    node.status === "investigating"
      ? "bg-amber-400"
      : depth === 0
        ? "bg-accent"
        : "bg-emerald-400";

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
          expandable ? "hover:bg-background-soft" : "cursor-default",
        )}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
            open && "rotate-90",
            !expandable && "opacity-0",
          )}
        />
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        <span
          className={cn(
            "flex-1 text-sm",
            depth === 0
              ? "font-semibold text-foreground"
              : depth === 1
                ? "font-medium text-foreground"
                : "text-foreground",
          )}
        >
          {node.label}
        </span>
        {node.status === "investigating" && (
          <span className="hidden items-center gap-1 text-[11px] text-amber-600 sm:inline-flex dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            investigating
          </span>
        )}
        {node.metric && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            {node.metric}
          </span>
        )}
      </button>

      {open && expandable && (
        <div className="ml-[11px] border-l border-border pl-4">
          {hasFacts && (
            <div className="my-2 space-y-1.5">
              {node.facts!.map((f, i) => (
                <FactCard key={i} fact={f} />
              ))}
            </div>
          )}
          {node.children?.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OverviewPanel() {
  const initiatives = countLeaves(TREE);
  const facts = countFacts(TREE);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span className="text-sm text-foreground">
            Agents investigating — the loop is running
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-foreground-subtle">
          <span>
            <b className="font-semibold text-foreground">{initiatives}</b> initiatives
          </span>
          <span>
            <b className="font-semibold text-foreground">{facts}</b> facts cited
          </span>
          <span>updated just now</span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background/40 p-3">
        <TreeNode node={TREE} depth={0} />
      </div>

      <p className="px-1 text-xs text-foreground-subtle">
        Every branch is a hypothesis and every leaf an initiative — each justified
        by facts pulled straight from the brain, with the numbers attached.
      </p>
    </div>
  );
}
