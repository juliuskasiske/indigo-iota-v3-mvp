"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Upload,
  Mail,
  MessageSquare,
  Sparkles,
  Network,
  CheckCircle2,
  FileText,
  Brain,
  FolderOpen,
  Trash2,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClientLogo, LOGO_VARIANTS, type LogoVariant } from "@/components/client-logo";
import { useProjects } from "@/lib/store/projects-store";
import { currentUser } from "@/lib/mock/data";
import { cn, sleep } from "@/lib/utils";
import Link from "next/link";
import type {
  Person,
  Project,
  Workstream,
} from "@/lib/mock/types";

type Step = 0 | 1 | 2 | 3 | 4;

interface DraftWorkstream {
  /** Local UUID, becomes the workstream id. */
  id: string;
  name: string;
  description: string;
  /** Email of an entered team member (or current user). Resolved to a
   *  Person at submit time. */
  ownerEmail: string;
}

interface FormState {
  // Step 1
  name: string;
  client: string;
  industry: string;
  logoVariant: LogoVariant;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  context: string;
  // Step 2
  consultants: string[];
  partners: string[];
  slackChannels: string[];
  sharepointPath: string;
  // Step 3
  workstreams: DraftWorkstream[];
  // Step 4
  proposalUploaded: boolean;
  proposalName: string;
}

const STEPS = [
  { label: "Project", desc: "Name, client, dates" },
  { label: "Team & sources", desc: "People + Slack + SharePoint" },
  { label: "Workstreams", desc: "What the team's working on" },
  { label: "Proposal", desc: "Upload (optional)" },
  { label: "Review", desc: "Confirm & launch" },
];

const SUGGESTED_CONSULTANTS = [
  "jonas.weber@meridianstrategy.com",
  "priya.raman@meridianstrategy.com",
  "diego.alvarez@meridianstrategy.com",
  "sofia.lindqvist@meridianstrategy.com",
];

const SUGGESTED_PARTNERS = [
  "alex.foster@meridianstrategy.com",
  "thomas.reinhardt@meridianstrategy.com",
];

const INDUSTRY_PRESETS = [
  "B2B Fintech",
  "Manufacturing",
  "Healthcare",
  "Private Equity",
  "Retail",
  "Energy",
  "Tech / SaaS",
];

/** Stable id for new workstreams. */
let workstreamCounter = 0;
const nextWorkstreamId = () => {
  workstreamCounter += 1;
  return `ws_new_${Date.now().toString(36)}_${workstreamCounter}`;
};

