"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ShieldCheck,
  ArrowRight,
  Loader2,
  Smartphone,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  PasswordFields,
  passwordIssue,
} from "@/components/auth/password-fields";
import { api, ApiError, type TotpEnrollment } from "@/lib/api";

/** Where to land once the account is fully set up and signed in. */
const AFTER = "/admin/";

type Step = "loading" | "invalid" | "password" | "totp" | "done";

function secretFromUri(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.searchParams.get("secret");
  } catch {
    return null;
  }
}

function AcceptInviteInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");

  // Validate the invite link up front so we can greet the user (or explain
  // that the link is dead) before they type anything.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStep("invalid");
      return;
    }
    api.native
      .inviteLookup(token)
      .then((r) => {
        if (cancelled) return;
        if (r.valid) {
          setEmail(r.email ?? null);
          setStep("password");
        } else {
          setStep("invalid");
        }
      })
      .catch(() => !cancelled && setStep("invalid"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submitPassword() {
    setError(null);
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    try {
      await api.native.setPassword(token, password);
      const e = await api.native.totpBegin(token);
      setEnroll(e);
      setStep("totp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set your password.");
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
      await api.native.totpConfirm(token, code.trim());
      setStep("done");
      window.location.href = AFTER;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setError("That code didn't match. Check your authenticator app and try again.");
      } else {
        setError(e instanceof Error ? e.message : "Verification failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function copyCodes() {
    if (!enroll) return;
    navigator.clipboard?.writeText(enroll.backup_codes.join("\n")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  const manualSecret = enroll ? secretFromUri(enroll.otpauth_uri) : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <IotaLogo size={30} />
        </div>
        <div className="rounded-xl border border-border bg-background-elevated p-6 shadow-sm">
          <div className="flex items-center gap-2 text-accent mb-1">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs">
              Set up your account
            </span>
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {step === "loading" && (
            <div className="flex items-center gap-2 py-10 text-foreground-muted justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              Checking your invitation…
            </div>
          )}

          {step === "invalid" && (
            <div className="py-6">
              <h1 className="text-lg font-semibold mb-1">This link can&apos;t be used</h1>
              <p className="text-sm text-foreground-muted">
                Your invitation link is invalid, already used, or has expired.
                Ask your administrator to send a fresh invite.
              </p>
            </div>
          )}

          {step === "password" && (
            <div className="mt-4 space-y-5">
              <div>
                <h1 className="text-lg font-semibold">Choose a password</h1>
                <p className="text-sm text-foreground-muted">
                  {email ? (
                    <>Setting up <span className="font-mono text-foreground">{email}</span>.</>
                  ) : (
                    "Pick a strong password to finish setting up your account."
                  )}
                </p>
              </div>
              <PasswordFields
                password={password}
                confirm={confirm}
                onPassword={setPassword}
                onConfirm={setConfirm}
                onSubmit={submitPassword}
              />
              <Button className="w-full" disabled={busy} onClick={submitPassword}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue<ArrowRight className="h-4 w-4" /></>}
              </Button>
            </div>
          )}

          {step === "totp" && enroll && (
            <div className="mt-4 space-y-5">
              <div>
                <h1 className="text-lg font-semibold flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-accent" />
                  Add an authenticator
                </h1>
                <p className="text-sm text-foreground-muted">
                  Scan this with Google Authenticator, 1Password, Authy, or any
                  TOTP app. A code is required every time you sign in.
                </p>
              </div>

              <div className="flex justify-center">
                <div className="rounded-lg bg-white p-3">
                  {/* Server-rendered QR PNG (data URI) — no client QR lib. */}
                  <Image
                    src={enroll.qr_data_uri}
                    alt="Authenticator QR code"
                    width={176}
                    height={176}
                    unoptimized
                  />
                </div>
              </div>

              {manualSecret && (
                <p className="text-center text-xs text-foreground-subtle">
                  Can&apos;t scan? Enter this key manually:{" "}
                  <span className="font-mono text-foreground break-all">{manualSecret}</span>
                </p>
              )}

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4 text-accent" />
                    Backup codes
                  </Label>
                  <button
                    type="button"
                    onClick={copyCodes}
                    className="flex items-center gap-1 text-xs text-foreground-subtle hover:text-foreground-muted transition-colors"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy all"}
                  </button>
                </div>
                <p className="text-xs text-foreground-subtle">
                  Save these somewhere safe. Each one signs you in once if you
                  lose your authenticator.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-background-soft/40 p-3 font-mono text-sm">
                  {enroll.backup_codes.map((c) => (
                    <span key={c} className="text-foreground">{c}</span>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground-muted pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={savedCodes}
                    onChange={(e) => setSavedCodes(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-[#3812f3]"
                  />
                  I&apos;ve saved my backup codes
                </label>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="totp-code">Enter the 6-digit code to confirm</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && savedCodes && submitCode()}
                />
              </div>
              <Button
                className="w-full"
                disabled={busy || !savedCodes}
                onClick={submitCode}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Finish &amp; sign in<ArrowRight className="h-4 w-4" /></>}
              </Button>
              {!savedCodes && (
                <p className="text-center text-xs text-foreground-subtle">
                  Confirm you&apos;ve saved your backup codes to continue.
                </p>
              )}
            </div>
          )}

          {step === "done" && (
            <div className="flex items-center gap-2 py-10 text-foreground-muted justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              You&apos;re all set — signing you in…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-foreground-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
          Loading…
        </div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
