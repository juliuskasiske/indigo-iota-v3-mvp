"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Link2,
  Copy,
  Check,
  ExternalLink,
  CircleCheck,
  CircleAlert,
  Mail,
  Coins,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  api,
  ApiError,
  type Tenant,
  type TenantMarkup,
  type ConsentUrls,
  type SsoVerify,
} from "@/lib/api";
import { WorkspaceDangerZone } from "@/components/workspace-danger-zone";
import { DiligencePanel } from "@/components/diligence-panel";

/**
 * The per-tenant onboarding surface inside an expanded tenant card. This is the
 * operator's job ONLY — the platform-level wiring the customer admin can't do.
 *
 * Two steps, deliberately minimal:
 *   1. Hand the customer's Microsoft admin the sign-in consent link. It's the
 *      SAME for every customer — built from our shared Login app id and the
 *      "/organizations" authority — so there are no inputs here, just a link to
 *      send. Whichever admin signs in determines which tenant the consent lands
 *      in. No live screen-share needed. (Mail access is its own consent link,
 *      but the admin self-serves that inside their own onboarding wizard, so it
 *      lives there, not here.)
 *   2. Sign-in (SSO). The one per-customer value needed — the customer's tenant
 *      id — is captured automatically: the Sign-in link carries a "for <slug>"
 *      tag, so when the admin grants consent, Microsoft's bounce-back to
 *      /auth/consent-callback hands us their tenant id and we store it + enable
 *      sign-in. A manual-entry fallback stays for when the id is given directly.
 *
 * Everything else — mail access, which mailboxes are in scope (and the matching
 * Exchange access-policy command), and who can sign in — is owned by the admin
 * in the in-product onboarding wizard, not here.
 */
export function TenantOnboarding({
  tenant,
  onAuthError,
  onChanged,
}: {
  tenant: Tenant;
  onAuthError: (e: ApiError) => void;
  onChanged: () => void;
}) {
  function handleAuth(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    return false;
  }

  // Native (password) orgs don't use Microsoft SSO at all — they bootstrap by
  // emailing the first admin a set-up link. Show that instead of the SSO steps.
  if (tenant.auth_method === "native") {
    return (
      <div className="space-y-5 border-t border-border/40 p-4">
        <NativeInviteStep tenant={tenant} handleAuth={handleAuth} />
        <DiligencePanel
          onAuthError={onAuthError}
          load={() => api.platform.comprehendSettings(tenant.slug)}
          save={(body) => api.platform.updateComprehendSettings(tenant.slug, body)}
        />
        <MarkupPanel tenant={tenant} handleAuth={handleAuth} onChanged={onChanged} />
        <WorkspaceDangerZone
          slug={tenant.slug}
          onConfirm={(confirm) => api.platform.deleteTenant(tenant.slug, confirm)}
          onDeleted={onChanged}
          onAuthError={onAuthError}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 border-t border-border/40 p-4">
      <ConsentStep tenant={tenant} handleAuth={handleAuth} />
      <SsoStep tenant={tenant} handleAuth={handleAuth} onChanged={onChanged} />
      <DiligencePanel
        onAuthError={onAuthError}
        load={() => api.platform.comprehendSettings(tenant.slug)}
        save={(body) => api.platform.updateComprehendSettings(tenant.slug, body)}
      />
      <WorkspaceDangerZone
        slug={tenant.slug}
        onConfirm={(confirm) => api.platform.deleteTenant(tenant.slug, confirm)}
        onDeleted={onChanged}
        onAuthError={onAuthError}
      />
    </div>
  );
}

// --- Customer markup (per-workspace pricing) --------------------------------

/**
 * Set this workspace's customer markup — the factor applied to raw provider cost
 * to get what the customer sees and pays (1 credit = $1). Empty input = use the
 * global default. Because internal storage is raw and the markup is applied only
 * on display/conversion, changing it re-prices what this workspace SEES,
 * including a funded balance — so we warn when credits are already on file.
 */
function MarkupPanel({
  tenant,
  handleAuth,
  onChanged,
}: {
  tenant: Tenant;
  handleAuth: (e: unknown) => boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<import("@/lib/api").TenantMarkup | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.platform.markup(tenant.slug);
      setData(res);
      setValue(res.factor != null ? String(res.factor) : "");
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to load the markup.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.slug]);

  async function persist(factor: number | null) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.platform.setMarkup(tenant.slug, factor);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await load();
      onChanged(); // refresh the roster so its badge reflects the new factor
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to save the markup.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const trimmed = value.trim();
    if (trimmed === "") {
      void persist(null); // clear → global default
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive number (or leave blank to use the default).");
      return;
    }
    void persist(n);
  }

  const onDefault = data != null && data.factor == null;

  return (
    <div className="rounded-lg border border-border bg-background-soft/20 p-4">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Coins className="h-4 w-4 text-accent" />
        Customer markup
      </h4>
      <p className="mt-1 text-xs text-foreground-subtle">
        Raw provider cost × this factor = what this workspace sees and pays
        (1&nbsp;credit&nbsp;=&nbsp;$1). Drives every customer-facing figure — Usage,
        Observability cost, the credits balance/spend, and the add-credits
        conversion. Leave blank to use the global default.
      </p>

      {loading || !data ? (
        <div className="mt-3 flex h-10 items-center text-foreground-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-foreground-subtle">
                Markup factor (×)
              </Label>
              <Input
                type="number"
                min={data.min}
                max={data.max}
                step="0.5"
                value={value}
                disabled={saving}
                placeholder={`default ${data.default}`}
                onChange={(e) => setValue(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {!onDefault && (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setValue("");
                  void persist(null);
                }}
              >
                Reset to default
              </Button>
            )}
            <span className="pb-1.5 text-xs text-foreground-muted">
              Effective: <strong className="text-foreground">×{data.effective}</strong>
              {onDefault ? " (global default)" : ""}
            </span>
          </div>

          {data.has_funded_credits && (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                This workspace has funded credits. Changing the factor re-prices
                what it sees — including its existing balance and past spend
                (internal accounting is unchanged). Adjust with care.
              </span>
            </p>
          )}

          {error && <ErrorLine>{error}</ErrorLine>}
          {saved && (
            <p className="mt-2 flex items-center gap-1 text-xs text-success">
              <CircleCheck className="h-3.5 w-3.5" /> Saved
            </p>
          )}
        </>
      )}
    </div>
  );
}

