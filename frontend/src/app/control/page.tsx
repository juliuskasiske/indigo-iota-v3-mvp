"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TowerControl,
  LogOut,
  RefreshCw,
  Building2,
  Database,
  BookOpen,
  BarChart3,
  ShieldCheck,
  FolderTree,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OwnerSignIn } from "@/components/control/owner-sign-in";
import { ConnectorStatusPanel } from "@/components/control/connector-status-panel";
import { TenantsPanel } from "@/components/control/tenants-panel";
import { DbBrowserPanel } from "@/components/control/db-browser-panel";
import { OnboardingGuidePanel } from "@/components/control/onboarding-guide-panel";
import { AuthBasicsPanel } from "@/components/control/auth-basics-panel";
import { PlatformUsagePanel } from "@/components/control/platform-usage-panel";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";

const NAV: {
  value: string;
  label: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
}[] = [
  {
    value: "tenants",
    label: "Tenants",
    title: "Tenants",
    desc: "Provision customer workspaces and walk each one through onboarding.",
    Icon: Building2,
  },
  {
    value: "database",
    label: "Database",
    title: "Database",
    desc: "Inspect the databases behind every workspace.",
    Icon: Database,
  },
  {
    value: "guide",
    label: "Guide",
    title: "Guide",
    desc: "The end-to-end runbook for onboarding a new customer.",
    Icon: BookOpen,
  },
  {
    value: "usage",
    label: "Usage",
    title: "Usage",
    desc: "Token and cost spend broken down by workspace and user.",
    Icon: BarChart3,
  },
];

type State =
  | { kind: "loading" }
  | { kind: "signedout"; reason?: string }
  | { kind: "ready" };

export default function ControlTowerPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState("tenants");
  const [collapsed, setCollapsed] = useState(false);

  const loadMe = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const me = await api.me();
      if (me.role !== "owner") {
        setState({
          kind: "signedout",
          reason: `Signed in as ${me.email ?? "a user"} (${me.role}). The Control Tower is owner-only.`,
        });
        return;
      }
      setState({ kind: "ready" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setState({ kind: "signedout" });
        return;
      }
      setState({
        kind: "signedout",
        reason:
          e instanceof Error
            ? `Could not reach the server: ${e.message}`
            : "Could not reach the server.",
      });
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const onAuthError = useCallback((e: ApiError) => {
    setState({
      kind: "signedout",
      reason:
        e.status === 403
          ? "Your session is not the platform owner. Sign in with the owner passphrase."
          : "Your session expired. Please sign in again.",
    });
  }, []);

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // ignore — clearing UI state is what matters
    }
    setState({ kind: "signedout" });
  }

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-foreground-subtle">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (state.kind === "signedout") {
    return <OwnerSignIn reason={state.reason} onSignedIn={loadMe} />;
  }

  const activeNav = NAV.find((n) => n.value === tab) ?? NAV[0];

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      orientation="vertical"
      className="flex min-h-screen"
    >
      {/* Full-height, collapsible left nav bar — same as the Admin Center. */}
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
          {NAV.map(({ value, label, Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              title={collapsed ? label : undefined}
              className={cn(
                "gap-2.5 rounded-lg py-2 text-white/70 hover:bg-white/10 hover:text-white",
                "data-[state=active]:border-transparent data-[state=active]:bg-white/20 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-white/20 data-[state=active]:hover:text-white",
                collapsed ? "justify-center px-0" : "justify-start px-3",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </aside>

      {/* Right column: top bar + scrollable content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/70 px-5 backdrop-blur-md md:px-8">
          <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.18em] text-accent">
            <TowerControl className="h-3.5 w-3.5" />
            Control Tower
          </span>
          <div className="flex items-center gap-3">
            <Badge variant="accent">owner</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl space-y-6 p-5 md:p-8">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-2">
              Platform owner
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              {activeNav.title}
            </h1>
            <p className="text-sm text-foreground-muted mt-1">
              {activeNav.desc}
            </p>
          </div>

          <TabsContent value="tenants" className="mt-0">
            <div className="space-y-6" key={`tenants-${reloadKey}`}>
              <ConnectorStatusPanel onAuthError={onAuthError} />
              <TenantsPanel onAuthError={onAuthError} />
            </div>
          </TabsContent>

          <TabsContent value="database" className="mt-0">
            <div key={`database-${reloadKey}`}>
              <DbBrowserPanel onAuthError={onAuthError} />
            </div>
          </TabsContent>

          <TabsContent value="guide" className="mt-0">
            {/* Two reference docs under one tab: the onboarding runbook and a
                from-scratch authentication explainer. Nested Tabs is an
                independent Radix instance, so it doesn't disturb the left nav. */}
            <Tabs defaultValue="onboarding" className="space-y-5">
              <TabsList>
                <TabsTrigger value="onboarding">
                  <BookOpen className="h-3.5 w-3.5" />
                  Onboarding runbook
                </TabsTrigger>
                <TabsTrigger value="auth">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Authentication basics
                </TabsTrigger>
                <TabsTrigger value="explainer">
                  <FolderTree className="h-3.5 w-3.5" />
                  Codebase explainer
                </TabsTrigger>
              </TabsList>
              <TabsContent value="onboarding" className="mt-0">
                <OnboardingGuidePanel />
              </TabsContent>
              <TabsContent value="auth" className="mt-0">
                <AuthBasicsPanel />
              </TabsContent>
              <TabsContent value="explainer" className="mt-0">
                {/* Owner-only internal docs, served by the API behind
                    require_owner (never the public bundle) and embedded here. */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <p className="max-w-2xl text-sm text-foreground-muted">
                      A guided, plain-language tour of the whole codebase —
                      concepts, architecture, the data model, end-to-end flows,
                      the repository file-by-file, and the new MCP / OAuth
                      connector layer.
                    </p>
                    <a
                      href="/api/platform/explainer/index.html"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                    >
                      Open in new tab
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <iframe
                    src="/api/platform/explainer/index.html"
                    title="Codebase explainer"
                    className="h-[82vh] w-full rounded-lg border border-border bg-white"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="usage" className="mt-0">
            <div key={`usage-${reloadKey}`}>
              <PlatformUsagePanel onAuthError={onAuthError} />
            </div>
          </TabsContent>
        </main>
      </div>
    </Tabs>
  );
}
