"use client";

import { useEffect, useState } from "react";
import { Server, CircleCheck, CircleAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, type ConnectorStatus } from "@/lib/api";

const AUTH_MODE_LABEL: Record<ConnectorStatus["auth_mode"], string> = {
  certificate: "Certificate",
  secret: "Client secret",
  none: "Not set",
};

/**
 * Read-only view of the mail connector's deploy-env credentials (GRAPH_*).
 * Secrets live in .env and are set at deploy time — never shown or edited here,
 * the panel only reports whether they're present and what auth mode is active.
 */
export function ConnectorStatusPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStatus(await api.platform.connectorStatus());
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(
          e instanceof Error ? e.message : "Failed to load connector status.",
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4 text-accent" />
          Mail connector credentials
        </CardTitle>
        <CardDescription>
          The application credentials Indigo Iota uses to pull mail via Microsoft
          Graph. Set in the deploy environment (GRAPH_*), not here — this is a
          read-only health check. Secret values are never shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : status ? (
          <>
            <div className="flex items-center gap-2">
              {status.ready ? (
                <Badge variant="success">
                  <CircleCheck className="h-3.5 w-3.5" />
                  Ready
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <CircleAlert className="h-3.5 w-3.5" />
                  Incomplete
                </Badge>
              )}
              <span className="text-xs text-foreground-subtle">
                {status.ready
                  ? "The connector can authenticate to Microsoft Graph."
                  : "Missing credentials — the connector cannot pull mail until these are set in the deploy env."}
              </span>
            </div>

            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
              <Field label="Auth mode">
                <Badge variant={status.auth_mode === "none" ? "default" : "accent"}>
                  {AUTH_MODE_LABEL[status.auth_mode]}
                </Badge>
              </Field>
              <Field label="Tenant id">
                <Mono value={status.tenant_id} />
              </Field>
              <Field label="Client id">
                <Mono value={status.client_id} />
              </Field>
            </dl>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-foreground-subtle sm:text-right sm:pt-1">
        {label}
      </dt>
      <dd className="flex items-center">{children}</dd>
    </>
  );
}

function Mono({ value }: { value: string }) {
  if (!value) {
    return <span className="text-xs text-foreground-subtle italic">unset</span>;
  }
  return (
    <span className="truncate font-mono text-xs text-foreground">{value}</span>
  );
}