// --- Native auth: send the first admin their set-up invite ------------------

function NativeInviteStep({
  tenant,
  handleAuth,
}: {
  tenant: Tenant;
  handleAuth: (e: unknown) => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invited: string[]; delivered: boolean } | null>(null);

  async function send() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await api.platform.invite(tenant.slug);
      setResult({ invited: res.invited, delivered: res.delivered });
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to send the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Step
      n={1}
      icon={<Mail className="h-4 w-4 text-accent" />}
      title="Send the first admin their set-up invite"
      hint="This org signs in with email + password + an authenticator — no Microsoft tenant. Email the seeded admin a single-use link to set a password and enrol an authenticator. After that, they can invite the rest of the team themselves."
    >
      {error && <ErrorLine>{error}</ErrorLine>}
      {result && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {result.delivered
            ? `Invite emailed to ${result.invited.join(", ") || "the admin"}.`
            : `Invite created for ${result.invited.join(", ") || "the admin"}, but SMTP isn't configured — the link is in the server logs.`}
        </p>
      )}
      <Button size="sm" disabled={busy} onClick={send}>
        <Mail className="h-4 w-4" />
        {busy ? "Sending…" : result ? "Resend invite" : "Send set-up invite"}
      </Button>
    </Step>
  );
}

// --- Step wrapper -----------------------------------------------------------

function Step({
  n,
  icon,
  title,
  hint,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
          {n}
        </span>
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {icon}
            {title}
          </h4>
          <p className="text-xs text-foreground-subtle">{hint}</p>
        </div>
      </div>
      <div className="space-y-3 pl-[2.125rem]">{children}</div>
    </section>
  );
}

// --- 1. Entra admin consent -------------------------------------------------

function ConsentStep({
  tenant,
  handleAuth,
}: {
  tenant: Tenant;
  handleAuth: (e: unknown) => boolean;
}) {
  const [urls, setUrls] = useState<ConsentUrls | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await api.platform.consentUrls(tenant.slug);
        if (live) setUrls(res);
      } catch (e) {
        if (handleAuth(e)) return;
        if (live)
          setError(
            e instanceof Error ? e.message : "Failed to load consent links.",
          );
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
    // handleAuth is stable for the lifetime of this card; load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Step
      n={1}
      icon={<KeyRound className="h-4 w-4 text-accent" />}
      title="Send the customer the sign-in link"
      hint="The customer's Microsoft admin clicks this to grant sign-in. It's the same for every customer — just send it. No tenant details needed: whoever signs in determines their own tenant. (Mail access is granted by the admin inside their own onboarding, not here.)"
    >
      {error && <ErrorLine>{error}</ErrorLine>}
      {busy && (
        <p className="text-xs text-foreground-subtle">Loading link…</p>
      )}
      {urls && (
        <div className="space-y-2 rounded-md border border-border/60 bg-background-soft/20 p-3">
          <ConsentLink
            label="Sign-in (SSO)"
            url={urls.login_url}
            configured={urls.login_configured}
            missingHint="Set SSO_CLIENT_ID on the server to enable this link."
          />
          <p className="text-[11px] text-foreground-subtle">
            Returns to:{" "}
            <span className="font-mono text-foreground">{urls.redirect_uri}</span>
          </p>
        </div>
      )}
    </Step>
  );
}

