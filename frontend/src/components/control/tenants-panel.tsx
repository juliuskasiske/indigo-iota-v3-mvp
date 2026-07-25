"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Plus,
  ChevronRight,
  RefreshCw,
  CircleCheck,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type Tenant,
  type ProvisionResult,
  type AuthMethod,
} from "@/lib/api";
import { TenantOnboarding } from "./tenant-onboarding";

const SLUG_RE = /^[a-z0-9-]+$/;

export function TenantsPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Provision form.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("entra");
  const [provisioning, setProvisioning] = useState(false);
  const [provError, setProvError] = useState<string | null>(null);
  const [provResult, setProvResult] = useState<ProvisionResult | null>(null);

  function handleAuth(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    return false;
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.platform.tenants();
      setTenants(res.tenants);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load tenants.");
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(s: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function provision() {
    setProvError(null);
    setProvResult(null);
    if (!name.trim() || !slug.trim() || !adminEmail.trim()) {
      setProvError("Name, slug, and admin email are all required.");
      return;
    }
    if (!SLUG_RE.test(slug.trim())) {
      setProvError("Slug must be lowercase letters, numbers, and hyphens only.");
      return;
    }
    setProvisioning(true);
    try {
      const res = await api.platform.provision(
        name.trim(),
        slug.trim(),
        adminEmail.trim(),
        "EU",
        authMethod,
      );
      setProvResult(res);
      setName("");
      setSlug("");
      setAdminEmail("");
      setAuthMethod("entra");
      await load();
      // Open the freshly provisioned tenant so the operator can continue.
      setOpen((prev) => new Set(prev).add(res.slug));
    } catch (e) {
      if (handleAuth(e)) return;
      setProvError(e instanceof Error ? e.message : "Provisioning failed.");
    } finally {
      setProvisioning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent" />
            Provision a tenant
          </CardTitle>
          <CardDescription>
            Create a new customer workspace: spins up its own brain database,
            runs migrations, and seeds the first admin by email. Idempotent — safe
            to re-run with the same slug.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {provError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {provError}
            </p>
          )}
          {provResult && (
            <div className="space-y-1 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-success">
                <CircleCheck className="h-4 w-4" />
                Provisioned {provResult.slug}
              </p>
              <p className="text-foreground-muted">
                Database{" "}
                <span className="font-mono text-foreground">
                  {provResult.db_name}
                </span>{" "}
                {provResult.db_created ? "created" : "already existed"},{" "}
                {provResult.migrations_applied} migration
                {provResult.migrations_applied === 1 ? "" : "s"} applied (schema{" "}
                {provResult.schema_version}). Admin{" "}
                <span className="font-mono text-foreground">
                  {provResult.admin_email}
                </span>{" "}
                seeded.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="prov-name">Workspace name</Label>
              <Input
                id="prov-name"
                value={name}
                placeholder="Contoso Ltd"
                disabled={provisioning}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-slug">Slug</Label>
              <Input
                id="prov-slug"
                value={slug}
                placeholder="contoso"
                disabled={provisioning}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prov-admin">First admin email</Label>
              <Input
                id="prov-admin"
                type="email"
                value={adminEmail}
                placeholder="admin@contoso.com"
                disabled={provisioning}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prov-auth">Sign-in method</Label>
            <select
              id="prov-auth"
              value={authMethod}
              disabled={provisioning}
              onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
              className="block h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground sm:max-w-xs"
            >
              <option value="entra">Microsoft SSO (Entra)</option>
              <option value="native">Email + password + authenticator</option>
            </select>
            <p className="text-xs text-foreground-subtle">
              {authMethod === "entra" ? (
                <>
                  Members sign in through their Microsoft tenant. Finish the SSO
                  consent and tenant-id steps in the tenant card below.
                </>
              ) : (
                <>
                  For customers with no Microsoft tenant (e.g. a custom IMAP
                  domain). The first admin gets an email invite to set a password
                  and enrol an authenticator.
                </>
              )}
            </p>
          </div>
          <Button disabled={provisioning} onClick={provision}>
            <Plus className="h-4 w-4" />
            {provisioning ? "Provisioning…" : "Provision tenant"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-accent" />
                Tenants
              </CardTitle>
              <CardDescription>
                Every customer workspace. Expand one to finish onboarding —
                consent, mailbox scoping, SSO, and members.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              title="Reload tenants"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}
          {loading ? (
            <p className="text-foreground-subtle">Loading…</p>
          ) : tenants && tenants.length > 0 ? (
            <div className="space-y-2">
              {tenants.map((t) => {
                const isOpen = open.has(t.slug);
                return (
                  <div
                    key={t.slug}
                    className="overflow-hidden rounded-lg border border-border/60 bg-background-soft/20"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(t.slug)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-background-soft/40"
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">
                            {t.name}
                          </span>
                          <span className="font-mono text-[11px] text-foreground-subtle">
                            {t.slug}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              t.status === "active" ? "success" : "warning"
                            }
                          >
                            {t.status}
                          </Badge>
                          {t.region && (
                            <Badge variant="outline">{t.region}</Badge>
                          )}
                          <Badge variant="outline">
                            {t.auth_method === "native"
                              ? "password auth"
                              : "Microsoft SSO"}
                          </Badge>
                          {t.auth_method === "entra" && (
                            <Badge
                              variant={
                                t.sso_enabled
                                  ? "accent"
                                  : t.sso_configured
                                    ? "warning"
                                    : "default"
                              }
                            >
                              {t.sso_enabled
                                ? "SSO on"
                                : t.sso_configured
                                  ? "SSO off"
                                  : "no SSO"}
                            </Badge>
                          )}
                          <Badge variant="default">
                            {t.members} member{t.members === 1 ? "" : "s"}
                          </Badge>
                          {t.markup_factor != null && (
                            <Badge variant="accent">×{t.markup_factor} markup</Badge>
                          )}
                          {t.schema_version && (
                            <span className="text-[10px] text-foreground-subtle">
                              schema {t.schema_version}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <TenantOnboarding
                        tenant={t}
                        onAuthError={onAuthError}
                        onChanged={load}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-foreground-subtle">
              No tenants yet. Provision one above to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
