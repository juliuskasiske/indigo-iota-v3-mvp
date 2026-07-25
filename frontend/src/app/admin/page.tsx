"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { SignInCard } from "@/components/admin/sign-in-card";
import { OnboardingWizard } from "@/components/admin/onboarding-wizard";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { api, ApiError, type Me, type Onboarding } from "@/lib/api";

// The Admin Center has two faces, chosen by the once-per-tenant onboarding
// stamp: a new workspace runs the guided OnboardingWizard; a finished one lands
// in the steady-state AdminDashboard. This component just authenticates, reads
// the stamp, and routes between the two.

type State =
  | { kind: "loading" }
  | { kind: "signedout"; reason?: string }
  | { kind: "ready"; me: Me };

export default function AdminPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  // The onboarding stamp decides wizard vs dashboard. `undefined` = not read
  // yet (show a spinner); a value (or null on a hard read failure) = decided.
  const [onboarding, setOnboarding] = useState<Onboarding | null | undefined>(
    undefined,
  );

  const loadMe = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const me = await api.me();
      if (me.role !== "admin") {
        setState({
          kind: "signedout",
          reason: `Signed in as ${me.email ?? "a member"} (${me.role}). Admin role is required.`,
        });
        return;
      }
      setState({ kind: "ready", me });
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

  const loadOnboarding = useCallback(async () => {
    try {
      setOnboarding(await api.onboarding());
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setState({
          kind: "signedout",
          reason:
            e.status === 403
              ? "Your session lacks admin access. Sign in with an admin account."
              : "Your session expired. Please sign in again.",
        });
        return;
      }
      // A non-auth read failure shouldn't trap a real workspace in the wizard:
      // fall back to the dashboard (null), which is the safe steady state.
      setOnboarding(null);
    }
  }, []);

  // Read the onboarding stamp once signed in.
  useEffect(() => {
    if (state.kind === "ready") loadOnboarding();
  }, [state.kind, loadOnboarding]);

  const onAuthError = useCallback((e: ApiError) => {
    setState({
      kind: "signedout",
      reason:
        e.status === 403
          ? "Your session lacks admin access. Sign in with an admin account."
          : "Your session expired. Please sign in again.",
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore — clearing UI state is what matters
    }
    setState({ kind: "signedout" });
    setOnboarding(undefined);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-foreground-subtle">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (state.kind === "signedout") {
    return <SignInCard reason={state.reason} onSignedIn={loadMe} />;
  }

  // Signed in, but the stamp isn't read yet — hold for the routing decision.
  if (onboarding === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-foreground-subtle">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const { me } = state;

  // Not finished → guided setup. Finishing drops the admin straight into the
  // brain (the Ask page) — that's the payoff of setup. The Admin Center stays
  // one click away via the button in the Ask header.
  if (onboarding && !onboarding.onboarded) {
    return (
      <OnboardingWizard
        me={me}
        onAuthError={onAuthError}
        onSignOut={signOut}
        onFinished={() => router.push("/ask")}
      />
    );
  }

  // Finished (or unreadable, treated as steady state) → dashboard. Re-running
  // setup re-reads the stamp → wizard.
  return (
    <AdminDashboard
      me={me}
      onAuthError={onAuthError}
      onSignOut={signOut}
      onReopenSetup={loadOnboarding}
    />
  );
}