function ConsentLink({
  label,
  url,
  configured,
  missingHint,
}: {
  label: string;
  url: string;
  configured: boolean;
  missingHint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-foreground-muted">{label}</span>
      {configured ? (
        <div className="flex items-center gap-1">
          <CopyButton text={url} />
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" title="Open in new tab">
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Button>
          </a>
        </div>
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-warning">
          <CircleAlert className="h-3.5 w-3.5" />
          {missingHint}
        </span>
      )}
    </div>
  );
}

// --- 2. Wire + verify SSO ---------------------------------------------------

function SsoStep({
  tenant,
  handleAuth,
  onChanged,
}: {
  tenant: Tenant;
  handleAuth: (e: unknown) => boolean;
  onChanged: () => void;
}) {
  const [tenantId, setTenantId] = useState(tenant.sso_tenant_id ?? "");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [verify, setVerify] = useState<SsoVerify | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function save() {
    setError(null);
    setSaved(null);
    if (!tenantId.trim()) {
      setError("The customer's tenant id is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.platform.setSso(tenant.slug, {
        tenant_id: tenantId.trim(),
        enabled,
      });
      setSaved(`Saved. Redirect URI: ${res.redirect_uri}`);
      onChanged();
    } catch (e) {
      if (handleAuth(e)) return;
      setError(e instanceof Error ? e.message : "Failed to save SSO connection.");
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setVerify(null);
    setVerifying(true);
    try {
      setVerify(await api.platform.verifySso(tenant.slug));
    } catch (e) {
      if (handleAuth(e)) return;
      setVerify({
        ok: false,
        error: e instanceof Error ? e.message : "Verification failed.",
      });
    } finally {
      setVerifying(false);
    }
  }

  const captured = tenant.sso_tenant_id;

  return (
    <Step
      n={2}
      icon={<Link2 className="h-4 w-4 text-accent" />}
      title="Sign-in (SSO)"
      hint="When the customer's admin clicks the Sign-in link above, their tenant id is captured here automatically and sign-in turns on — nothing to type. Use Verify to confirm we can reach Microsoft for that tenant."
    >
      {error && <ErrorLine>{error}</ErrorLine>}
      {saved && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {saved}
        </p>
      )}

      {captured ? (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-xs">
          <CircleCheck className="h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="font-medium text-success">
              Tenant id captured from the customer&apos;s consent.
            </p>
            <p className="mt-0.5 truncate font-mono text-foreground">
              {captured}
            </p>
            <p className="mt-0.5 text-foreground-subtle">
              Sign-in is {tenant.sso_enabled ? "on" : "saved but disabled"}.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-background-soft/20 px-3 py-2.5 text-xs text-foreground-muted">
          <CircleAlert className="h-4 w-4 shrink-0 text-foreground-subtle" />
          <span>
            Waiting for the customer&apos;s admin to click the{" "}
            <strong>Sign-in</strong> link above. Their tenant id lands here on
            its own — then refresh this card.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={verifying || !tenant.sso_configured}
          onClick={runVerify}
          title={
            tenant.sso_configured
              ? undefined
              : "Waiting for the customer's consent click"
          }
        >
          {verifying ? "Verifying…" : "Verify connection"}
        </Button>
      </div>
      {verify && <VerifyResult verify={verify} />}

      <details className="text-xs">
        <summary className="cursor-pointer text-foreground-subtle hover:text-foreground-muted">
          Enter the tenant id manually
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-foreground-subtle">
            Only needed if the customer gave you their tenant id directly
            instead of clicking the link.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <LabeledInput
              label="Customer tenant id"
              value={tenantId}
              placeholder="contoso.onmicrosoft.com or GUID"
              onChange={setTenantId}
            />
            <label className="flex items-end gap-2 pb-1.5 text-foreground-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Enable sign-in for this tenant
            </label>
          </div>
          <Button size="sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save SSO connection"}
          </Button>
        </div>
      </details>
    </Step>
  );
}

function VerifyResult({ verify }: { verify: SsoVerify }) {
  if (!verify.ok) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <CircleAlert className="h-4 w-4 shrink-0" />
        <span>{verify.error ?? "Verification failed."}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-success">
        <CircleCheck className="h-4 w-4" />
        Reached Microsoft for this tenant.
      </p>
      <dl className="space-y-0.5 text-foreground-muted">
        <Row label="Issuer" value={verify.issuer} />
        <Row label="Redirect URI" value={verify.redirect_uri} />
        <Row label="Login URL" value={verify.login_url} />
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-foreground-subtle">Redirect host</dt>
          <dd>
            {verify.redirect_host_matches ? (
              <span className="text-success">matches this deployment</span>
            ) : (
              <span className="text-warning">
                does not match this deployment — sign-in will fail
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-foreground">{value}</dd>
    </div>
  );
}

// --- shared bits ------------------------------------------------------------

function LabeledInput({
  label,
  value,
  placeholder,
  type,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-foreground-subtle">{label}</Label>
      <Input
        value={value}
        type={type}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {children}
    </p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={copy} title="Copy">
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
