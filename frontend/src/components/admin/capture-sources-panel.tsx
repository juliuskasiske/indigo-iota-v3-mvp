"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  Inbox,
  Plus,
  Trash2,
  History,
  CheckCircle2,
  Power,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Copy,
  Check,
  Server,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  api,
  ApiError,
  type CaptureSource,
  type BackfillResult,
  type MailboxAccess,
  type AccessPolicyCommand,
  type Credits,
  type ImapTestResult,
} from "@/lib/api";

// Default backfill window — mirrors the backend guardrails.
const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_BACKFILL_MAX = 200;
const BACKFILL_MAX_CEILING = 2000;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// One mailbox's row in the backfill form: whether it's ticked, plus its own
// "since" date and max-emails cap (each mailbox is independent).
type BfRow = { selected: boolean; since: string; max: string };

function defaultBfRow(): BfRow {
  return {
    selected: false,
    since: isoDaysAgo(DEFAULT_BACKFILL_DAYS),
    max: String(DEFAULT_BACKFILL_MAX),
  };
}

// Lets a parent (the onboarding wizard) drive the backfill from its own footer
// button, instead of the panel's in-card "Run backfill". run() sweeps whatever
// mailboxes are ticked; it no-ops if nothing is selected or the run is locked.
export interface BackfillHandle {
  run: () => Promise<void>;
}

export const CaptureSourcesPanel = forwardRef<
  BackfillHandle,
  {
    onAuthError: (e: ApiError) => void;
    // Which card(s) to render. The guided onboarding flow splits these across
    // two steps: "sources" lives under Connect, "backfill" under Activate (gated
    // behind scope sign-off). "both" keeps the original combined view.
    mode?: "sources" | "backfill" | "both";
    // Restrict the panel to ONE provider — the Sources network opens this inside
    // a per-provider modal (Microsoft 365 → "graph", IMAP → "imap"). When set,
    // the source list, backfill rows, and add form all scope to that provider,
    // and the add-mode toggle is hidden (the provider is fixed). Unset (the
    // onboarding wizard's usage) keeps the original both-providers behaviour.
    // Email-only panel: it manages Graph + IMAP mailboxes. (Google Drive has its
    // own connect component, so it's deliberately not a value here.)
    providerFilter?: "graph" | "imap";
    // Called after a successful backfill so the parent can refresh onboarding
    // status (e.g. light up the Activate step).
    onBackfilled?: () => void;
    // When true (backfill mode), the controls stay VISIBLE but the run button is
    // disabled — the scope policy isn't signed off yet. We never hide the form,
    // so the feature is always discoverable; we just won't let it run.
    locked?: boolean;
    // When true, hide the in-card "Run backfill" button — a parent owns the run
    // (the wizard footer). The mailbox/since/cap form stays visible.
    hideRunButton?: boolean;
    // Report the run-readiness up so a parent button can enable/disable + label
    // itself (how many mailboxes are ticked, whether a run is in flight).
    onRunStateChange?: (s: { selectedCount: number; running: boolean }) => void;
  }
