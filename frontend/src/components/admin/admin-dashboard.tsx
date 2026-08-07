"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  LogOut,
  RefreshCw,
  LayoutDashboard,
  Plug,
  Filter,
  Boxes,
  Users,
  BarChart3,
  Activity,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Network,
  Files,
  Wallet,
  Brain,
  Target,
  Mic,
  Bot,
  Radar,
  type LucideIcon,
} from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CreditsPanel } from "@/components/admin/credits-panel";
import { UsagePanel } from "@/components/admin/usage-panel";
import { IngestionPanel } from "@/components/admin/ingestion-panel";
import { SourcesNetwork } from "@/components/admin/sources-network";
import { CautionPanel } from "@/components/admin/caution-panel";
import { ScopePanel } from "@/components/admin/scope-panel";
import { ScopeApprovalPanel } from "@/components/admin/scope-approval-panel";
import { OntologyPanel } from "@/components/admin/ontology-panel";
import { StarterEntitiesPanel } from "@/components/admin/starter-entities-panel";
import { MembersPanel } from "@/components/admin/members-panel";
import { SpendByUserPanel } from "@/components/admin/spend-by-user-panel";
import { ObservabilityPanel } from "@/components/admin/observability-panel";
import { WorkspaceDangerZone } from "@/components/workspace-danger-zone";
import { DiligencePanel } from "@/components/diligence-panel";
import { Expander } from "@/components/ui/expander";
import { BrainGraph } from "@/components/ask/brain-graph";
import { PagesTab } from "@/components/ask/pages-tab";
import { BrainPageDetail } from "@/components/ask/brain-page-detail";
import { AlignPanel } from "@/components/steps/align-panel";
import { OverviewPanel } from "@/components/steps/hypothesis-tree";
import { AgentSwarmPanel, ComingSoon } from "@/components/steps/agent-swarm-panel";
import { cn } from "@/lib/utils";
import { api, ApiError, type Me, type BrainPage } from "@/lib/api";

type NavItem = {
  value: string;
  label: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
};

type SubTab = { value: string; label: string };

type StepStatus = "live" | "preview";

type StepNav = NavItem & {
  step: number;
  status: StepStatus;
  subtabs: SubTab[];
};

// "Home turf" — the five-step engagement journey. Sits on TOP of the sidebar,
// above the admin-only section. Step 2 (Context Engine) is the live product;
// the rest are marked "Preview" and show illustrative content so a viewer can
// follow the whole arc, Align → Deliver. Step 2 and step 4 use the technology
// names from the marketing site (Context Engine / Agent Swarm).
const STEP_NAV: StepNav[] = [
  {
    value: "align",
    step: 1,
    label: "Objectives",
    title: "Objectives",
    desc: "Set the objective function the agents optimize for, then add any context in your own words. This is the compass every later agent runs against.",
    Icon: Target,
    status: "preview",
    // No sub-tabs — Align is a single view (priorities + context).
    subtabs: [],
  },
  {
    value: "context",
    step: 2,
    label: "Context Engine",
    title: "Context Engine",
    desc: "Reads across everything your organization already produces, strips out who's who, and turns it into one living map your agents can reason over.",
    Icon: Brain,
    status: "live",
    subtabs: [
      { value: "sources", label: "Sources" },
      { value: "graph", label: "Graph" },
      { value: "pages", label: "Pages" },
    ],
  },
  {
    value: "interview",
    step: 3,
    label: "Interview",
    title: "Targeted interviews",
    desc: "The brain spots its own blind spots and requests the specific interviews that close them, then folds the answers back into the context.",
    Icon: Mic,
    status: "preview",
    subtabs: [],
  },
  {
    value: "swarm",
    step: 4,
    label: "Agent Swarm",
    title: "Agent Swarm",
    desc: "Once the context is in place, agents read your organization in parallel, cross-check what they find, and converge on the value levers worth pulling.",
    Icon: Bot,
    status: "preview",
    subtabs: [],
  },
];

