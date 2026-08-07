"use client";

import { useEffect, useState } from "react";
import { Copy, Check, ExternalLink, Plug, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// The MCP endpoint is served on the same origin as the app (app.indigo-iota.com
// → /mcp). Computed at runtime so it's correct in every environment without a
// hardcoded domain.
function useMcpUrl(): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setUrl(`${window.location.origin}/mcp`);
    }
  }, []);
  return url;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-lg border border-border bg-background-soft/50 px-3 py-2 font-mono text-sm text-foreground">
        {value || "…"}
      </code>
      <Button
        variant="secondary"
        size="sm"
        disabled={!value}
        onClick={() => {
          if (!value) return;
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-medium text-accent">
        {n}
      </span>
      <span className="text-sm leading-relaxed text-foreground-muted">{children}</span>
    </li>
  );
}

export function ConnectTab({
  only,
}: {
  // Restrict the steps to a single assistant (the per-assistant Sources modal
  // passes this). Unset → show both (the standalone Connect tab).
  only?: "claude" | "chatgpt";
} = {}) {
  const mcpUrl = useMcpUrl();
  const showClaude = only !== "chatgpt";
  const showChatgpt = only !== "claude";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm leading-relaxed text-foreground-muted">
          Connect your workspace brain to an AI assistant. Once linked, it can
          search your brain, read entity pages, and answer questions with cited
          sources — using the same data this page shows.
        </p>
      </div>

      {/* The endpoint */}
      <div className="space-y-2">
        <p className="text-xs text-foreground-subtle">
          Your MCP server endpoint
        </p>
        <CopyField value={mcpUrl} />
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground-subtle">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          The first time you connect, you&apos;ll be asked to sign in to Indigo
          Iota and approve access. The assistant only ever sees your own
          workspace.
        </p>
      </div>

      {/* Claude */}
      {showClaude && (
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Claude</h3>
            <Badge variant="outline" className="text-[10px]">
              claude.ai
            </Badge>
          </div>
          <ol className="space-y-2.5">
            <Step n={1}>
              Open Claude&apos;s connector settings and click{" "}
              <strong>Add custom connector</strong>.
            </Step>
            <Step n={2}>
              Paste the <strong>MCP server endpoint</strong> above as the URL and
              continue.
            </Step>
            <Step n={3}>
              A window opens to sign in to Indigo Iota — log in and click{" "}
              <strong>Allow</strong> to approve access to your workspace.
            </Step>
            <Step n={4}>
              Done. In any chat, Claude can now search and answer from your brain.
            </Step>
          </ol>
          <Button asChild variant="secondary" size="sm">
            <a
              href="https://claude.ai/settings/connectors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Claude connectors
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>
      )}

      {/* ChatGPT */}
      {showChatgpt && (
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">ChatGPT</h3>
            <Badge variant="outline" className="text-[10px]">
              chatgpt.com
            </Badge>
          </div>
          <ol className="space-y-2.5">
            <Step n={1}>
              In ChatGPT, go to <strong>Settings → Connectors</strong> (available
              on plans that support custom MCP connectors).
            </Step>
            <Step n={2}>
              Choose <strong>Add connector / Import</strong> and paste the{" "}
              <strong>MCP server endpoint</strong> above.
            </Step>
            <Step n={3}>
              Sign in to Indigo Iota in the window that opens and click{" "}
              <strong>Allow</strong>.
            </Step>
            <Step n={4}>
              Enable the connector in a chat to let ChatGPT query your brain.
            </Step>
          </ol>
          <Button asChild variant="secondary" size="sm">
            <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">
              Open ChatGPT
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>
      )}

      {showClaude && (
        <p className="text-xs leading-relaxed text-foreground-subtle">
          Using the Claude <strong>desktop app</strong> instead? Custom MCP
          servers are added via its config file rather than the connector UI —
          ask your admin if you need help.
        </p>
      )}
    </div>
  );
}
