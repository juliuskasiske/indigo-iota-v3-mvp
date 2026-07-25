"use client";

import { useEffect, useState } from "react";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Power,
  RefreshCw,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  api,
  ApiError,
  type CaptureSource,
  type GdriveProbeResult,
  type GdriveShareTarget,
} from "@/lib/api";

/**
 * Connect-only Google Drive source (v0). Two explicit steps:
 *   1. Share your Drive folder with our service-account email (the one Google
 *      step we can't hide — shown upfront, one click to copy).
 *   2. Paste the folder link, test that we can read it, and connect.
 * Storing the folder is all this does; reading its files is a later phase.
 */
export function GdriveConnect({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [shareTarget, setShareTarget] = useState<GdriveShareTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<GdriveProbeResult | null>(null);
  const [busy, setBusy] = useState(false);

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
      setError(e instanceof Error ? e.message : "Failed to load Drive folders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api
      .gdriveShareTarget()
      .then(setShareTarget)
      .catch((e) => {
        handleAuth(e);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folders = (sources ?? []).filter((s) => s.provider === "gdrive");

  async function copyEmail() {
    if (!shareTarget?.email) return;
    try {
      await navigator.clipboard.writeText(shareTarget.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }

  async function runTest() {
    if (!url.trim() || testing) return;
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await api.testGdriveSource(url.trim()));
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to test the folder.");
    } finally {
      setTesting(false);
    }
  }

  async function connect() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.addGdriveSource(url.trim());
      setSources(s.sources);
      setUrl("");
      setTest(null);
    } catch (e) {
      if (handleAuth(e)) return;
      // The backend rejects with the "share it with us" hint on a 403/404.
      setError(e instanceof Error ? e.message : "Failed to connect the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(src: CaptureSource) {
    if (busy) return;
    setBusy(true);
    try {
      const s = await api.toggleSource(src.id, !src.enabled);
      setSources(s.sources);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to update the folder.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(src: CaptureSource) {
    if (busy) return;
    setBusy(true);
    try {
      const s = await api.removeSource(src.id);
      setSources(s.sources);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to remove the folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 text-sm">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {error}
        </p>
      )}

      {/* Step 1 — grant access. The one Google step we can't hide. */}
      <div className="space-y-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Step 1 · Share your folder with Indigo Iota
        </p>
        {shareTarget?.configured ? (
          <>
            <p className="text-xs text-foreground-subtle">
              In Google Drive, open the folder you want to include → <span className="text-foreground">Share</span> → add this
              address as a <span className="text-foreground">Viewer</span>. Then paste the
              folder link below. (You only do this once per folder.)
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-md border border-border bg-background-soft/50 px-3 py-2 font-mono text-xs text-foreground">
                {shareTarget.email || "—"}
              </code>
              <Button
                variant="outline"
                size="sm"
                disabled={!shareTarget.email}
                onClick={copyEmail}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy email"}
              </Button>
            </div>
          </>
        ) : (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Google Drive isn&apos;t configured on the server yet. Ask your Indigo
            Iota contact to finish Drive setup before connecting a folder.
          </p>
        )}
      </div>

      {/* Connected folders */}
      {loading ? (
        <p className="text-foreground-subtle">Loading…</p>
      ) : folders.length > 0 ? (
        <ul className="space-y-2">
          {folders.map((src) => {
            const link = src.gdrive_folder_id
              ? `https://drive.google.com/drive/folders/${src.gdrive_folder_id}`
              : null;
            return (
              <li
                key={src.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background-soft/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-medium text-foreground">
                      {src.gdrive_folder_name || src.gdrive_folder_id || src.mailbox}
                    </span>
                    <Badge variant={src.enabled ? "success" : "default"}>
                      {src.enabled ? "Connected" : "Paused"}
                    </Badge>
                  </div>
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground"
                    >
                      Open in Drive <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => toggle(src)}
                    title={src.enabled ? "Pause" : "Resume"}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {src.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => remove(src)}
                    title="Remove folder"
                    aria-label="Remove folder"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-foreground-subtle">
          No Drive folders connected yet. Share one with the address above, then
          add its link below.
        </p>
      )}

      {/* Step 2 — paste the link */}
      <div className="space-y-3 border-t border-border/40 pt-4">
        <Label className="text-xs">Step 2 · Paste the Google Drive folder link</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            placeholder="https://drive.google.com/drive/folders/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setTest(null);
            }}
            className="sm:flex-1"
          />
          <Button
            variant="outline"
            disabled={!url.trim() || testing || busy}
            onClick={runTest}
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {testing ? "Testing…" : "Test"}
          </Button>
          <Button
            disabled={!url.trim() || busy || !shareTarget?.configured}
            onClick={connect}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>

        {test && <GdriveTestVerdict result={test} shareEmail={shareTarget?.email} />}

        <p className="text-xs text-foreground-subtle">
          We only read this folder — never write to it — and only after you&apos;ve
          shared it with us. Connecting stores the folder; syncing its files starts
          once Drive ingestion is switched on for your workspace.
        </p>
      </div>
    </div>
  );
}

// The verdict from the live Drive "Test" — readable, or a friendly reason.
function GdriveTestVerdict({
  result,
  shareEmail,
}: {
  result: GdriveProbeResult;
  shareEmail?: string;
}) {
  if (result.status === "readable") {
    return (
      <p className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          We can read this folder
          {result.detail && result.detail !== "ok" ? (
            <>
              {" "}— <span className="font-medium">{result.detail}</span>
            </>
          ) : null}
          . Click Connect to add it.
        </span>
      </p>
    );
  }
  const isShare = result.status === "auth_failed";
  const label =
    result.status === "not_configured"
      ? "Google Drive isn't configured on the server yet."
      : isShare
        ? `We can't see that folder yet. In Google Drive, share it with ${
            shareEmail || "our service account"
          } (Viewer), then test again.`
        : result.detail || "Couldn't check the folder. Check the link and try again.";
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{label}</span>
    </p>
  );
}