// "Admin Center" — workspace administration, shown only to admins. Sources now
// lives up in the Context Engine step, so it's no longer here.
const ADMIN_NAV: NavItem[] = [
  {
    value: "account",
    label: "Account",
    title: "Account",
    desc: "Credits, usage, and mail sync at a glance.",
    Icon: LayoutDashboard,
  },
  {
    value: "observability",
    label: "Observability",
    title: "Tenant observability",
    desc: "Token and cost trace per source (ingress) and per query (egress) — capture, triage, comprehension, Q&A, and delivery.",
    Icon: Activity,
  },
  {
    value: "triage",
    label: "Triage",
    title: "Triage scope",
    desc: "The scope filter that decides which emails are kept. Edit the categories or re-confirm the policy.",
    Icon: Filter,
  },
  {
    value: "brain",
    label: "Ontology",
    title: "Ontology",
    desc: "The entity types and relationship vocabulary your brain tracks, its seed entities, and comprehension diligence.",
    Icon: Boxes,
  },
  {
    value: "team",
    label: "Team",
    title: "Team",
    desc: "The people who can sign in to this workspace.",
    Icon: Users,
  },
  {
    value: "usage",
    label: "Usage",
    title: "Usage",
    desc: "Token and cost breakdown by team member.",
    Icon: BarChart3,
  },
];

// "Overview" — the key tab above Home turf. The running tally of what the agent
// loop is investigating, drawn as a fact-backed hypothesis tree.
const OVERVIEW_NAV: NavItem = {
  value: "overview",
  label: "Overview",
  title: "What the agents are investigating",
  desc: "The diagnosis as a board: your objective at the root, cut into mutually exclusive branches that each carry the reasoning behind them, down to concrete initiatives — every step backed by facts from the brain.",
  Icon: Radar,
};

// Default sub-tab per step (the first one). Steps with no sub-tabs are skipped.
const DEFAULT_SUBTABS: Record<string, string> = Object.fromEntries(
  STEP_NAV.filter((s) => s.subtabs.length > 0).map((s) => [
    s.value,
    s.subtabs[0].value,
  ]),
);