export function InitializeProjectFlow() {
  const router = useRouter();
  const { addProject } = useProjects();
  const [step, setStep] = useState<Step>(0);

  // Lazy initializer so the default 12-week window is pre-filled on the very
  // first render (no empty flash). buildDefaultDates() uses new Date(), so the
  // prerendered value can differ from the client value — the two date inputs
  // carry suppressHydrationWarning and the controlled binding reconciles to
  // the client's value, which is what gets submitted.
  const [form, setForm] = useState<FormState>(() => ({
    name: "",
    client: "",
    industry: "",
    logoVariant: "lattice",
    ...buildDefaultDates(),
    context: "",
    consultants: [],
    partners: [],
    slackChannels: [],
    sharepointPath: "",
    workstreams: [],
    proposalUploaded: false,
    proposalName: "",
  }));

  const [launching, setLaunching] = useState(false);

  if (launching) {
    return (
      <WiringAnimation
        form={form}
        onComplete={(project) => {
          addProject(project);
          router.push(`/projects/view?id=${project.id}`);
        }}
      />
    );
  }

  const canAdvance = () => {
    if (step === 0) {
      return (
        form.name.trim().length > 0 &&
        form.client.trim().length > 0 &&
        form.industry.trim().length > 0 &&
        !!form.startDate &&
        !!form.endDate &&
        new Date(form.startDate).getTime() < new Date(form.endDate).getTime()
      );
    }
    if (step === 1) {
      return form.partners.length > 0;
    }
    if (step === 2) {
      // At least one workstream with a name + description + owner
      return (
        form.workstreams.length > 0 &&
        form.workstreams.every(
          (w) =>
            w.name.trim().length > 0 &&
            w.description.trim().length > 0 &&
            w.ownerEmail.trim().length > 0
        )
      );
    }
    if (step === 3) return true;
    if (step === 4) return true;
    return false;
  };

  // Pool of everyone who can own a workstream (current user + entered consultants).
  const ownerPool = [
    { email: currentUser.email, label: `${currentUser.name} (you)` },
    ...form.consultants.map((e) => ({ email: e, label: e })),
  ];

  return (
    <div className="fade-in-up">
      <div className="mb-6">
        <Link
          href="/demo"
          className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to dashboard
        </Link>
      </div>

      <div className="mb-2 text-xs text-accent">
        Initialize Project
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mb-2">
        Wire up a new engagement
      </h1>
      <p className="text-foreground-muted mb-8 max-w-xl">
        Iota will keep the project brain in sync with the team&apos;s email, the project
        Slack channels, and the shared SharePoint folder. Anything that matches the
        project context becomes a structured brain page on the knowledge graph.
      </p>

      <Stepper step={step} />

      <Card className="p-6 md:p-8">
        {step === 0 && <StepProjectContext form={form} setForm={setForm} />}
        {step === 1 && <StepTeam form={form} setForm={setForm} />}
        {step === 2 && (
          <StepWorkstreams
            form={form}
            setForm={setForm}
            ownerPool={ownerPool}
          />
        )}
        {step === 3 && <StepProposal form={form} setForm={setForm} />}
        {step === 4 && <StepReview form={form} ownerPool={ownerPool} />}

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {step < 4 ? (
            <Button
              variant="primary"
              disabled={!canAdvance()}
              onClick={() => setStep((s) => Math.min(4, s + 1) as Step)}
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={() => setLaunching(true)}
            >
              <Sparkles className="h-4 w-4" />
              Initialize project brain
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// Default to "next Monday" + 12 weeks.
function buildDefaultDates() {
  const start = new Date();
  const day = start.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  start.setDate(start.getDate() + daysUntilMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 12 * 7 - 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="mb-8 flex items-stretch gap-2">
      {STEPS.map((s, i) => {
        const isComplete = i < step;
        const isActive = i === step;
        return (
          <div key={s.label} className="flex-1 flex flex-col gap-2">
            <div
              className={cn(
                "h-1 rounded-full transition-colors",
                isComplete
                  ? "bg-gradient-to-r from-primary to-accent"
                  : isActive
                  ? "bg-accent"
                  : "bg-background-soft"
              )}
            />
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition-colors",
                  isComplete
                    ? "bg-accent text-accent-foreground"
                    : isActive
                    ? "border border-accent text-accent"
                    : "border border-border text-foreground-subtle"
                )}
              >
                {isComplete ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-xs font-medium",
                    isActive || isComplete ? "text-foreground" : "text-foreground-subtle"
                  )}
                >
                  {s.label}
                </div>
                <div className="text-[10px] text-foreground-subtle hidden md:block">
                  {s.desc}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepProjectContext({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Project basics</h2>
        <p className="text-sm text-foreground-muted">
          Iota uses this context to decide which emails are relevant to this project,
          and to ground the knowledge graph it builds.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            placeholder="e.g. EU Market Entry Strategy"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="client">Client</Label>
          <Input
            id="client"
            placeholder="e.g. Lattice Pay"
            value={form.client}
            onChange={(e) => setForm({ ...form, client: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="industry">Client industry</Label>
          <Input
            id="industry"
            list="industry-presets"
            placeholder="e.g. B2B Fintech"
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
          <datalist id="industry-presets">
            {INDUSTRY_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label>Logo style</Label>
          <div className="flex flex-wrap gap-2">
            {LOGO_VARIANTS.map((v) => {
              const isSelected = form.logoVariant === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm({ ...form, logoVariant: v })}
                  className={cn(
                    "rounded-md p-1 border transition-colors",
                    isSelected
                      ? "border-accent ring-2 ring-accent/30"
                      : "border-border hover:border-border-strong"
                  )}
                  title={v}
                >
                  <ClientLogo variant={v} size={32} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="start">Start date</Label>
          <Input
            id="start"
            type="date"
            suppressHydrationWarning
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end">End date</Label>
          <Input
            id="end"
            type="date"
            suppressHydrationWarning
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="context">
          Context
          <span className="ml-2 text-foreground-subtle font-normal">
            (what is this engagement about?)
          </span>
        </Label>
        <Textarea
          id="context"
          placeholder="A few sentences. e.g. '12-week strategy engagement to define Lattice Pay's European market entry: target markets, regulatory path, competitive positioning, and 24-month GTM plan.'"
          rows={4}
          value={form.context}
          onChange={(e) => setForm({ ...form, context: e.target.value })}
        />
      </div>

      <div className="rounded-md bg-accent/5 border border-accent/20 px-4 py-3 text-xs text-foreground-muted">
        <span className="font-mono text-accent">i</span> Iota uses semantic matching, not
        keywords. You don&apos;t need to enumerate topics — a few descriptive sentences are
        enough.
      </div>
    </div>
  );
}

function StepTeam({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  const [input, setInput] = useState("");
  const [partnerInput, setPartnerInput] = useState("");

  const addConsultant = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed || form.consultants.includes(trimmed)) return;
    setForm({ ...form, consultants: [...form.consultants, trimmed] });
    setInput("");
  };
  const removeConsultant = (email: string) => {
    setForm({ ...form, consultants: form.consultants.filter((c) => c !== email) });
  };

  const addPartner = (email: string) => {
    const trimmed = email.trim();
    if (!trimmed || form.partners.includes(trimmed)) return;
    setForm({ ...form, partners: [...form.partners, trimmed] });
    setPartnerInput("");
  };
  const removePartner = (email: string) => {
    setForm({ ...form, partners: form.partners.filter((c) => c !== email) });
  };

  // Slack channel handlers (local to step)
  const [slackInput, setSlackInput] = useState("");
  const addChannel = (raw: string) => {
    const trimmed = raw.trim().replace(/^#?/, "#");
    if (trimmed === "#" || form.slackChannels.includes(trimmed)) return;
    setForm({ ...form, slackChannels: [...form.slackChannels, trimmed] });
    setSlackInput("");
  };
  const removeChannel = (ch: string) =>
    setForm({ ...form, slackChannels: form.slackChannels.filter((c) => c !== ch) });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Team &amp; data sources</h2>
        <p className="text-sm text-foreground-muted">
          Iota syncs the project brain with each consultant&apos;s email, the
          project Slack channels, and a shared SharePoint folder. You can add or
          remove sources anytime.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="consultant">Consultant email</Label>
        <div className="flex gap-2">
          <Input
            id="consultant"
            type="email"
            placeholder="jonas.weber@meridianstrategy.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addConsultant(input);
              }
            }}
          />
          <Button
            variant="secondary"
            onClick={() => addConsultant(input)}
            disabled={!input.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-foreground-subtle">
          Suggested from your firm
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CONSULTANTS.filter((c) => !form.consultants.includes(c)).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => addConsultant(c)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elevated px-3 py-1 text-xs text-foreground-muted hover:text-foreground hover:border-border-strong transition-colors"
            >
              <span className="text-accent">+</span>
              {c}
            </button>
          ))}
        </div>
      </div>

      {form.consultants.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-foreground-subtle">
            Synced consultants ({form.consultants.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {form.consultants.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-2 rounded-full bg-accent/10 border border-accent/30 px-3 py-1 text-xs text-foreground"
              >
                <Mail className="h-3 w-3 text-accent" />
                {c}
                <button
                  type="button"
                  onClick={() => removeConsultant(c)}
                  className="text-foreground-subtle hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* --- Partners --- */}
      <div className="border-t border-border pt-5 space-y-1.5">
        <Label htmlFor="partner">
          Responsible partner(s)
          <span className="ml-2 text-foreground-subtle font-normal">
            (so the partner briefing flow has a target)
          </span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="partner"
            type="email"
            placeholder="alex.foster@meridianstrategy.com"
            value={partnerInput}
            onChange={(e) => setPartnerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPartner(partnerInput);
              }
            }}
          />
          <Button
            variant="secondary"
            onClick={() => addPartner(partnerInput)}
            disabled={!partnerInput.trim()}
          >
            Add
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {SUGGESTED_PARTNERS.filter((p) => !form.partners.includes(p)).map(
            (p) => (
              <button
                key={p}
                type="button"
                onClick={() => addPartner(p)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elevated px-3 py-1 text-xs text-foreground-muted hover:text-foreground hover:border-border-strong transition-colors"
              >
                <span className="text-primary">+</span>
                {p}
              </button>
            )
          )}
        </div>

        {form.partners.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {form.partners.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 px-3 py-1 text-xs text-foreground"
              >
                <Mail className="h-3 w-3 text-primary" />
                {p}
                <button
                  type="button"
                  onClick={() => removePartner(p)}
                  className="text-foreground-subtle hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* --- Slack channels --- */}
      <div className="border-t border-border pt-5 space-y-1.5">
        <Label htmlFor="slack-channel">
          Slack channels
          <span className="ml-2 text-foreground-subtle font-normal">
            (project decisions in Slack get folded into the brain)
          </span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="slack-channel"
            placeholder="#lattice-pay-eu"
            value={slackInput}
            onChange={(e) => setSlackInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addChannel(slackInput);
              }
            }}
          />
          <Button
            variant="secondary"
            onClick={() => addChannel(slackInput)}
            disabled={!slackInput.trim()}
          >
            Add
          </Button>
        </div>
        {form.slackChannels.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {form.slackChannels.map((ch) => (
              <span
                key={ch}
                className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/30 px-3 py-1 text-xs text-foreground font-mono"
              >
                <MessageSquare className="h-3 w-3 text-primary" />
                {ch}
                <button
                  type="button"
                  onClick={() => removeChannel(ch)}
                  className="text-foreground-subtle hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* --- SharePoint --- */}
      <div className="border-t border-border pt-5 space-y-1.5">
        <Label htmlFor="sharepoint">
          SharePoint folder
          <span className="ml-2 text-foreground-subtle font-normal">
            (optional — file edits + new documents feed the graph)
          </span>
        </Label>
        <Input
          id="sharepoint"
          placeholder="meridian.sharepoint.com/sites/lattice-eu"
          value={form.sharepointPath}
          onChange={(e) => setForm({ ...form, sharepointPath: e.target.value })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Workstreams
// ---------------------------------------------------------------------------

const SUGGESTED_WORKSTREAMS: Array<Omit<DraftWorkstream, "id" | "ownerEmail">> = [
  {
    name: "Market Sizing & TAM",
    description:
      "Defensible TAM/SAM by segment + country. Cross-validate top-down with bottom-up firmographics.",
  },
  {
    name: "Competitive Landscape",
    description:
      "Map incumbents and challengers across pricing, license footprint, integration depth, settlement speed.",
  },
  {
    name: "Regulatory",
    description:
      "Map license requirements per entry market. Decide between MiCA passport, E-Money license, or partner-bank model.",
  },
  {
    name: "GTM & Partnerships",
    description:
      "Define market sequence, hiring, partner channels (ERP / accounting / embedded-finance). 24-month plan.",
  },
];

function StepWorkstreams({
  form,
  setForm,
  ownerPool,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  ownerPool: { email: string; label: string }[];
}) {
  const addWorkstream = (
    seed?: Omit<DraftWorkstream, "id" | "ownerEmail">
  ) => {
    setForm({
      ...form,
      workstreams: [
        ...form.workstreams,
        {
          id: nextWorkstreamId(),
          name: seed?.name ?? "",
          description: seed?.description ?? "",
          ownerEmail: ownerPool[0]?.email ?? "",
        },
      ],
    });
  };

  const removeWorkstream = (id: string) => {
    setForm({
      ...form,
      workstreams: form.workstreams.filter((w) => w.id !== id),
    });
  };

  const updateWorkstream = (id: string, patch: Partial<DraftWorkstream>) => {
    setForm({
      ...form,
      workstreams: form.workstreams.map((w) =>
        w.id === id ? { ...w, ...patch } : w
      ),
    });
  };

  const suggestFromProposal = () => {
    // Mocked: insert any of the canned workstreams that aren't already there.
    const existingNames = new Set(form.workstreams.map((w) => w.name));
    const fresh = SUGGESTED_WORKSTREAMS.filter(
      (w) => !existingNames.has(w.name)
    ).map((w) => ({
      id: nextWorkstreamId(),
      name: w.name,
      description: w.description,
      ownerEmail: ownerPool[0]?.email ?? "",
    }));
    setForm({ ...form, workstreams: [...form.workstreams, ...fresh] });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Workstreams</h2>
        <p className="text-sm text-foreground-muted">
          Define the structure of the engagement. Each workstream gets its own
          subspace in the knowledge graph and its own tab on the project page.
        </p>
      </div>

      {form.proposalUploaded && (
        <button
          type="button"
          onClick={suggestFromProposal}
          className="w-full rounded-md border border-accent/30 bg-accent/5 hover:bg-accent/10 px-4 py-3 text-left transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-accent shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Suggest workstreams from{" "}
                <span className="font-mono">{form.proposalName}</span>
              </div>
              <div className="text-xs text-foreground-muted">
                Iota will parse the proposal and propose 3–4 workstreams you
                can edit.
              </div>
            </div>
          </div>
        </button>
      )}

      <div className="space-y-3">
        {form.workstreams.map((w, i) => (
          <div
            key={w.id}
            className="rounded-md border border-border bg-background-soft/30 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs text-foreground-subtle">
                <Layers className="h-3 w-3" />
                Workstream {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeWorkstream(w.id)}
                className="text-foreground-subtle hover:text-destructive transition-colors"
                title="Remove workstream"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`ws-name-${w.id}`}>Name</Label>
                <Input
                  id={`ws-name-${w.id}`}
                  placeholder="e.g. Regulatory"
                  value={w.name}
                  onChange={(e) =>
                    updateWorkstream(w.id, { name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`ws-owner-${w.id}`}>Owner</Label>
                <select
                  id={`ws-owner-${w.id}`}
                  value={w.ownerEmail}
                  onChange={(e) =>
                    updateWorkstream(w.id, { ownerEmail: e.target.value })
                  }
                  className="flex h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                >
                  {ownerPool.length === 0 ? (
                    <option value="">Add team members first</option>
                  ) : (
                    ownerPool.map((p) => (
                      <option key={p.email} value={p.email}>
                        {p.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`ws-desc-${w.id}`}>Description</Label>
              <Textarea
                id={`ws-desc-${w.id}`}
                rows={2}
                placeholder="One or two sentences on the scope."
                value={w.description}
                onChange={(e) =>
                  updateWorkstream(w.id, { description: e.target.value })
                }
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => addWorkstream()}
        className="w-full rounded-md border border-dashed border-border hover:border-accent/50 hover:bg-accent/5 px-4 py-3 text-sm text-foreground-muted hover:text-foreground transition-colors inline-flex items-center justify-center gap-2"
      >
        <Layers className="h-4 w-4" />
        Add workstream
      </button>

      {form.workstreams.length === 0 && (
        <div className="rounded-md bg-warning/5 border border-warning/30 px-4 py-3 text-xs text-foreground-muted">
          Add at least one workstream — Iota needs at least one to scaffold the
          knowledge graph and the Workstreams tab.
        </div>
      )}
    </div>
  );
}

function StepProposal({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">
          Proposal or kickoff doc{" "}
          <span className="text-sm font-normal text-foreground-subtle ml-1">
            (optional)
          </span>
        </h2>
        <p className="text-sm text-foreground-muted">
          Iota uses your proposal as seed context — it bootstraps the knowledge graph
          with workstreams, deliverables, and team structure before any emails arrive.
        </p>
      </div>

      {!form.proposalUploaded ? (
        <button
          type="button"
          onClick={() =>
            setForm({
              ...form,
              proposalUploaded: true,
              proposalName: "Lattice_EU_Proposal_v3.pdf",
            })
          }
          className="w-full rounded-lg border-2 border-dashed border-border hover:border-accent/50 bg-background/30 hover:bg-accent/5 p-10 text-center transition-all group"
        >
          <Upload className="h-8 w-8 mx-auto text-foreground-subtle group-hover:text-accent transition-colors mb-3" />
          <div className="text-sm font-medium text-foreground mb-1">
            Drop a proposal here
          </div>
          <div className="text-xs text-foreground-subtle">
            PDF, DOCX, or paste a link · click to demo upload
          </div>
        </button>
      ) : (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-accent/10 flex items-center justify-center">
              <FileText className="h-5 w-5 text-accent" />
            </div>
            <div>
              <div className="text-sm font-medium">{form.proposalName}</div>
              <div className="text-xs text-foreground-muted">
                4.2 MB · uploaded just now
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...form, proposalUploaded: false, proposalName: "" })}
            className="text-foreground-subtle hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-md bg-background-soft/50 border border-border px-4 py-3 text-xs text-foreground-muted">
        Skip this step if you don&apos;t have a proposal handy — Iota will still build
        the graph from emails, just without the head start.
      </div>
    </div>
  );
}

function StepReview({
  form,
  ownerPool,
}: {
  form: FormState;
  ownerPool: { email: string; label: string }[];
}) {
  const ownerLabel = (email: string) =>
    ownerPool.find((p) => p.email === email)?.label ?? email;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <ClientLogo variant={form.logoVariant} size={48} />
        <div>
          <h2 className="text-lg font-semibold mb-1">Ready to launch</h2>
          <p className="text-sm text-foreground-muted">
            Review the configuration. Once you initialize, Iota starts syncing
            immediately.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <ReviewRow label="Project" value={form.name || "—"} />
        <ReviewRow label="Client" value={form.client || "—"} />
        <ReviewRow label="Industry" value={form.industry || "—"} />
        <ReviewRow
          label="Window"
          value={
            form.startDate && form.endDate
              ? `${form.startDate} → ${form.endDate}`
              : "—"
          }
        />
        <ReviewRow label="Context" value={form.context.trim() || "—"} />
        <ReviewRow
          label={`Workstreams (${form.workstreams.length})`}
          value={
            form.workstreams.length === 0
              ? "—"
              : form.workstreams
                  .map(
                    (w) =>
                      `${w.name} (owner: ${ownerLabel(w.ownerEmail)})`
                  )
                  .join("\n")
          }
        />
        <ReviewRow
          label={`Consultants (${form.consultants.length})`}
          value={
            form.consultants.length === 0
              ? "—"
              : form.consultants.join(", ")
          }
        />
        <ReviewRow
          label={`Partners (${form.partners.length})`}
          value={form.partners.length === 0 ? "—" : form.partners.join(", ")}
        />
        <ReviewRow
          label={`Slack channels (${form.slackChannels.length})`}
          value={
            form.slackChannels.length === 0
              ? "None"
              : form.slackChannels.join(", ")
          }
        />
        <ReviewRow
          label="SharePoint folder"
          value={form.sharepointPath || "None"}
        />
        <ReviewRow label="Proposal" value={form.proposalName || "None"} />
      </div>

      <div className="rounded-md bg-accent/5 border border-accent/20 px-4 py-3 text-xs text-foreground-muted flex items-start gap-2">
        <Sparkles className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
        <span>
          Iota will run an initial backfill on the last 14 days of email, the
          configured Slack channels, and any files in the SharePoint folder, then
          stay in sync. Initial graph build typically takes 30–90 seconds.
        </span>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 py-2 border-b border-border/50 last:border-0">
      <div className="text-xs text-foreground-subtle pt-0.5">
        {label}
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words">
        {value}
      </div>
    </div>
  );
}

// ---------- Wiring animation ----------

interface WireStep {
  label: string;
  detail: string;
  duration: number;
  icon: typeof Mail;
}

interface StreamEntity {
  type: string;
  label: string;
  detail: string;
}

/** The entities Iota "detects" during init — derived from what the manager
 *  actually entered: the client company, each workstream (with owner), the
 *  partners, and the consultants. */
function buildStreamEntities(form: FormState): StreamEntity[] {
  const out: StreamEntity[] = [];

  if (form.client.trim()) {
    out.push({
      type: "company",
      label: form.client.trim(),
      detail: form.industry.trim() || "Client",
    });
  }

  form.workstreams.forEach((w) => {
    if (!w.name.trim()) return;
    const owner = w.ownerEmail ? nameFromEmail(w.ownerEmail) : "";
    out.push({
      type: "workstream",
      label: w.name.trim(),
      detail: owner ? `owner: ${owner}` : "workstream",
    });
  });

  form.partners.forEach((email) => {
    out.push({ type: "person", label: nameFromEmail(email), detail: "Partner" });
  });

  form.consultants.forEach((email) => {
    out.push({
      type: "person",
      label: nameFromEmail(email),
      detail: "Consultant",
    });
  });

  return out;
}

/** Pipeline steps — details reflect the configured sources + entity count. */
function buildWireSteps(form: FormState, entityCount: number): WireStep[] {
  const accounts = 1 + form.consultants.length + form.partners.length; // manager + team
  const steps: WireStep[] = [
    {
      label: "Connecting team inboxes",
      detail: `OAuth handshake · ${accounts} account${accounts === 1 ? "" : "s"}`,
      duration: 1500,
      icon: Mail,
    },
  ];

  if (form.slackChannels.length > 0) {
    const [first, ...rest] = form.slackChannels;
    steps.push({
      label: "Joining Slack channels",
      detail: rest.length
        ? `${first} + ${rest.length} other${rest.length === 1 ? "" : "s"} · 14-day backfill`
        : `${first} · 14-day backfill`,
      duration: 1500,
      icon: MessageSquare,
    });
  }

  if (form.sharepointPath.trim()) {
    steps.push({
      label: "Indexing SharePoint folder",
      detail: form.sharepointPath.trim(),
      duration: 1700,
      icon: FolderOpen,
    });
  }

  steps.push(
    {
      label: "Filtering for project-relevant content",
      detail: "Semantic match against context",
      duration: 1700,
      icon: Sparkles,
    },
    {
      label: "Detecting entities",
      detail: "people · workstreams · deliverables · risks",
      duration: 2000,
      icon: Network,
    },
    {
      label: "Building brain pages",
      detail: `${entityCount} entit${entityCount === 1 ? "y" : "ies"} canonicalized`,
      duration: 2000,
      icon: Brain,
    },
    {
      label: "Indexing for search",
      detail: "vector + keyword embeddings",
      duration: 1500,
      icon: CheckCircle2,
    }
  );

  return steps;
}

const entityColor: Record<string, string> = {
  person: "text-entity-person",
  company: "text-entity-company",
  workstream: "text-entity-workstream",
  deliverable: "text-entity-deliverable",
  decision: "text-success",
  risk: "text-destructive",
  milestone: "text-entity-milestone",
};

function WiringAnimation({
  form,
  onComplete,
}: {
  form: FormState;
  onComplete: (project: Project) => void;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [revealedEntities, setRevealedEntities] = useState<number>(0);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pipeline + detected entities, derived from what the manager entered.
  const streamEntities = useMemo(() => buildStreamEntities(form), [form]);
  const wireSteps = useMemo(
    () => buildWireSteps(form, streamEntities.length),
    [form, streamEntities.length]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const entityReveal = (async () => {
        for (let i = 0; i < streamEntities.length; i++) {
          await sleep(700 + Math.random() * 300);
          if (cancelled) return;
          setRevealedEntities((n) => n + 1);
        }
      })();

      for (let i = 0; i < wireSteps.length; i++) {
        if (cancelled) return;
        setActiveStep(i);
        await sleep(wireSteps[i].duration);
        setCompletedSteps((s) => new Set(s).add(i));
      }
      await entityReveal;
      if (cancelled) return;
      setDone(true);
      await sleep(1100);
      if (cancelled) return;

      // Assemble the project from form state + hand to the parent.
      const project = buildProjectFromForm(form);
      onComplete(project);
    })();

    return () => {
      cancelled = true;
    };
  }, [form, onComplete, streamEntities, wireSteps]);

  return (
    <div className="fade-in-up">
      <div className="mb-2 text-xs text-accent">
        Initializing
      </div>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
        Building the brain for{" "}
        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          {form.name || "your project"}
        </span>
      </h1>
      <p className="text-foreground-muted mb-8">
        This usually takes 30–90 seconds. You can leave this page — we&apos;ll notify
        you when the graph is ready.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5">
        <Card className="p-6">
          <div className="text-xs text-foreground-subtle mb-4">
            Pipeline
          </div>
          <ul className="space-y-3">
            {wireSteps.map((s, i) => {
              const isActive = activeStep === i && !completedSteps.has(i);
              const isComplete = completedSteps.has(i);
              const Icon = s.icon;
              return (
                <li
                  key={s.label}
                  className={cn(
                    "flex items-start gap-3 rounded-md p-2.5 transition-all",
                    isActive && "bg-accent/5 border border-accent/20",
                    !isActive && !isComplete && "opacity-50"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-all",
                      isComplete
                        ? "bg-success/20 text-success"
                        : isActive
                        ? "bg-accent/15 text-accent"
                        : "bg-background-soft text-foreground-subtle"
                    )}
                  >
                    {isComplete ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isActive ? (
                      <Icon className="h-3.5 w-3.5 animate-pulse" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "text-sm font-medium",
                        isActive ? "text-foreground" : "text-foreground-muted"
                      )}
                    >
                      {s.label}
                      {isActive && <span className="ml-1 text-accent animate-pulse">…</span>}
                    </div>
                    <div className="text-xs text-foreground-subtle font-mono mt-0.5">
                      {s.detail}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-foreground-subtle">
              Entities detected
            </div>
            <Badge variant="accent" className="font-mono">
              {revealedEntities}
            </Badge>
          </div>
          <div
            ref={containerRef}
            className="space-y-2 max-h-[440px] overflow-y-auto pr-1"
          >
            {streamEntities.slice(0, revealedEntities).map((e, i) => (
              <div
                key={i}
                className="fade-in-up rounded-md border border-border bg-background-soft/40 px-3 py-2 flex items-start gap-2.5"
              >
                <div
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    entityColor[e.type]?.replace("text-", "bg-") ?? "bg-foreground-subtle"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">
                      {e.label}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        entityColor[e.type]
                      )}
                    >
                      {e.type}
                    </span>
                  </div>
                  <div className="text-xs text-foreground-subtle truncate">
                    {e.detail}
                  </div>
                </div>
              </div>
            ))}
            {revealedEntities < streamEntities.length && (
              <div className="text-xs text-foreground-subtle font-mono mt-2 flex items-center gap-2">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                scanning…
              </div>
            )}
            {revealedEntities === 0 && (
              <div className="text-xs text-foreground-subtle font-mono mt-4 text-center py-8">
                Waiting for first match…
              </div>
            )}
          </div>
        </Card>
      </div>

      {done && (
        <div className="mt-6 rounded-md bg-success/10 border border-success/30 px-4 py-3 text-sm text-foreground fade-in-up">
          <CheckCircle2 className="inline h-4 w-4 text-success mr-2 -mt-0.5" />
          Project brain ready · redirecting…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assemble a Project from the init form state. Most of the dynamic fields
// (tasks / deliverables / activity / counters) start empty — they fill in
// as the (mocked) sync runs.
// ---------------------------------------------------------------------------

function buildProjectFromForm(form: FormState): Project {
  const projectId = `proj_new_${Date.now().toString(36)}`;
  const companyId = `co_new_${Date.now().toString(36)}`;

  // Total engagement weeks, rounded
  const start = new Date(form.startDate);
  const end = new Date(form.endDate);
  const totalWeeks = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
  );

  // Current week within the engagement (1-indexed). Clamp to [1, totalWeeks].
  const now = Date.now();
  let weekNumber = 1;
  if (now >= start.getTime()) {
    weekNumber = Math.min(
      totalWeeks,
      Math.max(
        1,
        Math.ceil((now - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
      )
    );
  }

  const manager: Person = { ...currentUser, synced: true };

  const consultants: Person[] = form.consultants.map((email) => ({
    id: personIdFromEmail(email),
    name: nameFromEmail(email),
    role: "Consultant",
    email,
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: new Date().toISOString(),
  }));

  const team: Person[] = [manager, ...consultants];

  const partners: Person[] = form.partners.map((email) => ({
    id: personIdFromEmail(email),
    name: nameFromEmail(email),
    role: "Partner",
    email,
    company: "Meridian Strategy Partners",
    isPartner: true,
    synced: true,
  }));

  // Resolve workstream owners — match by email against the team pool.
  const workstreams: Workstream[] = form.workstreams.map((w) => {
    const owner = team.find((p) => p.email === w.ownerEmail) ?? manager;
    return {
      id: w.id,
      name: w.name.trim(),
      description: w.description.trim(),
      owner: owner.id,
      status: "on-track",
      progress: 0,
    };
  });

  return {
    id: projectId,
    name: form.name.trim(),
    client: form.client.trim(),
    clientCompany: {
      id: companyId,
      name: form.client.trim(),
      description: "",
      industry: form.industry.trim(),
      logoVariant: form.logoVariant,
    },
    status: "active",
    description: form.context.trim() || `Engagement for ${form.client.trim()}.`,
    context: form.context.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    weekNumber,
    totalWeeks,
    workstreams,
    team,
    partners,
    clientContacts: [],
    recentActivity: [],
    deliverables: [],
    tasks: [],
    todaysCheckIn: undefined,
    emailsScanned: 0,
    filesScanned: 0,
    slackMessagesScanned: 0,
    brainPages: 0,
    slackChannels: form.slackChannels,
    sharepointPath: form.sharepointPath || undefined,
    lastSync: new Date().toISOString(),
  };
}

function personIdFromEmail(email: string): string {
  return "p_" + email.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}
