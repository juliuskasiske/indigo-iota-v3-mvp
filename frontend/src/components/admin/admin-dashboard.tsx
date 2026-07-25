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
  FileText,
  ClipboardCheck,
  Wallet,
  Brain,
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
import { AskBox } from "@/components/ask/ask-box";
import { BrainGraph } from "@/components/ask/brain-graph";
import { PagesTab } from "@/components/ask/pages-tab";
import { DeliveryTab } from "@/components/ask/delivery-tab";
import { DocumentsTab } from "@/components/ask/documents-tab";
import { ConnectTab } from "@/components/ask/connect-tab";
import { BrainPageDetail } from "@/components/ask/brain-page-detail";
import { cn } from "@/lib/utils";
import { api, ApiError, type Me, type BrainPage } from "@/lib/api";

type NavItem = {
  value: string;
  label: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
};

// "Home turf" — the brain itself, available to every member. Sits on TOP of the
// sidebar, above the admin-only section.
const HOME_NAV: NavItem[] = [
  {
    value: "ask",
    label: "Ask",
    title: "Ask your brain",
    desc: "Ask anything about the people, projects, and commitments across your workspace. Answers cite the email and entity context they came from.",
    Icon: Sparkles,
  },
  {
    value: "delivery",
    label: "Delivery",
    title: "Delivery",
    desc: "To-dos needing action in the next 24 hours, most urgent first. Delegate any to Indigo Iota to draft and refine the deliverable.",
    Icon: ClipboardCheck,
  },
  {
    value: "graph",
    label: "Graph",
    title: "Knowledge graph",
    desc: "Explore the entities and the relationships between them. Hover an edge to read the relationship.",
    Icon: Network,
  },
  {
    value: "pages",
    label: "Pages",
    title: "Brain pages",
    desc: "Every page in the brain, grouped by entity type.",
    Icon: Files,
  },
  {
    value: "documents",
    label: "Documents",
    title: "Documents",
    desc: "Every Google Drive file the brain has captured, with its converted Markdown — the text the agents and retrieval actually read.",
    Icon: FileText,
  },
  {
    value: "connect",
    label: "Connect",
    title: "Connect an assistant",
    desc: "Link this workspace's brain to Claude or ChatGPT over MCP — read-only.",
    Icon: Plug,
  },
];

// "Admin Center" — workspace administration, shown only to admins. The same
// panels the onboarding wizard used, freely editable in steady state.
const ADMIN_NAV: NavItem[] = [
  {
    value: "overview",
    label: "Overview",
    title: "Overview",
    desc: "Credits and usage at a glance.",
    Icon: LayoutDashboard,
  },
  {
    value: "capture",
    label: "Sources",
    title: "Sources",
    desc: "The mailboxes Indigo Iota pulls from, on-demand backfills, and connected assistants.",
    Icon: Plug,
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
  const [tab, setTab] = useState("ask");
  const [collapsed, setCollapsed] = useState(false);
  const [reopening, setReopening] = useState(false);

  // Home-turf shared state (was the old Ask page): cited-entity spotlight for the
  // graph, the brain pages list, and the slide-over detail panel.
  const [citedIds, setCitedIds] = useState<string[]>([]);
  const [pages, setPages] = useState<BrainPage[] | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState<BrainPage | null>(null);

  // The Ask/Graph components report auth failures as a string reason; adapt to
  // the dashboard's ApiError-based handler.
  const askAuth = useCallback(
    (reason: string) => onAuthError(new ApiError(401, reason)),
    [onAuthError],
  );

  const adminNav = isAdmin ? ADMIN_NAV : [];
  const activeNav =
    [...HOME_NAV, ...adminNav].find((n) => n.value === tab) ?? HOME_NAV[0];
  const inHome = HOME_NAV.some((n) => n.value === tab);
  const sectionLabel = inHome ? "Home turf" : "Admin Center";
  const SectionIcon = inHome ? Sparkles : ShieldCheck;

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

  // Load pages the first time the Pages tab is opened.
  useEffect(() => {
    if (tab === "pages" && pages === null && !pagesLoading && !pagesError) {
      void loadPages();
    }
  }, [tab, pages, pagesLoading, pagesError, loadPages]);

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
          "px-3 pb-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/40",
          first ? "pt-1" : "pt-4",
        )}
      >
        {label}
      </p>
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
          {sectionLabelEl("Home turf", true)}
          {HOME_NAV.map(renderTrigger)}
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
          <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.18em] text-accent">
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
            <p className="mb-2 text-xs font-mono uppercase tracking-[0.2em] text-accent">
              {me.org}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {activeNav.title}
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">{activeNav.desc}</p>
          </div>

          {/* ---- Home turf ---- */}
          <TabsContent value="ask" className="mt-0">
            <div key={`ask-${reloadKey}`}>
              <AskBox
                onAuthError={askAuth}
                onCited={setCitedIds}
                onViewInGraph={() => setTab("graph")}
              />
            </div>
          </TabsContent>

          <TabsContent value="delivery" className="mt-0">
            <div key={`delivery-${reloadKey}`}>
              <DeliveryTab onAuthError={onAuthError} />
            </div>
          </TabsContent>

          <TabsContent value="graph" className="mt-0">
            <div key={`graph-${reloadKey}`}>
              <BrainGraph
                title={me.org}
                highlightIds={citedIds}
                onAuthError={askAuth}
                onOpenPage={openPageByPath}
                onClearHighlight={() => setCitedIds([])}
              />
            </div>
          </TabsContent>

          <TabsContent value="pages" className="mt-0">
            <div key={`pages-${reloadKey}`}>
              <PagesTab
                pages={pages}
                loading={pagesLoading}
                error={pagesError}
                onReload={loadPages}
                onOpen={setOpenPage}
              />
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <div key={`documents-${reloadKey}`}>
              <DocumentsTab onAuthError={onAuthError} />
            </div>
          </TabsContent>

          <TabsContent value="connect" className="mt-0">
            <div key={`connect-${reloadKey}`}>
              <ConnectTab />
            </div>
          </TabsContent>

          {/* ---- Admin Center (admins only) ---- */}
          {isAdmin && (
            <>
              <TabsContent value="overview" className="mt-0">
                <div className="space-y-3" key={`overview-${reloadKey}`}>
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

              <TabsContent value="capture" className="mt-0">
                <div className="space-y-6" key={`capture-${reloadKey}`}>
                  <SourcesNetwork onAuthError={onAuthError} />
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
