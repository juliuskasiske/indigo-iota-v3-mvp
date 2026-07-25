"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet,
  Plug,
  Filter,
  Boxes,
  Rocket,
  Users,
  Flag,
  Check,
  LogOut,
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";
import { CreditsPanel } from "@/components/admin/credits-panel";
import {
  CaptureSourcesPanel,
  type BackfillHandle,
} from "@/components/admin/capture-sources-panel";
import { ScopePanel } from "@/components/admin/scope-panel";
import { CautionPanel } from "@/components/admin/caution-panel";
import { OntologyPanel } from "@/components/admin/ontology-panel";
import { StarterEntitiesPanel } from "@/components/admin/starter-entities-panel";
import { IngestionPanel } from "@/components/admin/ingestion-panel";
import { MembersPanel } from "@/components/admin/members-panel";
import type { CommitHandle } from "@/components/admin/commit-handle";
import { cn } from "@/lib/utils";
import { api, ApiError, type Me, type Onboarding } from "@/lib/api";

// The once-per-tenant onboarding wizard. A new workspace walks these steps in
// order: name the team, fund the workspace, connect the mailboxes, review +
// sign off on the triage scope, shape the brain, then run the first backfill —
// which builds the brain and is the last thing setup does before flipping the
// Admin Center to its steady-state dashboard. Every panel here is the SAME
// panel the dashboard uses, so nothing set during onboarding is locked away
// afterwards.
//
// One click per step: the footer button persists whatever the step's panels
// hold (scope, caution, ontology) and, on Triage, signs off the scope — so the
// user never hunts for a separate Save or Approve button. Panels that spend
// money (add credits) keep their own buttons, since advancing must never
// silently spend.
//
// The backend still refuses to pull mail until the scope is approved; the
// Triage Next does that approval. Activate is the final step, and its footer
// button is the ONE action that ends the flow: it runs the backfill of the
// ticked mailboxes (which builds the brain), and the moment the brain has
// content we stamp onboarding complete and hand off to the dashboard — so
// there is no second "Finish" button, and no nag pointing at a button inside
// the panel.

type StepKey =
  | "team"
  | "credits"
  | "connect"
  | "triage"
  | "brain"
  | "activate";

const STEPS: {
  key: StepKey;
  label: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
}[] = [
  {
    key: "team",
    label: "Team",
    title: "Invite your team",
    desc: "Add the people who can sign in to this workspace. You can add more or change roles any time from the Admin Center.",
    Icon: Users,
  },
  {
    key: "connect",
    label: "Connect",
    title: "Connect mailboxes & grant access",
    desc: "Register the mailboxes Indigo Iota will pull from, then generate the Exchange access-policy command that lets the connector read them. This comes first — nothing syncs until access is granted.",
    Icon: Plug,
  },
  {
    key: "credits",
    label: "Credits",
    title: "Fund the workspace",
    desc: "Set the starting credit balance. 1 credit = $1 — this is the ceiling Indigo Iota will spend on this workspace until you top it up.",
    Icon: Wallet,
  },
  {
    key: "triage",
    label: "Triage",
    title: "Review & approve the scope",
    desc: "The scope filter decides which emails are kept. Review the categories and example snippets, then sign off — capture stays paused until you do.",
    Icon: Filter,
  },
  {
    key: "brain",
    label: "Brain",
    title: "Shape the brain",
    desc: "The entity types your brain tracks, plus any seed entities to anchor it before the first emails land.",
    Icon: Boxes,
  },
  {
    key: "activate",
    label: "Activate",
    title: "Build the brain",
    desc: "Check the sync health and tick the mailboxes to pull. The button below pulls a window of history — that builds the brain — and then opens the Admin Center. It's the last step.",
    Icon: Rocket,
  },
];

