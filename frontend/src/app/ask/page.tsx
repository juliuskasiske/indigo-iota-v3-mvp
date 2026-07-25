"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SignInCard } from "@/components/admin/sign-in-card";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { api, ApiError, type Me } from "@/lib/api";

// The unified workspace dashboard for any signed-in member. Authenticates, then
// renders the dashboard: every member gets the "Home turf" section (Ask / Graph /
// Pages / Connect); admins additionally see the "Admin Center" section. (The
// /admin route is the same dashboard, gated to admins + the onboarding wizard.)

type State =
  | { kind: "loading" }
  | { kind: "signedout"; reason?: string }
  | { kind: "ready"; me: Me };

export default function AskPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const loadMe = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const me = await api.me();
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

  const onAuthError = useCallback((e: ApiError) => {
    setState({
      kind: "signedout",
      reason:
        e.status === 403
          ? "Your session lacks access to this workspace. Sign in again."
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
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-foreground-subtle">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (state.kind === "signedout") {
    return (
      <SignInCard
        reason={state.reason ?? "Sign in to your workspace brain."}
        onSignedIn={loadMe}
        eyebrow="Indigo Iota"
        title="Sign in to your brain"
      />
    );
  }

  return (
    <AdminDashboard
      me={state.me}
      onAuthError={onAuthError}
      onSignOut={signOut}
      // Re-running setup lives in the wizard at /admin; reopening clears the
      // stamp there, so route over to it.
      onReopenSetup={() => router.push("/admin")}
    />
  );
}
