"use client";

import { useState } from "react";
import { TowerControl, ArrowRight } from "lucide-react";
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
import { api, ApiError } from "@/lib/api";

/**
 * Gate for the Control Tower. The platform owner is cross-org and has no
 * membership, so they sign in with the shared passphrase (PLATFORM_OWNER_TOKEN)
 * rather than Microsoft SSO. The backend 503s if no passphrase is configured.
 */
export function OwnerSignIn({
  reason,
  onSignedIn,
}: {
  reason?: string;
  onSignedIn: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    if (!token.trim()) {
      setError("Enter the owner passphrase.");
      return;
    }
    setBusy(true);
    try {
      await api.ownerLogin(token.trim());
      onSignedIn();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 503
          ? "Owner access is not configured on this server (PLATFORM_OWNER_TOKEN unset)."
          : e instanceof Error
            ? e.message
            : "Sign-in failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2 text-accent mb-1">
            <TowerControl className="h-5 w-5" />
            <span className="text-xs font-mono uppercase tracking-[0.18em]">
              Control Tower
            </span>
          </div>
          <CardTitle className="text-xl">Platform owner sign-in</CardTitle>
          <CardDescription>
            {reason ??
              "Provision tenants, wire SSO, and check connector access. Owner-only."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="owner-token">Owner passphrase</Label>
            <Input
              id="owner-token"
              type="password"
              placeholder="••••••••••••"
              value={token}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
          </div>

          <Button className="w-full" disabled={busy} onClick={signIn}>
            {busy ? "Signing in…" : "Enter Control Tower"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
