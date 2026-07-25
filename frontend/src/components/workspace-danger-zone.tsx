"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
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
import { ApiError, type WorkspaceErasure } from "@/lib/api";

/**
 * Reusable "delete this workspace" danger zone. Used both by the operator
 * (Control Tower, deleting any tenant) and by a workspace admin (Admin Center,
 * deleting their own). Irreversible — drops the tenant database outright — so it
 * is gated behind typed confirmation: the caller must retype the workspace slug.
 *
 * The `onConfirm` callback owns which endpoint runs (platform vs admin); this
 * component only handles the confirm UX and surfaces the result.
 */
export function WorkspaceDangerZone({
  slug,
  onConfirm,
  onDeleted,
  onAuthError,
}: {
  slug: string;
  onConfirm: (confirm: string) => Promise<WorkspaceErasure>;
  onDeleted: (result: WorkspaceErasure) => void;
  onAuthError?: (e: ApiError) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim() === slug;

  async function run() {
    if (!confirmed || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await onConfirm(typed.trim());
      onDeleted(result);
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.status === 401 || e.status === 403) &&
        onAuthError
      ) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Deletion failed.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Delete this workspace
        </CardTitle>
        <CardDescription>
          Permanently erases this workspace. Its entire brain database — every
          captured email, entity and embedding — is dropped, and all personal
          data (members, sign-in credentials, mailbox connections) is wiped from
          the control plane. Billing and usage records are retained for
          accounting. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`confirm-delete-${slug}`}>
            Type{" "}
            <span className="font-mono font-semibold text-foreground">
              {slug}
            </span>{" "}
            to confirm
          </Label>
          <Input
            id={`confirm-delete-${slug}`}
            value={typed}
            placeholder={slug}
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            className="sm:max-w-xs"
          />
        </div>
        <Button
          variant="destructive"
          disabled={!confirmed || busy}
          onClick={run}
        >
          <Trash2 className="h-4 w-4" />
          {busy ? "Deleting…" : "Delete workspace permanently"}
        </Button>
      </CardContent>
    </Card>
  );
}