export function OnboardingWizard({
  me,
  onAuthError,
  onSignOut,
  onFinished,
}: {
  me: Me;
  onAuthError: (e: ApiError) => void;
  onSignOut: () => void;
  // Called after the wizard is stamped complete, so the parent re-reads status
  // and switches to the dashboard.
  onFinished: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [ontologyVersion, setOntologyVersion] = useState(0);
  const [finishing, setFinishing] = useState(false);
  // True while Next is persisting the current step (saving settings / signing
  // off the scope) before it advances.
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Imperative handles into the "settings" panels so the footer Next can save
  // them in one click. Each panel hides its own Save button when embedded.
  const scopeRef = useRef<CommitHandle>(null);
  const cautionRef = useRef<CommitHandle>(null);
  const ontologyRef = useRef<CommitHandle>(null);
  // The Activate step's backfill panel: the wizard footer's single primary
  // button drives the run, so we keep a handle to it and mirror its readiness
  // (how many mailboxes are ticked, whether a run is in flight) for the button.
  const backfillRef = useRef<BackfillHandle>(null);
  const [bfState, setBfState] = useState({ selectedCount: 0, running: false });
  // Did a backfill actually complete during THIS Activate visit? The auto-finish
  // below keys on this — not on ambient brain content — so landing on Activate
  // with a brain that already has rows (e.g. a re-run, or mail captured before
  // this fix) never bounces us straight to the dashboard. The user always gets
  // to set and run their window first.
  const [didBackfill, setDidBackfill] = useState(false);

  const step = STEPS[stepIdx];

  const loadOnboarding = useCallback(async () => {
    try {
      setOnboarding(await api.onboarding());
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setOnboarding(null);
    }
  }, [onAuthError]);

  useEffect(() => {
    loadOnboarding();
  }, [loadOnboarding]);

  // Per-step completion, for the stepper check marks. These are informational
  // except for Triage, which is the one hard gate.
  function isDone(key: StepKey): boolean {
    if (!onboarding) return false;
    if (key === "connect") return onboarding.sources_connected;
    if (key === "triage") return onboarding.scope_approved;
    if (key === "brain") return onboarding.ontology_defined;
    if (key === "activate") return onboarding.brain_initialized;
    return false;
  }

  const scopeApproved = onboarding?.scope_approved ?? false;
  // The real-state bar for leaving onboarding: capture AND comprehend must have
  // actually run, so the brain has content. The backend enforces the same on
  // /complete, so a clicked Finish can never stamp an empty brain as done.
  const brainInitialized = onboarding?.brain_initialized ?? false;
  const devSkip = onboarding?.dev_skip_brain_check ?? false;
  const isLast = stepIdx === STEPS.length - 1;

  // Auto-finish: on the Activate step there is no separate "Finish" button —
  // running the backfill builds the brain, and once it has content we stamp
  // onboarding complete and hand off to the dashboard. Gated on `didBackfill`
  // (set when the backfill run this session completes) so it fires only as a
  // result of the user's action here — NOT merely because the brain already had
  // rows on arrival, which would skip the step entirely. A failed /complete
  // surfaces a retry button via `error`.
  useEffect(() => {
    if (
      step.key === "activate" &&
      didBackfill &&
      brainInitialized &&
      !finishing &&
      !error
    ) {
      void finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.key, didBackfill, brainInitialized]);

  function back() {
    setError(null);
    setStepIdx((i) => Math.max(0, i - 1));
  }

  // Persist the current step's settings (and, on Triage, sign off the scope),
  // then advance. If a save fails the panel shows its own error and we stay put.
  async function next() {
    if (advancing) return;
    setError(null);
    setAdvancing(true);
    try {
      if (step.key === "triage") {
        // One click: save scope + caution, then approve to unpause capture.
        await scopeRef.current?.commit();
        await cautionRef.current?.commit();
        await api.approveScope();
        await loadOnboarding();
      } else if (step.key === "brain") {
        await ontologyRef.current?.commit();
        await loadOnboarding();
      }
      setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(
        e instanceof Error ? e.message : "Couldn't save this step — try again.",
      );
    } finally {
      setAdvancing(false);
    }
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await api.completeOnboarding();
      onFinished();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not finish setup.");
      setFinishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/70 px-5 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3">
          <IotaLogo size={20} />
          <span className="hidden items-center gap-1.5 text-xs font-mono uppercase tracking-[0.18em] text-accent sm:flex">
            Onboarding
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span className="text-xs font-medium text-foreground">{me.org}</span>
            <span className="text-[10px] text-foreground-subtle">{me.email}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-8 p-5 md:p-8">
        {/* Stepper */}
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {STEPS.map((s, i) => {
            const active = i === stepIdx;
            // Steps with a real-state signal (Connect/Triage/Brain/Activate)
            // show a check only when that signal is actually satisfied — so
            // Activate never looks "done" on an empty brain. Steps without a
            // signal (Credits) fall back to "visited".
            const hasSignal =
              s.key === "connect" ||
              s.key === "triage" ||
              s.key === "brain" ||
              s.key === "activate";
            const done = hasSignal ? isDone(s.key) : i < stepIdx;
            const StepIcon = s.Icon;
            return (
              <li key={s.key} className="flex items-center gap-1">
                <button
                  type="button"
                  // Allow jumping back to a visited step; forward jumps go
                  // through the Next button (which saves first), so disable them.
                  disabled={i > stepIdx}
                  onClick={() => {
                    if (i <= stepIdx) setStepIdx(i);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : done
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-card text-foreground-subtle",
                    i <= stepIdx ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                      active
                        ? "bg-white/20"
                        : done
                          ? "bg-success/20"
                          : "bg-foreground/10",
                    )}
                  >
                    {done && !active ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <StepIcon className="h-3 w-3" />
                    )}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && (
                  <span className="h-px w-3 bg-border sm:w-5" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>

        {/* Step header */}
        <div>
          <p className="mb-2 text-xs font-mono uppercase tracking-[0.2em] text-accent">
            Step {stepIdx + 1} of {STEPS.length}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {step.title}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-foreground-muted">
            {step.desc}
          </p>
        </div>

        {/* Step content */}
        <div className="space-y-6">
          {step.key === "credits" && <CreditsPanel onAuthError={onAuthError} />}

          {step.key === "connect" && (
            <CaptureSourcesPanel onAuthError={onAuthError} mode="sources" />
          )}

          {step.key === "triage" && (
            <>
              <ScopePanel ref={scopeRef} onAuthError={onAuthError} embedded />
              <CautionPanel ref={cautionRef} onAuthError={onAuthError} embedded />
            </>
          )}

          {step.key === "brain" && (
            <>
              <OntologyPanel
                ref={ontologyRef}
                onAuthError={onAuthError}
                embedded
                onSaved={() => setOntologyVersion((v) => v + 1)}
              />
              <StarterEntitiesPanel
                onAuthError={onAuthError}
                ontologyVersion={ontologyVersion}
              />
            </>
          )}

          {step.key === "team" && <MembersPanel onAuthError={onAuthError} />}

          {step.key === "activate" && (
            <>
              <IngestionPanel onAuthError={onAuthError} />
              <CaptureSourcesPanel
                ref={backfillRef}
                onAuthError={onAuthError}
                mode="backfill"
                locked={!scopeApproved}
                onBackfilled={() => {
                  setDidBackfill(true);
                  void loadOnboarding();
                }}
                hideRunButton
                onRunStateChange={setBfState}
              />
            </>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Footer nav */}
        <div className="flex items-start justify-between border-t border-border pt-5">
          <Button
            variant="ghost"
            onClick={back}
            disabled={stepIdx === 0}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {isLast ? (
            // One button ends the flow. It runs the backfill (the mailboxes
            // ticked above) — which builds the brain — and the moment the brain
            // has content we stamp onboarding complete and hand off to the
            // dashboard (see the auto-finish effect). No separate "Run backfill"
            // inside the panel competing with this; the panel hides its own.
            <div className="flex flex-col items-end gap-1.5">
              {finishing || didBackfill ? (
                // The finish flow is underway (the backfill this session completed,
                // or finish() is running). Show status; if /complete failed, offer
                // a retry button.
                error ? (
                  <Button onClick={finish} disabled={finishing}>
                    <Flag className="h-4 w-4" />
                    {finishing ? "Finishing…" : "Finish setup"}
                  </Button>
                ) : (
                  <span className="text-[11px] text-foreground-subtle">
                    {finishing
                      ? "Brain built — opening the Admin Center…"
                      : "Brain built — finishing setup…"}
                  </span>
                )
              ) : (
                // Not yet finished. The primary action is to run the backfill —
                // it stays reachable even if the brain already has rows, so the
                // step is never a dead end.
                <>
                  <Button
                    onClick={() => backfillRef.current?.run()}
                    disabled={
                      bfState.running ||
                      bfState.selectedCount === 0 ||
                      !scopeApproved
                    }
                  >
                    <Rocket className="h-4 w-4" />
                    {bfState.running
                      ? "Building the brain…"
                      : "Build the brain & finish"}
                  </Button>
                  <span className="text-[11px] text-foreground-subtle">
                    {bfState.selectedCount === 0
                      ? "Tick at least one mailbox above to build the brain."
                      : "Pulls the selected mailboxes, then opens the Admin Center."}
                  </span>
                  {brainInitialized && (
                    // The brain already has content (a re-run, or mail captured
                    // before this fix). Let the admin finish without a fresh pull.
                    <button
                      type="button"
                      onClick={finish}
                      className="mt-1 text-[11px] text-foreground-subtle underline underline-offset-2 hover:text-foreground"
                    >
                      Finish without backfilling →
                    </button>
                  )}
                  {devSkip && (
                    <button
                      type="button"
                      onClick={finish}
                      disabled={finishing}
                      className="mt-1 text-[11px] text-foreground-subtle underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    >
                      {finishing ? "Opening…" : "Skip to Admin Center (dev)"}
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              <Button onClick={next} disabled={advancing}>
                {advancing
                  ? step.key === "triage"
                    ? "Saving & approving…"
                    : "Saving…"
                  : "Next"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              {step.key === "triage" && (
                <span className="text-[11px] text-foreground-subtle">
                  Next saves this scope and signs it off — capture starts after.
                </span>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
