"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";
import {
  PasswordFields,
  passwordIssue,
} from "@/components/auth/password-fields";
import { api } from "@/lib/api";

type Step = "loading" | "invalid" | "form" | "done";

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStep("invalid");
      return;
    }
    api.native
      .resetLookup(token)
      .then((r) => {
        if (cancelled) return;
        if (r.valid) {
          setEmail(r.email ?? null);
          setStep("form");
        } else {
          setStep("invalid");
        }
      })
      .catch(() => !cancelled && setStep("invalid"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    setError(null);
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    try {
      await api.native.resetConfirm(token, password);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset your password.");
    } finally {
      setBusy(false);
    }
  }

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
              Reset your password
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
              Checking your link…
            </div>
          )}

          {step === "invalid" && (
            <div className="py-6">
              <h1 className="text-lg font-semibold mb-1">This link can&apos;t be used</h1>
              <p className="text-sm text-foreground-muted">
                Your reset link is invalid, already used, or has expired. Start a
                new reset from the sign-in page.
              </p>
            </div>
          )}

          {step === "form" && (
            <div className="mt-4 space-y-5">
              <div>
                <h1 className="text-lg font-semibold">Choose a new password</h1>
                <p className="text-sm text-foreground-muted">
                  {email ? (
                    <>For <span className="font-mono text-foreground">{email}</span>.</>
                  ) : (
                    "Pick a strong password you don't use anywhere else."
                  )}{" "}
                  Your authenticator app stays the same.
                </p>
              </div>
              <PasswordFields
                password={password}
                confirm={confirm}
                onPassword={setPassword}
                onConfirm={setConfirm}
                onSubmit={submit}
              />
              <Button className="w-full" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reset password<ArrowRight className="h-4 w-4" /></>}
              </Button>
            </div>
          )}

          {step === "done" && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Password updated</span>
              </div>
              <p className="text-sm text-foreground-muted">
                You can now sign in with your new password and authenticator code.
              </p>
              <Button asChild className="w-full">
                <Link href="/admin/">
                  Go to sign in
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-foreground-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
          Loading…
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
