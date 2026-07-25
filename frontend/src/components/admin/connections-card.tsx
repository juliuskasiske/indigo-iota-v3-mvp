"use client";

import { useEffect, useState } from "react";
import { Plug, CheckCircle2, CircleSlash } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, type Connections } from "@/lib/api";

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString("en-US");
}

/**
 * Whether this workspace's brain is connected to an AI assistant (Claude /
 * ChatGPT) over MCP — counting personal access tokens + OAuth grants. A quick
 * "is anyone plugged in?" signal for the Sources tab.
 */
export function ConnectionsCard({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [data, setData] = useState<Connections | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.connections());
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load connections.");
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
          <Plug className="h-4 w-4 text-accent" />
          Assistant connections
        </CardTitle>
        <CardDescription>
          Whether anyone has linked this workspace&apos;s brain to Claude or
          ChatGPT (read-only, over MCP).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : data ? (
          <>
            <div className="flex items-center justify-between gap-2">
              {data.connected ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="default">
                  <CircleSlash className="h-3.5 w-3.5" />
                  Not connected
                </Badge>
              )}
              <span className="text-xs text-foreground-subtle">
                Last activity: {fmtTime(data.last_activity)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="OAuth connections" value={data.oauth_grants} hint="Claude / ChatGPT “Connect”" />
              <Stat label="Access tokens" value={data.mcp_tokens} hint="Pasted bearer tokens" />
            </div>
            {!data.connected && (
              <p className="text-xs leading-relaxed text-foreground-subtle">
                No assistant is linked yet. Members can connect from the{" "}
                <span className="text-foreground">Connect</span> tab.
              </p>
            )}
          </>
        ) : (
          <p className="text-destructive">{error ?? "Could not load connections."}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-soft/30 px-3 py-2">
      <div className="text-[11px] text-foreground-subtle">{label}</div>
      <div className="text-xl font-semibold text-foreground">
        {value.toLocaleString("en-US")}
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-foreground-subtle">{hint}</div>
    </div>
  );
}
