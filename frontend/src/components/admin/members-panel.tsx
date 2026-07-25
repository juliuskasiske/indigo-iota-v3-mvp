"use client";

import { useEffect, useState } from "react";
import { Users, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, type AuthMethod, type Member } from "@/lib/api";

// Tenant-admin team management. The same membership store the Control Tower
// writes to, but scoped to the admin's own org — so a customer admin can invite
// teammates without going through the operator. Without a membership row,
// sign-in is denied, so this is the "who can use this workspace" surface.
//
// Used both in the onboarding wizard (the Team step) and the steady-state
// dashboard — it's a plain Card either way, no step framing.
export function MembersPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("consultant");
  const [busy, setBusy] = useState(false);

  // Native-auth orgs invite by email (a set-password link); Microsoft orgs add a
  // member who then signs in via SSO. The wording + action below follow this.
  const isNative = authMethod === "native";

  function handleAuth(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    return false;
  }

  async function load() {
    try {
      const [me, res] = await Promise.all([api.me(), api.members()]);
      setAuthMethod(me.auth_method);
      setMembers(res.members);
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    setError(null);
    setNotice(null);
    if (!email.trim() || busy) return;
    const addr = email.trim();
    setBusy(true);
    try {
      if (isNative) {
        // Create the membership AND email a single-use set-password link.
        await api.inviteMember(addr, role);
        const res = await api.members();
        setMembers(res.members);
        setNotice(`Invitation sent to ${addr}. They set a password and authenticator from the link.`);
      } else {
        const res = await api.addMember(addr, role);
        setMembers(res.members);
      }
      setEmail("");
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : isNative ? "Failed to send invite." : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          Team
        </CardTitle>
        <CardDescription>
          {isNative ? (
            <>
              Invite people by email — each gets a single-use link to set a
              password and authenticator.{" "}
            </>
          ) : (
            <>Grant people access to this workspace by email.{" "}</>
          )}
          <strong>Admins</strong>{" "}
          manage settings; consultants and viewers use the brain. Anyone without
          a row here is turned away at sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-foreground">
            {notice}
          </p>
        )}

        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : members && members.length > 0 ? (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li
                key={m.email}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background-soft/20 px-3 py-2"
              >
                <span className="truncate font-mono text-xs text-foreground">
                  {m.email}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant={m.role === "admin" ? "accent" : "default"}>
                    {m.role}
                  </Badge>
                  <Badge variant={m.linked ? "success" : "outline"}>
                    {m.linked ? "linked" : "not yet signed in"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-foreground-subtle">No teammates yet.</p>
        )}

        <div className="flex flex-col gap-2 border-t border-border/40 pt-3 sm:flex-row">
          <Input
            value={email}
            type="email"
            placeholder="person@company.com"
            disabled={busy}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="sm:flex-1"
          />
          <select
            value={role}
            disabled={busy}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="consultant">consultant</option>
            <option value="admin">admin</option>
            <option value="viewer">viewer</option>
          </select>
          <Button disabled={busy || !email.trim()} onClick={add}>
            <Plus className="h-4 w-4" />
            {isNative
              ? busy
                ? "Inviting…"
                : "Send invite"
              : busy
                ? "Adding…"
                : "Add"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