export function AdminDashboard({
  me,
  onAuthError,
  onSignOut,
  onReopenSetup,
}: {
  me: Me;
  onAuthError: (e: ApiError) => void;
  onSignOut: () => void;
  // Re-run the guided setup. Optional: the member entry (/ask) routes to /admin
  // instead. When present, the bottom "Re-run setup" control shows (admins only).
  onReopenSetup?: () => void;
}) {
  const isAdmin = me.role === "admin";
  const [reloadKey, setReloadKey] = useState(0);
  const [ontologyVersion, setOntologyVersion] = useState(0);
  const [tab, setTab] = useState("overview");
  const [subtabs, setSubtabs] = useState<Record<string, string>>(DEFAULT_SUBTABS);
  const [collapsed, setCollapsed] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Home-turf shared state (Context Engine): cited-entity spotlight for the
  // graph, the brain pages list, and the slide-over detail panel.
  const [citedIds, setCitedIds] = useState<string[]>([]);
  const [pages, setPages] = useState<BrainPage[] | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<BrainPage | null>(null);

  // The graph component reports auth failures as a string reason; adapt to the
  // dashboard's ApiError-based handler.
  const askAuth = useCallback(
    (reason: string) => onAuthError(new ApiError(401, reason)),
    [onAuthError],
  );

  const adminNav = isAdmin ? ADMIN_NAV : [];
  const activeStep = STEP_NAV.find((n) => n.value === tab);
  const activeNav =
    [OVERVIEW_NAV, ...STEP_NAV, ...adminNav].find((n) => n.value === tab) ??
    OVERVIEW_NAV;
  const isOverview = tab === "overview";
  const inHome = STEP_NAV.some((n) => n.value === tab);
  const sectionLabel = isOverview
    ? "Overview"
    : inHome
      ? "Home turf"
      : "Admin Center";
  const SectionIcon = isOverview ? Radar : inHome ? Sparkles : ShieldCheck;

  const setSub = useCallback((step: string, value: string) => {
    setSubtabs((s) => ({ ...s, [step]: value }));
  }, []);

  const loadPages = useCallback(async (): Promise<BrainPage[] | null> => {
    setPagesLoading(true);
    setPagesError(null);
    try {
      const res = await api.pages();
      setPages(res.pages);
      return res.pages;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return null;
      }
      setPagesError(e instanceof Error ? e.message : "Could not load the brain pages.");
      return null;
    } finally {
      setPagesLoading(false);
    }
  }, [onAuthError]);

  // Load pages the first time the Context Engine → Pages sub-tab is opened.
  useEffect(() => {
    if (
      tab === "context" &&
      subtabs.context === "pages" &&
      pages === null &&
      !pagesLoading &&
      !pagesError
    ) {
      void loadPages();
    }
  }, [tab, subtabs.context, pages, pagesLoading, pagesError, loadPages]);

  // Open a brain page by path (from a graph node click), reusing the cached list.
  const openPageByPath = useCallback(
    async (pagePath: string) => {
      const list = pages ?? (await loadPages());
      const match = list?.find((p) => p.page_path === pagePath);
      if (match) setOpenPage(match);
    },
    [pages, loadPages],
  );

  async function reopenSetup() {
    if (reopening || !onReopenSetup) return;
    if (
      !window.confirm(
        "Re-run the guided setup? This just reopens the setup wizard — none of your current settings change.",
      )
    ) {
      return;
    }
    setReopening(true);
    try {
      await api.reopenOnboarding();
      onReopenSetup();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setReopening(false);
    }
  }

  function renderStepTrigger(item: StepNav) {
    return (
      <TabsTrigger
        key={item.value}
        value={item.value}
        title={collapsed ? `${item.step}. ${item.label}` : undefined}
        className={cn(
          "gap-2.5 rounded-lg py-2 text-white/70 hover:bg-white/10 hover:text-white",
          "data-[state=active]:border-transparent data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-white/20 data-[state=active]:hover:text-white",
          collapsed ? "justify-center px-0" : "justify-start px-3",
        )}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/30 text-[11px] font-semibold"
          aria-hidden
        >
          {item.step}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{item.label}</span>
            {item.status === "live" ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                title="Live"
              />
            ) : (
              <span className="text-[10px] text-white/40">
                Preview
              </span>
            )}
          </>
        )}
      </TabsTrigger>
    );
  }

  function renderTrigger(item: NavItem) {
    return (
      <TabsTrigger
        key={item.value}
        value={item.value}
        title={collapsed ? item.label : undefined}
        className={cn(
          "gap-2.5 rounded-lg py-2 text-white/70 hover:bg-white/10 hover:text-white",
          "data-[state=active]:border-transparent data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-white/20 data-[state=active]:hover:text-white",
          collapsed ? "justify-center px-0" : "justify-start px-3",
        )}
      >
        <item.Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
      </TabsTrigger>
    );
  }

  function sectionLabelEl(label: string, first: boolean) {
    if (collapsed) {
      // A thin divider stands in for the header when the sidebar is collapsed.
      return first ? null : (
        <div className="mx-auto my-2 h-px w-6 bg-white/15" aria-hidden />
      );
    }
    return (
      <p
        className={cn(
          "px-3 pb-1 text-[11px] font-medium text-white/40",
          first ? "pt-1" : "pt-4",
        )}
      >
        {label}
      </p>
    );
  }

  // Body for the live Context Engine step (Sources / Graph / Pages).
  function contextBody() {
    const sub = subtabs.context ?? "sources";
    if (sub === "sources") {
      return (
        <div className="space-y-6" key={`sources-${reloadKey}`}>
          <SourcesNetwork onAuthError={onAuthError} />
        </div>
      );
    }
    if (sub === "graph") {
      return (
        <div key={`graph-${reloadKey}`}>
          <BrainGraph
            title={me.org}
            highlightIds={citedIds}
            onAuthError={askAuth}
            onOpenPage={openPageByPath}
            onClearHighlight={() => setCitedIds([])}
          />
        </div>
      );
    }
    return (
      <div key={`pages-${reloadKey}`}>
        <PagesTab
          pages={pages}
          loading={pagesLoading}
          error={pagesError}
          onReload={loadPages}
          onOpen={setOpenPage}
        />
      </div>
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      orientation="vertical"
      className="flex min-h-screen"
    >
      {/* Full-height, collapsible left nav bar */}
      <aside
        className={cn(
          "sticky top-0 z-20 flex h-screen flex-col border-r border-white/10 bg-accent text-accent-foreground transition-[width] duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-white/10 px-3",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {!collapsed && <IotaLogo size={20} color="#ffffff" />}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        <TabsList className="flex flex-1 flex-col items-stretch gap-1 overflow-y-auto rounded-none border-0 bg-transparent p-2 backdrop-blur-none">
          {renderTrigger(OVERVIEW_NAV)}
          {sectionLabelEl("Home turf", false)}
          {STEP_NAV.map((step) => (
            <div key={step.value} className="flex flex-col">
              {renderStepTrigger(step)}
              {/* Sub-tabs live in the nav: they expand under the step once it's
                  the active one, and switch the content on click. */}
              {tab === step.value && !collapsed && (
                <div className="mb-1 ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-white/15 pl-2">
                  {step.subtabs.map((st) => {
                    const on =
                      (subtabs[step.value] ?? step.subtabs[0].value) === st.value;
                    return (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => setSub(step.value, st.value)}
                        className={cn(
                          "rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                          on
                            ? "bg-white/15 font-medium text-white"
                            : "text-white/55 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {isAdmin && (
            <>
              {sectionLabelEl("Admin Center", false)}
              {ADMIN_NAV.map(renderTrigger)}
            </>
          )}
        </TabsList>

        {/* Re-run setup lives at the bottom of the nav, admins only. */}
        {isAdmin && onReopenSetup && (
          <div className="shrink-0 border-t border-white/10 p-2">
            <button
              type="button"
              onClick={reopenSetup}
              disabled={reopening}
              title="Re-run guided setup"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg py-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50",
                collapsed ? "justify-center px-0" : "justify-start px-3",
              )}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <span className="text-sm">
                  {reopening ? "Reopening…" : "Re-run setup"}
                </span>
              )}
            </button>
          </div>
        )}
      </aside>

      {/* Right column: top bar + scrollable content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/70 px-5 backdrop-blur-md md:px-8">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
            <SectionIcon className="h-3.5 w-3.5" />
            {sectionLabel}
          </span>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="text-xs font-medium text-foreground">{me.org}</span>
              <span className="text-[10px] text-foreground-subtle">{me.email}</span>
            </div>
            <Badge variant="accent">{me.role}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl space-y-6 p-5 md:p-8">
          <div>
            <p className="mb-2 text-[13px] font-medium text-accent">
              {activeStep ? `Step ${activeStep.step} · ${me.org}` : me.org}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                {activeNav.title}
              </h1>
              {activeStep &&
                (activeStep.status === "live" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Live
                  </span>
                ) : (
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                    Preview
                  </span>
                ))}
            </div>
            <p className="mt-1 text-sm text-foreground-muted">{activeNav.desc}</p>
          </div>

          {/* ---- Overview: the agent-loop hypothesis tree ---- */}
          <TabsContent value="overview" className="mt-0">
            <div key={`overview-${reloadKey}`}>
              <OverviewPanel onAuthError={onAuthError} />
            </div>
          </TabsContent>

          {/* ---- Home turf: the five steps ---- */}
          <TabsContent value="align" className="mt-0">
            <AlignPanel onAuthError={onAuthError} />
          </TabsContent>

          <TabsContent value="context" className="mt-0">
            {contextBody()}
          </TabsContent>

          <TabsContent value="interview" className="mt-0">
            <ComingSoon blurb="The brain will spot its own blind spots and request the specific interviews that close them, then fold the answers back into the context." />
          </TabsContent>

          <TabsContent value="swarm" className="mt-0">
            <div key={`swarm-${reloadKey}`}>
              <AgentSwarmPanel onAuthError={onAuthError} />
            </div>
          </TabsContent>

          {/* ---- Admin Center (admins only) ---- */}
          {isAdmin && (
            <>
              <TabsContent value="account" className="mt-0">
                <div className="space-y-3" key={`account-${reloadKey}`}>
                  <Expander
                    title="Credits"
                    icon={<Wallet className="h-4 w-4 text-accent" />}
                    defaultOpen
                  >
                    <CreditsPanel onAuthError={onAuthError} embedded />
                  </Expander>
                  <Expander
                    title="Brain activity"
                    icon={<Brain className="h-4 w-4 text-accent" />}
                  >
                    <UsagePanel onAuthError={onAuthError} embedded />
                  </Expander>
                  <Expander
                    title="Mail sync"
                    icon={<RefreshCw className="h-4 w-4 text-accent" />}
                  >
                    <IngestionPanel onAuthError={onAuthError} embedded />
                  </Expander>
                </div>
              </TabsContent>

              <TabsContent value="observability" className="mt-0">
                <div className="space-y-6" key={`observability-${reloadKey}`}>
                  {/* Per-document Drive cost now lives inside this panel's
                      Ingress → Google Drive expander. */}
                  <ObservabilityPanel onAuthError={onAuthError} />
                </div>
              </TabsContent>

              <TabsContent value="triage" className="mt-0">
                <div className="space-y-6" key={`triage-${reloadKey}`}>
                  <ScopePanel onAuthError={onAuthError} />
                  <ScopeApprovalPanel onAuthError={onAuthError} />
                  <CautionPanel onAuthError={onAuthError} />
                </div>
              </TabsContent>

              <TabsContent value="brain" className="mt-0">
                <div className="space-y-6" key={`brain-${reloadKey}`}>
                  <OntologyPanel
                    onAuthError={onAuthError}
                    onSaved={() => setOntologyVersion((v) => v + 1)}
                  />
                  <StarterEntitiesPanel
                    onAuthError={onAuthError}
                    ontologyVersion={ontologyVersion}
                  />
                  <DiligencePanel
                    onAuthError={onAuthError}
                    load={() => api.comprehendSettings()}
                    save={(body) => api.updateComprehendSettings(body)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="team" className="mt-0">
                <div className="space-y-6" key={`team-${reloadKey}`}>
                  <MembersPanel onAuthError={onAuthError} />
                  {me.org && (
                    <WorkspaceDangerZone
                      slug={me.org}
                      onConfirm={(confirm) => api.deleteWorkspace(confirm)}
                      onDeleted={onSignOut}
                      onAuthError={onAuthError}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="usage" className="mt-0">
                <div key={`usage-${reloadKey}`}>
                  <SpendByUserPanel onAuthError={onAuthError} />
                </div>
              </TabsContent>
            </>
          )}
        </main>
      </div>

      {/* Full brain-page detail, opened from a graph node or a Pages card. */}
      <Sheet
        modal={false}
        open={openPage !== null}
        onOpenChange={(o) => {
          if (!o) setOpenPage(null);
        }}
      >
        <SheetContent showOverlay={false}>
          {openPage && (
            <>
              <SheetTitle className="sr-only">{openPage.name}</SheetTitle>
              <SheetDescription className="sr-only">
                Brain page detail for {openPage.name}
              </SheetDescription>
              <BrainPageDetail page={openPage} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}