>(function CaptureSourcesPanel(
  {
    onAuthError,
    mode = "both",
    providerFilter,
    onBackfilled,
    locked = false,
    hideRunButton = false,
    onRunStateChange,
  },
  ref,
) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-source form. The admin picks how a new mailbox connects: a Microsoft
  // Graph mailbox (app-credential access) or a generic IMAP mailbox (host +
  // username + app password). Most customers use one or the other.
  const [addMode, setAddMode] = useState<"graph" | "imap">(
    providerFilter ?? "graph",
  );
  const [newMailbox, setNewMailbox] = useState("");
  // When the panel is scoped to one provider (a Sources-network modal), the add
  // form is fixed to that provider — keep the toggle state in sync and hide it.
  useEffect(() => {
    if (providerFilter) setAddMode(providerFilter);
  }, [providerFilter]);

  // IMAP add-form fields. The app password is sent once over HTTPS and stored
  // encrypted; we never read it back, so the field is local-only.
  const [imapHost, setImapHost] = useState("");
  const [imapUsername, setImapUsername] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapUseSsl, setImapUseSsl] = useState(true);
  const [imapBusy, setImapBusy] = useState(false);
  const [imapTesting, setImapTesting] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<ImapTestResult | null>(
    null,
  );

  // Live access check (the in-sync flag): per-mailbox verdict from Microsoft,
  // keyed by mailbox address. null = not checked yet this session.
  const [access, setAccess] = useState<Record<string, MailboxAccess> | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [connectorMissing, setConnectorMissing] = useState(false);
  // The static Microsoft admin-consent link that grants the connector mail
  // access. Same for every customer; the customer's Global Admin clicks it.
  // null = not loaded yet. configured=false => the connector app id isn't set
  // on the server yet, so there's no link to show.
  const [mailConsent, setMailConsent] = useState<{
    url: string;
    configured: boolean;
  } | null>(null);
  const [consentCopied, setConsentCopied] = useState(false);
  // The Exchange access-policy group address the admin names. Remembered for
  // this browser so it survives reloads (no secret in it).
  const [scopeGroup, setScopeGroup] = useState("");
  // The generated access-policy command (create group + add mailboxes + bind
  // the connector). Built server-side from the enabled mailboxes + the shared
  // connector app id — this panel is the single home for mailbox access.
  const [accessCmd, setAccessCmd] = useState<AccessPolicyCommand | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessCmdError, setAccessCmdError] = useState<string | null>(null);

  // Backfill form. Each mailbox has its OWN row (ticked? + its own since date +
  // its own cap), keyed by source id, so several mailboxes can be swept with
  // different windows in one click.
  const [bfRows, setBfRows] = useState<Record<number, BfRow>>({});
  const [bfRunning, setBfRunning] = useState(false);
  const [bfResult, setBfResult] = useState<BackfillResult | null>(null);
  const [bfError, setBfError] = useState<string | null>(null);

  // Credit balance + per-email cost, so we can quote a backfill before it runs.
  // null = not loaded yet. Refreshed after each backfill so the figures track
  // what was actually spent.
  const [credits, setCredits] = useState<Credits | null>(null);

  const showSources = mode === "sources" || mode === "both";
  const showBackfill = mode === "backfill" || mode === "both";

  function handleAuth(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    return false;
  }

  async function load() {
    setError(null);
    try {
      const s = await api.sources();
      setSources(s.sources);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load mail sources.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the static mail-access consent link (only when the Mail sources card
  // is shown). Failure is non-fatal — the rest of the panel still works.
  useEffect(() => {
    if (!showSources) return;
    let alive = true;
    api
      .mailConsentUrl()
      .then((res) => {
        if (alive) setMailConsent(res);
      })
      .catch((e) => {
        if (handleAuth(e)) return;
        // Non-fatal: just don't show the consent callout.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSources]);

  // Load credit balance + per-email cost so we can quote a backfill before it
  // runs (only when the backfill card is shown). Failure is non-fatal — we just
  // skip the cost estimate.
  async function loadCredits() {
    try {
      setCredits(await api.credits());
    } catch (e) {
      if (handleAuth(e)) return;
      // Non-fatal: just don't show the estimate.
    }
  }
  useEffect(() => {
    if (showBackfill) loadCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBackfill]);

  // Remember the access-policy group address across reloads (no secret in it).
  useEffect(() => {
    const saved = window.localStorage.getItem("ii-scope-group");
    if (saved) setScopeGroup(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("ii-scope-group", scopeGroup);
  }, [scopeGroup]);

  async function checkAccess() {
    if (checking) return;
    setChecking(true);
    setAccessError(null);
    setConnectorMissing(false);
    try {
      const res = await api.sourcesAccess();
      if (!res.connector_configured) {
        setConnectorMissing(true);
        setAccess(null);
        return;
      }
      const byMailbox: Record<string, MailboxAccess> = {};
      for (const r of res.checked) byMailbox[r.mailbox] = r;
      setAccess(byMailbox);
    } catch (e) {
      if (handleAuth(e)) return;
      setAccessError(
        e instanceof Error ? e.message : "Failed to check mailbox access.",
      );
    } finally {
      setChecking(false);
    }
  }

  async function generateAccessCommand() {
    const scope = scopeGroup.trim().toLowerCase();
    if (accessBusy || !scope) return;
    setAccessBusy(true);
    setAccessCmdError(null);
    setAccessCmd(null);
    try {
      setAccessCmd(await api.accessPolicyCommand(scope));
    } catch (e) {
      if (handleAuth(e)) return;
      setAccessCmdError(
        e instanceof Error ? e.message : "Failed to build the access command.",
      );
    } finally {
      setAccessBusy(false);
    }
  }

  async function addSource() {
    const mailbox = newMailbox.trim();
    if (!mailbox || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.addSource(mailbox);
      setSources(s.sources);
      setNewMailbox("");
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to add mailbox.");
    } finally {
      setBusy(false);
    }
  }

  // Build the IMAP form payload, or null if the required bits are missing.
  function imapInput() {
    const host = imapHost.trim();
    const username = imapUsername.trim();
    if (!host || !username || !imapPassword) return null;
    return {
      host,
      username,
      password: imapPassword,
      port: Number(imapPort) || 993,
      use_ssl: imapUseSsl,
    };
  }

  const imapReady = !!imapHost.trim() && !!imapUsername.trim() && !!imapPassword;

  // Try the IMAP credentials live without saving — the "test connection" button.
  async function testImap() {
    const input = imapInput();
    if (!input || imapTesting) return;
    setImapTesting(true);
    setImapTestResult(null);
    setError(null);
    try {
      setImapTestResult(await api.testImapSource(input));
    } catch (e) {
      if (handleAuth(e)) return;
      setError(
        e instanceof Error ? e.message : "Failed to test the IMAP connection.",
      );
    } finally {
      setImapTesting(false);
    }
  }

  async function addImapSource() {
    const input = imapInput();
    if (!input || imapBusy) return;
    setImapBusy(true);
    setError(null);
    try {
      const s = await api.addImapSource(input);
      setSources(s.sources);
      // Clear the form — the password is now encrypted server-side and can't be
      // read back, so we don't keep it around.
      setImapHost("");
      setImapUsername("");
      setImapPassword("");
      setImapPort("993");
      setImapUseSsl(true);
      setImapTestResult(null);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to add IMAP mailbox.");
    } finally {
      setImapBusy(false);
    }
  }

  async function toggle(src: CaptureSource) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.toggleSource(src.id, !src.enabled);
      setSources(s.sources);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to update mailbox.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(src: CaptureSource) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.removeSource(src.id);
      setSources(s.sources);
      setBfRows((prev) => {
        if (!(src.id in prev)) return prev;
        const next = { ...prev };
        delete next[src.id];
        return next;
      });
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to remove mailbox.");
    } finally {
      setBusy(false);
    }
  }

  function updateBfRow(id: number, patch: Partial<BfRow>) {
    setBfRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? defaultBfRow()), ...patch },
    }));
  }

  async function runBackfill() {
    if (bfRunning) return;
    const items = enabled
      .map((s) => ({ id: s.id, row: bfRows[s.id] ?? defaultBfRow() }))
      .filter((x) => x.row.selected)
      .map((x) => ({
        source_id: x.id,
        since: x.row.since || null,
        max_count: Math.max(
          1,
          Math.min(
            BACKFILL_MAX_CEILING,
            Number(x.row.max) || DEFAULT_BACKFILL_MAX,
          ),
        ),
      }));
    if (items.length === 0) return;
    setBfRunning(true);
    setBfError(null);
    setBfResult(null);
    try {
      const res = await api.backfill(items);
      setBfResult(res);
      onBackfilled?.();
      loadCredits(); // balance just moved — refresh the quote
    } catch (e) {
      if (handleAuth(e)) return;
      setBfError(e instanceof Error ? e.message : "Backfill failed.");
    } finally {
      setBfRunning(false);
    }
  }

  // The sources this panel manages: all of them, or just one provider's when a
  // Sources-network modal scopes the panel (providerFilter). Every list/backfill
  // derivation below works off the scoped set so the modal only ever shows — and
  // backfills — that provider's mailboxes.
  const scoped = providerFilter
    ? (sources ?? []).filter((s) => s.provider === providerFilter)
    : // Unfiltered (onboarding wizard): this panel manages EMAIL only, so keep
      // out any non-email providers (e.g. Google Drive, which has its own UI).
      (sources ?? []).filter(
        (s) => s.provider === "graph" || s.provider === "imap",
      );
  const enabled = scoped.filter((s) => s.enabled);
  // Microsoft-specific UI (consent link, live access check, access-policy
  // command) only makes sense for Graph sources — Microsoft knows nothing about
  // a generic IMAP mailbox. Split so we can gate those sections.
  const graphEnabled = enabled.filter((s) => s.provider === "graph");
  const hasImapEnabled = enabled.some((s) => s.provider === "imap");
  // Show the Microsoft consent + access sections unless this is a pure-IMAP
  // workspace (IMAP sources present and no Graph ones) — then they're just noise.
  // An IMAP-scoped modal never shows them, even before any source is added.
  const showGraphAccess =
    providerFilter !== "imap" && !(hasImapEnabled && graphEnabled.length === 0);
  // Enabled Graph inboxes Microsoft is currently refusing — i.e. in the pull
  // list but missing from the access policy. Re-running the command fixes these.
  const blocked = graphEnabled.filter(
    (s) => access?.[s.mailbox]?.status === "blocked",
  );
  const selectedCount = enabled.filter(
    (s) => bfRows[s.id]?.selected,
  ).length;
  const allSelected = enabled.length > 0 && selectedCount === enabled.length;

  // Up-front backfill cost quote. Each mailbox's "Max" is an upper bound on how
  // many emails it'll pull, so the total selected caps × per-email cost is the
  // MOST a run could cost. (Real runs cost less — duplicates and out-of-scope
  // mail are skipped.) We clamp each cap the same way runBackfill does.
  const estimatedEmails = enabled.reduce((sum, s) => {
    const row = bfRows[s.id];
    if (!row?.selected) return sum;
    const cap = Math.max(
      1,
      Math.min(BACKFILL_MAX_CEILING, Number(row.max) || DEFAULT_BACKFILL_MAX),
    );
    return sum + cap;
  }, 0);
  const costPerEmail = credits?.cost_per_email
    ? Number(credits.cost_per_email)
    : null;
  const balance = credits ? Number(credits.balance) : null;
  const estimatedCost =
    costPerEmail !== null ? estimatedEmails * costPerEmail : null;
  const remainingAfter =
    balance !== null && estimatedCost !== null ? balance - estimatedCost : null;
  const overBudget = remainingAfter !== null && remainingAfter < 0;
  // Only show the quote once we have the cost basis and something is selected.
  const showEstimate =
    showBackfill &&
    credits !== null &&
    costPerEmail !== null &&
    selectedCount > 0;

  // Let a parent (wizard footer) run the backfill and track its readiness.
  useImperativeHandle(ref, () => ({ run: runBackfill }));
  useEffect(() => {
    onRunStateChange?.({ selectedCount, running: bfRunning });
  }, [selectedCount, bfRunning, onRunStateChange]);

  function toggleSelectAll() {
    const select = !allSelected;
    setBfRows((prev) => {
      const next = { ...prev };
      for (const s of enabled) {
        next[s.id] = { ...(next[s.id] ?? defaultBfRow()), selected: select };
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {showSources && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-accent" />
            Mail sources
          </CardTitle>
          <CardDescription>
            The mailboxes Indigo Iota pulls from. Each enabled mailbox is synced
            on the regular schedule and feeds the scope gate before anything
            reaches your project brains.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}

          {/* Grant mail access — step one. Before we can pull a single mailbox,
              a Global Admin has to consent to the connector reading mail. This
              is the same link for every customer (built from our shared
              connector app), so it lives right here in onboarding instead of
              being handed over by the operator. */}
          {showGraphAccess &&
            mailConsent &&
            (mailConsent.configured ? (
              <div className="space-y-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4 text-accent" />
                  Grant mail access
                </p>
                <p className="text-xs text-foreground-subtle">
                  A Microsoft Global Admin opens this link once and clicks
                  Accept. It lets Indigo Iota read mail for the mailboxes you
                  add below — nothing is pulled until it&apos;s granted.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    size="sm"
                    onClick={() =>
                      window.open(
                        mailConsent.url,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    Open consent link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(mailConsent.url);
                        setConsentCopied(true);
                        setTimeout(() => setConsentCopied(false), 1500);
                      } catch {
                        // clipboard blocked — no-op
                      }
                    }}
                  >
                    {consentCopied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {consentCopied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                The mail-access consent link isn&apos;t available yet — this
                workspace&apos;s connector app isn&apos;t configured on the
                server. Ask your Indigo Iota contact to finish connector setup.
              </p>
            ))}

          {/* In-sync flag: ask Microsoft which of these inboxes we can actually
              read. An inbox can sit in this list yet be blocked by the Exchange
              access policy — this surfaces that instead of failing silently. */}
          {!loading && graphEnabled.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background-soft/20 px-3 py-2">
              <span className="text-xs text-foreground-subtle">
                Check that each Microsoft inbox is actually in your access policy
                (we ask Microsoft directly).
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={checking}
                onClick={checkAccess}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
                />
                {checking ? "Checking…" : "Check access"}
              </Button>
            </div>
          )}

          {accessError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {accessError}
            </p>
          )}
          {connectorMissing && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
              Can&apos;t check access yet — this workspace&apos;s mail connector
              credentials aren&apos;t configured.
            </p>
          )}

          {loading ? (
            <p className="text-foreground-subtle">Loading…</p>
          ) : (
            <>
              {scoped.length > 0 ? (
                <ul className="space-y-2">
                  {scoped.map((src) => (
                    <li
                      key={src.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background-soft/20 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-xs text-foreground">
                            {src.mailbox}
                          </span>
                          <ProviderBadge provider={src.provider} />
                          <Badge variant={src.enabled ? "success" : "default"}>
                            {src.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          {src.enabled && src.provider === "graph" && (
                            <AccessBadge verdict={access?.[src.mailbox]} />
                          )}
                        </div>
                        <span className="text-[11px] text-foreground-subtle">
                          {src.provider === "imap" && src.imap_host
                            ? `${src.imap_host} · all folders except Junk, Trash, and Drafts`
                            : "all folders except Junk, Deleted Items, and Drafts"}
                        </span>
                        <CaptureStats source={src} />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => toggle(src)}
                          title={src.enabled ? "Disable" : "Enable"}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {src.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          onClick={() => remove(src)}
                          title="Remove mailbox"
                          aria-label={`Remove ${src.mailbox}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-foreground-subtle">
                  No mailboxes yet. Add one below to start pulling mail.
                </p>
              )}

              <div className="space-y-3 border-t border-border/40 pt-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Label className="text-xs">Add a mailbox</Label>

                  {/* How does this mailbox connect? Microsoft customers use Graph
                      (app-credential access); everyone else uses generic IMAP with
                      a host + username + app password. Hidden when the panel is
                      already scoped to one provider (a Sources-network modal). */}
                  {!providerFilter && (
                    <div className="inline-flex gap-1 rounded-lg border border-border/60 bg-background-soft/30 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setAddMode("graph")}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                          addMode === "graph"
                            ? "bg-background-elevated text-foreground shadow-sm"
                            : "text-foreground-subtle hover:text-foreground"
                        }`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Microsoft 365
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddMode("imap")}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                          addMode === "imap"
                            ? "bg-background-elevated text-foreground shadow-sm"
                            : "text-foreground-subtle hover:text-foreground"
                        }`}
                      >
                        <Server className="h-3.5 w-3.5" />
                        IMAP (custom domain)
                      </button>
                    </div>
                  )}
                </div>

                {addMode === "graph" ? (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={newMailbox}
                        placeholder="ops@your-company.com"
                        disabled={busy}
                        onChange={(e) => setNewMailbox(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSource();
                          }
                        }}
                        className="sm:flex-1"
                      />
                      <Button
                        disabled={busy || !newMailbox.trim()}
                        onClick={addSource}
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-foreground-subtle">
                      The mailbox must be covered by this workspace&apos;s
                      connector consent. Indigo Iota pulls from all of its folders
                      except Junk, Deleted Items, and Drafts, and re-checks that
                      list on every sync.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border border-border/60 bg-background-soft/20 px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-[11px] text-foreground-subtle">
                          IMAP server (host)
                        </Label>
                        <Input
                          value={imapHost}
                          placeholder="imap.your-host.com"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          disabled={imapBusy}
                          onChange={(e) => {
                            setImapHost(e.target.value);
                            setImapTestResult(null);
                          }}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-subtle">
                          Username (the mailbox)
                        </Label>
                        <Input
                          value={imapUsername}
                          placeholder="ops@your-company.com"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          disabled={imapBusy}
                          onChange={(e) => {
                            setImapUsername(e.target.value);
                            setImapTestResult(null);
                          }}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-subtle">
                          App password
                        </Label>
                        <Input
                          type="password"
                          value={imapPassword}
                          placeholder="••••••••••••"
                          autoComplete="new-password"
                          disabled={imapBusy}
                          onChange={(e) => {
                            setImapPassword(e.target.value);
                            setImapTestResult(null);
                          }}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-subtle">
                          Port
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={imapPort}
                          disabled={imapBusy}
                          onChange={(e) => {
                            setImapPort(e.target.value);
                            setImapTestResult(null);
                          }}
                          className="h-8 w-24"
                        />
                      </div>
                      <label className="flex items-center gap-2 self-end pb-1.5 text-xs text-foreground-subtle">
                        <input
                          type="checkbox"
                          checked={imapUseSsl}
                          disabled={imapBusy}
                          onChange={(e) => {
                            setImapUseSsl(e.target.checked);
                            setImapTestResult(null);
                          }}
                          className="h-4 w-4 accent-accent"
                        />
                        Use SSL/TLS
                      </label>
                    </div>

                    {imapTestResult && (
                      <ImapTestVerdict result={imapTestResult} />
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!imapReady || imapTesting || imapBusy}
                        onClick={testImap}
                      >
                        {imapTesting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {imapTesting ? "Testing…" : "Test connection"}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!imapReady || imapBusy}
                        onClick={addImapSource}
                      >
                        {imapBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        {imapBusy ? "Adding…" : "Add IMAP mailbox"}
                      </Button>
                    </div>
                    <p className="text-xs text-foreground-subtle">
                      The app password is sent once over HTTPS and stored
                      encrypted — it&apos;s never shown again. Indigo Iota pulls
                      from all of the mailbox&apos;s folders except Junk, Trash,
                      and Drafts, re-checked on every sync.
                    </p>
                  </div>
                )}
              </div>

              {/* Mailbox access policy — the single home for granting the
                  connector access. The connector can't read a single mailbox
                  until Exchange grants it, so this is the prerequisite for
                  everything downstream. Name the scope group; we generate the
                  exact command (create the group, add the mailboxes above, bind
                  the connector) for you or your Exchange admin to run. */}
              {graphEnabled.length > 0 && (
                <div className="space-y-3 rounded-md border border-border/60 bg-background-soft/20 px-3 py-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    Mailbox access policy
                  </p>
                  <p className="text-xs text-foreground-subtle">
                    The connector can&apos;t read a Microsoft mailbox until
                    Exchange grants it access. Name your access-policy group and
                    we&apos;ll generate the exact PowerShell — it creates the
                    group, adds the{" "}
                    {graphEnabled.length === 1
                      ? "mailbox"
                      : `${graphEnabled.length} mailboxes`}{" "}
                    above, and binds the connector to them. Run it yourself or hand
                    it to your Exchange admin.
                    {blocked.length > 0 && (
                      <>
                        {" "}
                        <span className="font-medium text-destructive">
                          {blocked.length}{" "}
                          {blocked.length === 1 ? "inbox is" : "inboxes are"}{" "}
                          currently blocked — running this grants{" "}
                          {blocked.length === 1 ? "it" : "them"} access.
                        </span>
                      </>
                    )}
                  </p>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-foreground-subtle">
                      Access-policy group address (created if missing)
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={scopeGroup}
                        placeholder="iota-scope@your-company.com"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => setScopeGroup(e.target.value)}
                        className="h-8 sm:flex-1"
                      />
                      <Button
                        size="sm"
                        disabled={accessBusy || !scopeGroup.trim()}
                        onClick={generateAccessCommand}
                      >
                        {accessBusy ? "Building…" : "Generate access command"}
                      </Button>
                    </div>
                  </div>

                  {accessCmdError && (
                    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {accessCmdError}
                    </p>
                  )}

                  {accessCmd && (
                    <div className="space-y-3">
                      {!accessCmd.connector_configured && (
                        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                          No connector app id is set on the server yet, so the
                          command below uses a placeholder
                          (&lt;CONNECTOR-APP-ID&gt;). Replace it with the connector
                          app&apos;s Application (client) ID before running.
                        </p>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-subtle">
                          Run this (you or your Exchange admin)
                        </Label>
                        <FixCommandBlock command={accessCmd.command} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-foreground-subtle">
                          Then verify it took effect
                        </Label>
                        <FixCommandBlock command={accessCmd.test_command} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}

      {showBackfill && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-accent" />
            Backfill history
          </CardTitle>
          <CardDescription>
            Pull a bounded window of older mail in addition to the live sync.
            Tick the mailboxes you want, give each its own start date and email
            cap, and sweep them all in one run. Goes through the same scope gate
            and skips anything already captured, so it&apos;s safe to re-run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {locked && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Set up your windows below, but the run stays disabled until the
                triage scope is approved (in the Triage step). The brain
                build-up is the last step — we never pull mail through an
                unreviewed scope gate.
              </span>
            </p>
          )}

          {bfError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {bfError}
            </p>
          )}

          {enabled.length === 0 ? (
            <p className="text-xs text-foreground-subtle">
              Add and enable a mailbox above before running a backfill.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    Mailboxes — set a start date and email cap for each
                  </Label>
                  <button
                    type="button"
                    disabled={bfRunning}
                    onClick={toggleSelectAll}
                    className="text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {enabled.map((s) => {
                    const row = bfRows[s.id] ?? defaultBfRow();
                    return (
                      <li
                        key={s.id}
                        className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background-soft/20 px-3 py-2.5 sm:flex-row sm:items-end sm:justify-between"
                      >
                        <label className="flex items-center gap-2 sm:flex-1 sm:self-center">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={bfRunning}
                            onChange={(e) =>
                              updateBfRow(s.id, { selected: e.target.checked })
                            }
                            className="h-4 w-4 accent-accent"
                          />
                          <span className="truncate font-mono text-xs text-foreground">
                            {s.mailbox}
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-foreground-subtle">
                              Since
                            </Label>
                            <Input
                              type="date"
                              value={row.since}
                              disabled={bfRunning || !row.selected}
                              onChange={(e) =>
                                updateBfRow(s.id, { since: e.target.value })
                              }
                              className="h-8 w-[9.5rem]"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-foreground-subtle">
                              Max (≤{" "}
                              {BACKFILL_MAX_CEILING.toLocaleString("en-US")})
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={BACKFILL_MAX_CEILING}
                              value={row.max}
                              disabled={bfRunning || !row.selected}
                              onChange={(e) =>
                                updateBfRow(s.id, { max: e.target.value })
                              }
                              className="h-8 w-24"
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Up-front cost quote: what's available, the most this run could
                  cost, and what's left after. The cost is an upper bound — real
                  runs cost less because duplicates and out-of-scope mail are
                  skipped before any LLM work. */}
              {showEstimate && (
                <div
                  className={`space-y-2 rounded-md border px-3 py-3 ${
                    overBudget
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-border/60 bg-background-soft/20"
                  }`}
                >
                  <p className="text-xs font-medium text-foreground">
                    Estimated cost
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <MoneyStat label="Available now" value={balance} />
                    <MoneyStat
                      label={`Up to (${estimatedEmails.toLocaleString("en-US")} ${
                        estimatedEmails === 1 ? "email" : "emails"
                      })`}
                      value={estimatedCost}
                      prefix="−"
                    />
                    <MoneyStat
                      label="Credits after"
                      value={remainingAfter}
                      tone={overBudget ? "bad" : "good"}
                    />
                  </div>
                  {overBudget ? (
                    <p className="text-[11px] text-destructive">
                      This run could exceed your balance. It pauses at zero —
                      lower a mailbox cap or add credits to cover the rest.
                    </p>
                  ) : (
                    <p className="text-[11px] text-foreground-subtle">
                      Upper bound — duplicates and out-of-scope mail are skipped,
                      so the real cost is usually lower. 1 credit = $1.
                    </p>
                  )}
                </div>
              )}

              {!hideRunButton && (
                <div className="flex items-center gap-2">
                  <Button
                    disabled={bfRunning || selectedCount === 0 || locked}
                    onClick={runBackfill}
                  >
                    <History className="h-4 w-4" />
                    {bfRunning
                      ? "Running…"
                      : locked
                        ? "Approve scope to run"
                        : selectedCount > 1
                          ? `Run backfill (${selectedCount} mailboxes)`
                          : "Run backfill"}
                  </Button>
                  <span className="text-xs text-foreground-subtle">
                    Newest mail first, up to each mailbox&apos;s cap.
                  </span>
                </div>
              )}

              {bfResult && (
                <div className="space-y-3 rounded-md border border-success/30 bg-success/10 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Backfilled {bfResult.results.length}{" "}
                    {bfResult.results.length === 1 ? "mailbox" : "mailboxes"}
                  </p>

                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-success">
                      Totals
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <Stat label="Fetched" value={bfResult.totals.fetched} />
                      <Stat
                        label="Included"
                        value={bfResult.totals.included}
                        tone="success"
                      />
                      <Stat label="Excluded" value={bfResult.totals.excluded} />
                      <Stat
                        label="Duplicates"
                        value={bfResult.totals.duplicates}
                      />
                      <Stat label="Removed" value={bfResult.totals.removed} />
                    </div>
                  </div>

                  {bfResult.results.length > 1 && (
                    <div className="space-y-2 border-t border-success/20 pt-2">
                      {bfResult.results.map((r) => (
                        <div key={r.mailbox} className="space-y-1">
                          <div className="text-[11px] text-foreground-subtle">
                            <span className="font-mono text-foreground">
                              {r.mailbox}
                            </span>{" "}
                            ({r.folders}{" "}
                            {r.folders === 1 ? "folder" : "folders"}, since{" "}
                            {r.since.slice(0, 10)}, cap{" "}
                            {r.max_count.toLocaleString("en-US")})
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            <Stat label="Fetched" value={r.result.fetched} />
                            <Stat
                              label="Included"
                              value={r.result.included}
                              tone="success"
                            />
                            <Stat label="Excluded" value={r.result.excluded} />
                            <Stat
                              label="Duplicates"
                              value={r.result.duplicates}
                            />
                            <Stat label="Removed" value={r.result.removed} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
});

// Per-mailbox capture footprint, shown under each source so an admin can judge
// how far back the brain reaches for that account and whether more backfill is
// worth it. This is the TOTAL captured (live sync + manual backfill combined —
// the two aren't separable), so it's deliberately labelled "captured", not
// "backfilled". Hidden entirely until at least one email has been captured.
function CaptureStats({ source }: { source: CaptureSource }) {
  if (!source.captured) {
    return (
      <span className="mt-0.5 block text-[11px] text-foreground-subtle">
        No mail captured yet — runs on the next sync, or backfill below.
      </span>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-subtle">
      <span>
        <span className="font-semibold text-foreground">
          {source.captured.toLocaleString("en-US")}
        </span>{" "}
        captured
      </span>
      {source.oldest_email && (
        <span>
          oldest{" "}
          <span className="text-foreground">{fmtDay(source.oldest_email)}</span>
        </span>
      )}
      {source.last_capture && (
        <span>
          last{" "}
          <span className="text-foreground">{fmtDay(source.last_capture)}</span>
        </span>
      )}
    </span>
  );
}

// Short calendar date (no time) for the capture-footprint line.
function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// How a source connects, shown as a small chip next to the mailbox so an admin
// can tell Microsoft mailboxes from generic IMAP ones at a glance.
function ProviderBadge({ provider }: { provider: CaptureSource["provider"] }) {
  // This panel only renders email sources; a non-email provider would never
  // reach here, but accept the wider type and no-op defensively.
  if (provider !== "graph" && provider !== "imap") return null;
  if (provider === "imap") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background-elevated/60 px-2 py-0.5 text-[10px] font-medium text-foreground-subtle">
        <Server className="h-3 w-3" />
        IMAP
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent">
      <ShieldCheck className="h-3 w-3" />
      Microsoft
    </span>
  );
}

// The verdict from a live IMAP "test connection" — readable (logged in + opened
// the inbox), auth_failed (bad host/username/password), or a transport error.
function ImapTestVerdict({ result }: { result: ImapTestResult }) {
  if (result.status === "readable") {
    return (
      <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Connected and read the inbox. These credentials work.</span>
      </p>
    );
  }
  const label =
    result.status === "auth_failed"
      ? "Login failed — check the username and app password."
      : "Couldn't connect — check the host, port, and SSL setting.";
  return (
    <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {label}
        {result.detail ? (
          <span className="mt-0.5 block font-mono text-[10px] opacity-80">
            {result.detail}
          </span>
        ) : null}
      </span>
    </p>
  );
}

// The live access verdict shown next to each inbox. Undefined = not checked yet.
function AccessBadge({ verdict }: { verdict?: MailboxAccess }) {
  if (!verdict) {
    return (
      <span className="text-[10px] text-foreground-subtle">access not checked</span>
    );
  }
  if (verdict.status === "readable") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
        title={verdict.detail}
      >
        <ShieldCheck className="h-3 w-3" />
        Readable
      </span>
    );
  }
  if (verdict.status === "blocked") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive"
        title={verdict.detail}
      >
        <ShieldAlert className="h-3 w-3" />
        Blocked — not in policy
      </span>
    );
  }
  // not_found / error: surface the reason on hover.
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
      title={verdict.detail}
    >
      <ShieldAlert className="h-3 w-3" />
      {verdict.status === "not_found" ? "No such mailbox" : "Check failed"}
    </span>
  );
}

function FixCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-foreground-subtle">
          Run in Exchange Online PowerShell
        </span>
        <Button variant="ghost" size="sm" onClick={copy} title="Copy">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border/60 bg-background-elevated/60 px-3 py-2 text-[11px] leading-relaxed text-foreground">
        <code>{command}</code>
      </pre>
    </div>
  );
}

// A money figure in the backfill cost quote. Renders USD with cents; a leading
// "−" marks the amount a run subtracts. tone colours the "after" figure.
function MoneyStat({
  label,
  value,
  prefix,
  tone,
}: {
  label: string;
  value: number | null;
  prefix?: string;
  tone?: "good" | "bad";
}) {
  const text =
    value === null
      ? "—"
      : `${prefix ?? ""}${value.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}`;
  return (
    <div className="rounded-md border border-border/50 bg-background-elevated/60 px-2 py-1.5 text-center">
      <div
        className={
          tone === "bad"
            ? "text-base font-semibold text-destructive"
            : tone === "good"
              ? "text-base font-semibold text-success"
              : "text-base font-semibold text-foreground"
        }
      >
        {text}
      </div>
      <div className="text-[10px] text-foreground-subtle">{label}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success";
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-elevated/60 px-2 py-1.5 text-center">
      <div
        className={
          tone === "success"
            ? "text-base font-semibold text-success"
            : "text-base font-semibold text-foreground"
        }
      >
        {value.toLocaleString("en-US")}
      </div>
      <div className="text-[10px] text-foreground-subtle">{label}</div>
    </div>
  );
}
