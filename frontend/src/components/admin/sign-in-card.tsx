"use client";

import { useState } from "react";
import {
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  FlaskConical,
  KeyRound,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, ApiError, ssoLoginUrl, type AuthMethod } from "@/lib/api";

/**
 * Shown when the visitor has no session (or isn't an admin).
 *
 * The visitor first names their workspace; we ask the backend which sign-in
 * method it uses and branch:
 *   - 'entra' → Microsoft SSO (a same-origin redirect).
 *   - 'native' → email + password, then a mandatory authenticator code.
 *
 * The dev-login (local-mirror convenience) stays available at the bottom; the
 * backend only honours it when IOTA_DEV_LOGIN=1 (it 404s in production).
 */

type Stage = "workspace" | "entra" | "password" | "mfa";

export function SignInCard({
  reason,
  onSignedIn,
  eyebrow = "Admin Center",
  title = "Sign in to manage your workspace",
}: {
  reason?: string;
  onSignedIn: () => void;
  eyebrow?: string;
  title?: string;
}) {
  const [stage, setStage] = useState<Stage>("workspace");
  const [slug, setSlug] = useState("");
  const [method, setMethod] = useState<AuthMethod | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [devOpen, setDevOpen] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function resetToWorkspace() {
    setStage("workspace");
    setMethod(null);
    setPassword("");
    setCode("");
    setError(null);
    setNotice(null);
  }

  async function continueFromWorkspace() {
    setError(null);
    setNotice(null);
    const s = slug.trim();
    if (!s) {
      setError("Enter your workspace slug first.");
      return;
    }
    setBusy(true);
    try {
      const { auth_method } = await api.native.method(s);
      setMethod(auth_method);
      if (auth_method === "entra") {
        // Hand straight off to Microsoft — no extra click needed.
        window.location.href = ssoLoginUrl(s);
        return;
      }
      setStage("password");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await api.native.login(slug.trim(), email.trim(), password);
      setPassword("");
      setStage("mfa");
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    if (!code.trim()) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await api.native.loginTotp(slug.trim(), code.trim());
      onSignedIn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("That code didn't match, or your sign-in timed out. Try again.");
      } else {
        setError(e instanceof Error ? e.message : "Verification failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email above, then choose “Forgot password”.");
      return;
    }
    setBusy(true);
    try {
      await api.native.requestReset(slug.trim(), email.trim());
      setNotice(
        "If that email belongs to this workspace, a reset link is on its way. " +
          "Check your inbox.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the reset.");
    } finally {
      setBusy(false);
    }
  }

  async function devSignIn() {
    setError(null);
    if (!slug.trim() || !devEmail.trim()) {
      setError("Workspace slug and email are both required.");
      return;
    }
    setBusy(true);
    try {
      await api.devLogin(slug.trim(), devEmail.trim());
      onSignedIn();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 404
          ? "Dev login is disabled on this server. Use the normal sign-in."
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
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs">
              {eyebrow}
            </span>
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>
            {reason ?? "Admin access is required to view billing, credits, and scope."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-foreground">
              {notice}
            </p>
          )}

          {/* Stage 1 — name the workspace */}
          {stage === "workspace" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Workspace slug</Label>
                <Input
                  id="slug"
                  placeholder="acme"
                  value={slug}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setSlug(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && continueFromWorkspace()}
                />
              </div>
              <Button className="w-full" disabled={busy} onClick={continueFromWorkspace}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue<ArrowRight className="h-4 w-4" /></>}
              </Button>
            </>
          )}

          {/* Stage 2 (native) — email + password */}
          {stage === "password" && method === "native" && (
            <>
              <WorkspaceLine slug={slug} onChange={resetToWorkspace} />
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                />
              </div>
              <Button className="w-full" disabled={busy} onClick={submitPassword}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in<ArrowRight className="h-4 w-4" /></>}
              </Button>
              <button
                type="button"
                onClick={forgotPassword}
                disabled={busy}
                className="block text-xs text-foreground-subtle hover:text-foreground-muted transition-colors mx-auto"
              >
                Forgot password?
              </button>
            </>
          )}

          {/* Stage 3 (native) — authenticator code */}
          {stage === "mfa" && (
            <>
              <div className="flex items-center gap-2 text-sm text-foreground-muted">
                <KeyRound className="h-4 w-4 text-accent" />
                Enter the 6-digit code from your authenticator app.
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">Authenticator code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  autoFocus
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitCode()}
                />
                <p className="text-xs text-foreground-subtle">
                  Lost your device? Enter one of your backup codes instead.
                </p>
              </div>
              <Button className="w-full" disabled={busy} onClick={submitCode}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Verify &amp; sign in<ArrowRight className="h-4 w-4" /></>}
              </Button>
              <button
                type="button"
                onClick={() => { setStage("password"); setCode(""); setError(null); }}
                className="flex items-center gap-1 text-xs text-foreground-subtle hover:text-foreground-muted transition-colors mx-auto"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            </>
          )}

          {/* Dev login — always available; server-gated to local preview. */}
          {stage === "workspace" && (
            <>
              <Separator />
              {!devOpen ? (
                <button
                  type="button"
                  onClick={() => setDevOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-foreground-subtle hover:text-foreground-muted transition-colors mx-auto"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Dev login (local preview)
                </button>
              ) : (
                <div className="space-y-3 rounded-md border border-border bg-background-soft/40 p-3">
                  <p className="text-xs text-foreground-subtle">
                    Local mirror only — issues a session for an existing member
                    without Microsoft.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="dev-email">Member email</Label>
                    <Input
                      id="dev-email"
                      type="email"
                      placeholder="admin@acme.com"
                      value={devEmail}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) => setDevEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && devSignIn()}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    disabled={busy}
                    onClick={devSignIn}
                  >
                    {busy ? "Signing in…" : "Dev sign-in"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** A small "signed in as workspace X — change" line shown above the form. */
function WorkspaceLine({ slug, onChange }: { slug: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background-soft/40 px-3 py-2">
      <span className="text-sm text-foreground-muted">
        Workspace <span className="font-mono text-foreground">{slug.trim()}</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="text-xs text-foreground-subtle hover:text-foreground-muted transition-colors"
      >
        Change
      </button>
    </div>
  );
}
