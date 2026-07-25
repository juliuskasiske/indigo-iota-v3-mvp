"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, CheckCircle2, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, ApiError, type ScopeApproval } from "@/lib/api";

// Sign-off gate for the triage scope policy. Until an admin approves here,
// capture stays paused — neither the scheduled sync nor a manual backfill will
// pull mail through an unreviewed scope gate. This is the hinge of the guided
// onboarding flow: review the scope above, then sign off to unpause the build.
export function ScopeApprovalPanel({
  onAuthError,
  onApproved,
}: {
  onAuthError: (e: ApiError) => void;
  onApproved?: (approval: ScopeApproval) => void;
}) {
  const [approval, setApproval] = useState<ScopeApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const s = await api.scope();
      setApproval(
        s.approval ?? { approved: false, approved_at: null, approved_by: null },
      );
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load sign-off state.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function approve() {
    if (approving) return;
    setApproving(true);
    setError(null);
    try {
      const res = await api.approveScope();
      setApproval(res.approval);
      onApproved?.(res.approval);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to approve scope.");
    } finally {
      setApproving(false);
    }
  }

  const approved = approval?.approved ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {approved ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <Lock className="h-4 w-4 text-amber-500" />
          )}
          Scope sign-off
        </CardTitle>
        <CardDescription>
          Capture stays paused until you sign off on the scope above. Nothing is
          pulled from the mailboxes — no live sync and no backfill — until an
          admin approves this policy. Review the categories and example snippets,
          then approve to unpause the brain build-up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : approved ? (
          <div className="space-y-3 rounded-md border border-success/30 bg-success/10 px-3 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" />
              Scope approved — capture is live
            </p>
            <p className="text-xs text-foreground-subtle">
              Signed off by{" "}
              <span className="font-mono text-foreground">
                {approval?.approved_by ?? "an admin"}
              </span>
              {approval?.approved_at && (
                <>
                  {" "}
                  on{" "}
                  {new Date(approval.approved_at).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </>
              )}
              . Re-approve any time you change the scope to re-confirm the policy.
            </p>
            <Button variant="outline" size="sm" disabled={approving} onClick={approve}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {approving ? "Re-approving…" : "Re-approve scope"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-4 w-4" />
              Not approved yet — capture is paused
            </p>
            <p className="text-xs text-foreground-subtle">
              Once you approve, the live sync starts pulling enabled mailboxes on
              schedule and the Activate step unlocks for a historical backfill.
            </p>
            <Button disabled={approving} onClick={approve}>
              <ShieldCheck className="h-4 w-4" />
              {approving ? "Approving…" : "Approve scope & enable capture"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
