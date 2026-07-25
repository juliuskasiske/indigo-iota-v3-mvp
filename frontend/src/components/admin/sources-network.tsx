"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plug, ShieldCheck, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CaptureSourcesPanel } from "@/components/admin/capture-sources-panel";
import { GdriveConnect } from "@/components/admin/gdrive-connect";
import { ConnectTab } from "@/components/ask/connect-tab";
import { ProviderLogo, HomeTurfLogo, type ProviderId } from "@/components/admin/provider-logo";
import { api, ApiError, type CaptureSource, type Connections } from "@/lib/api";

// The network is drawn in a fixed "design space" (matching the approved mock),
// then scaled down to fit whatever width the Sources tab gives us. 1 design unit
// = 1px at scale 1, so SVG connector coordinates and the absolutely-positioned
// nodes always line up.
const DESIGN_W = 1240;
const DESIGN_H = 780;

// Edge anchor x-coordinates (box vertical-side midpoints).
const INGRESS_RIGHT = 305; // right edge of an ingress node (centre 210 + half of 190)
const HUB_LEFT = 500; // left edge of the hub (centre 600 − half of 200)
const HUB_RIGHT = 700; // right edge of the hub
const EGRESS_LEFT = 915; // left edge of an egress node (centre 1010 − half of 190)
const HUB_Y = 390;

type Side = "ingress" | "egress";
// Which modal a node opens. Email types open the (provider-filtered) capture
// panel; "soon" is a placeholder; the egress kinds open connect/info modals.
type Modal = "graph" | "imap" | "gdrive" | "soon" | "assistant" | "hometurf";

interface NodeDef {
  id: string;
  label: string;
  side: Side;
  x: number;
  y: number;
  modal: Modal;
  provider?: ProviderId; // icon (omitted for Home Turf, which is a wordmark)
  soon?: boolean;
}

const NODES: NodeDef[] = [
  // ingress (left)
  { id: "microsoft365", label: "Outlook", side: "ingress", x: 210, y: 84, modal: "graph", provider: "outlook" },
  { id: "imap", label: "IMAP", side: "ingress", x: 210, y: 174, modal: "imap", provider: "imap" },
  { id: "teams", label: "MS Teams", side: "ingress", x: 210, y: 264, modal: "soon", provider: "teams", soon: true },
  { id: "slack", label: "Slack DMs", side: "ingress", x: 210, y: 354, modal: "soon", provider: "slack", soon: true },
  { id: "googledrive", label: "Google Drive", side: "ingress", x: 210, y: 444, modal: "gdrive", provider: "googledrive" },
  { id: "sharepoint", label: "SharePoint", side: "ingress", x: 210, y: 534, modal: "soon", provider: "sharepoint", soon: true },
  { id: "notion", label: "Notion", side: "ingress", x: 210, y: 624, modal: "soon", provider: "notion", soon: true },
  { id: "onenote", label: "OneNote", side: "ingress", x: 210, y: 714, modal: "soon", provider: "onenote", soon: true },
  // egress (right)
  { id: "hometurf", label: "Home Turf", side: "egress", x: 1010, y: 250, modal: "hometurf" },
  { id: "claude", label: "Claude", side: "egress", x: 1010, y: 390, modal: "assistant", provider: "claude" },
  { id: "chatgpt", label: "ChatGPT", side: "egress", x: 1010, y: 530, modal: "assistant", provider: "chatgpt" },
];

// Smooth left-to-right Bézier between two edge-midpoints (mirrors the usage-panel
// connector style): the control points sit at the horizontal midpoint so the
// curve leaves/enters each box horizontally.
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

type EdgeKind = "connected" | "available" | "soon";

function edgeStroke(kind: EdgeKind): React.SVGProps<SVGPathElement> {
  if (kind === "soon") {
    return { stroke: "hsl(var(--border))", strokeWidth: 1.6, strokeDasharray: "5 5", opacity: 0.9 };
  }
  if (kind === "available") {
    return { stroke: "hsl(var(--accent))", strokeWidth: 1.8, strokeDasharray: "5 5", opacity: 0.6 };
  }
  return { stroke: "hsl(var(--accent))", strokeWidth: 1.8, opacity: 0.85 };
}

// Scale the fixed design-space stage to fit the available width (never up past
// 1:1). Returns a ref to attach to the measured container + the current scale.
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setScale(Math.min(1, w / DESIGN_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

export function SourcesNetwork({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [active, setActive] = useState<NodeDef | null>(null);
  const { ref, scale } = useFitScale();

  const reload = useCallback(async () => {
    // Fetch the two feeds INDEPENDENTLY: the egress connection status is a
    // nice-to-have, so a failure there must not blank the (more important)
    // ingress source counts. Only a real auth failure bubbles up.
    const [s, c] = await Promise.allSettled([api.sources(), api.connections()]);
    if (s.status === "fulfilled") {
      setSources(s.value.sources);
    } else if (
      s.reason instanceof ApiError &&
      (s.reason.status === 401 || s.reason.status === 403)
    ) {
      onAuthError(s.reason);
      return;
    }
    if (c.status === "fulfilled") {
      setConnections(c.value);
    } else if (
      c.reason instanceof ApiError &&
      (c.reason.status === 401 || c.reason.status === 403)
    ) {
      onAuthError(c.reason);
    }
  }, [onAuthError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const graphCount = (sources ?? []).filter(
    (s) => s.provider === "graph" && s.enabled,
  ).length;
  const imapCount = (sources ?? []).filter(
    (s) => s.provider === "imap" && s.enabled,
  ).length;
  const gdriveCount = (sources ?? []).filter(
    (s) => s.provider === "gdrive" && s.enabled,
  ).length;
  const assistantConnected = !!connections?.connected;

  // Per-node connection state → status line + connector style.
  function nodeState(n: NodeDef): { status: string; on: boolean; kind: EdgeKind } {
    if (n.soon) return { status: "Coming soon", on: false, kind: "soon" };
    switch (n.id) {
      case "microsoft365":
        return graphCount > 0
          ? { status: `${graphCount} ${graphCount === 1 ? "mailbox" : "mailboxes"}`, on: true, kind: "connected" }
          : { status: "Not set up", on: false, kind: "available" };
      case "imap":
        return imapCount > 0
          ? { status: `${imapCount} ${imapCount === 1 ? "mailbox" : "mailboxes"}`, on: true, kind: "connected" }
          : { status: "Not set up", on: false, kind: "available" };
      case "googledrive":
        return gdriveCount > 0
          ? { status: `${gdriveCount} ${gdriveCount === 1 ? "folder" : "folders"}`, on: true, kind: "connected" }
          : { status: "Not set up", on: false, kind: "available" };
      case "hometurf":
        return { status: "This workspace · always on", on: true, kind: "connected" };
      case "claude":
      case "chatgpt":
        return assistantConnected
          ? { status: "Connected", on: true, kind: "connected" }
          : { status: "Available", on: false, kind: "available" };
      default:
        return { status: "", on: false, kind: "available" };
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm leading-relaxed text-foreground-muted">
          Where Indigo Iota reads from, and where your brain is used. Click any
          connector to manage its specific accounts, add new ones, or see how far
          back it has captured.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-foreground-subtle">
          <LegendKey kind="connected" label="Connected" />
          <LegendKey kind="available" label="Available" />
          <LegendKey kind="soon" label="Coming soon" />
        </div>
      </div>

      {/* Measured wrapper → scaled fixed-size stage. */}
      <div ref={ref} className="w-full">
        <div style={{ height: DESIGN_H * scale }}>
          <div
            className="relative"
            style={{
              width: DESIGN_W,
              height: DESIGN_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {/* connector wires */}
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${DESIGN_W} ${DESIGN_H}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              {NODES.map((n) => {
                const { kind } = nodeState(n);
                const d =
                  n.side === "ingress"
                    ? edgePath(INGRESS_RIGHT, n.y, HUB_LEFT, HUB_Y)
                    : edgePath(HUB_RIGHT, HUB_Y, EGRESS_LEFT, n.y);
                return <path key={n.id} d={d} fill="none" {...edgeStroke(kind)} />;
              })}
            </svg>

            {/* hub */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-accent bg-background-elevated px-5 py-4 text-center shadow-lg shadow-accent/10"
              style={{ left: 600, top: HUB_Y, width: 200 }}
            >
              <div className="text-2xl">
                <span className="font-sans font-extrabold tracking-tight text-accent">
                  indigo
                </span>
                <span
                  className="italic text-accent"
                  style={{ fontFamily: "var(--font-serif)", fontWeight: 400, marginLeft: "0.04em" }}
                >
                  iota
                </span>
              </div>
              <div className="mt-1 text-[11px] text-foreground-muted">
                your workspace brain
              </div>
            </div>

            {/* nodes */}
            {NODES.map((n) => {
              const st = nodeState(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setActive(n)}
                  className={`group absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-xl border border-border bg-background-elevated px-3 py-2.5 text-left shadow-sm transition-[transform,box-shadow,border-color] duration-150 ease-out hover:z-10 hover:rotate-[1.4deg] hover:scale-[1.04] hover:border-accent hover:shadow-lg ${
                    n.soon ? "opacity-60" : ""
                  }`}
                  style={{ left: n.x, top: n.y, width: 190 }}
                >
                  {n.id === "hometurf" ? (
                    <div className="min-w-0 flex-1">
                      <HomeTurfLogo size={18} />
                      <div className="mt-0.5 text-[11px] text-success">
                        {st.status}
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background-soft ${
                          n.soon ? "grayscale" : ""
                        }`}
                      >
                        {n.provider && <ProviderLogo id={n.provider} size={24} />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold leading-tight text-foreground">
                          {n.label}
                        </div>
                        <div
                          className={`mt-0.5 text-[11px] ${
                            st.on ? "text-success" : st.kind === "available" ? "text-accent" : "text-foreground-subtle"
                          }`}
                        >
                          {st.status}
                        </div>
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* one Dialog, content keyed off the active node */}
      <Dialog
        open={!!active}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            reload(); // counts may have changed while the modal was open
          }
        }}
      >
        {active && (
          <NodeModal
            node={active}
            onAuthError={onAuthError}
            assistantConnected={assistantConnected}
            lastActivity={connections?.last_activity ?? null}
          />
        )}
      </Dialog>
    </div>
  );
}

function NodeModal({
  node,
  onAuthError,
  assistantConnected,
  lastActivity,
}: {
  node: NodeDef;
  onAuthError: (e: ApiError) => void;
  assistantConnected: boolean;
  lastActivity: string | null;
}) {
  if (node.modal === "graph" || node.modal === "imap") {
    const isGraph = node.modal === "graph";
    return (
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        overlayClassName="bg-transparent backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {node.provider && <ProviderLogo id={node.provider} size={22} />}
            {node.label}
          </DialogTitle>
          <DialogDescription>
            {isGraph
              ? "Outlook mailboxes this workspace pulls from (Microsoft 365). Add accounts, grant mailbox access, and backfill older mail — each mailbox shows how much it has captured and how far back."
              : "Generic IMAP mailboxes (custom domains). Add an account with its host + app password, test the connection, and backfill — each mailbox shows how much it has captured and how far back."}
          </DialogDescription>
        </DialogHeader>
        <CaptureSourcesPanel
          onAuthError={onAuthError}
          mode="both"
          providerFilter={isGraph ? "graph" : "imap"}
        />
      </DialogContent>
    );
  }

  if (node.modal === "gdrive") {
    return (
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        overlayClassName="bg-transparent backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {node.provider && <ProviderLogo id={node.provider} size={22} />}
            {node.label}
          </DialogTitle>
          <DialogDescription>
            Connect a Google Drive folder. Share it with Indigo Iota, paste the
            link, and we&apos;ll verify we can read it. (Syncing the folder&apos;s
            files starts once Drive ingestion is switched on for your workspace.)
          </DialogDescription>
        </DialogHeader>
        <GdriveConnect onAuthError={onAuthError} />
      </DialogContent>
    );
  }

  if (node.modal === "soon") {
    return (
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        overlayClassName="bg-transparent backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {node.provider && <ProviderLogo id={node.provider} size={22} grey />}
            {node.label}
          </DialogTitle>
          <DialogDescription>Coming soon</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-foreground-muted">
          <p>
            <span className="font-medium text-foreground">{node.label}</span> isn&apos;t
            a connectable source yet. Today Indigo Iota reads from email
            (Microsoft 365 and IMAP); chat, document, and notes connectors are on
            the roadmap.
          </p>
          <p className="text-xs text-foreground-subtle">
            When it lands, it&apos;ll appear here as a live source you can connect
            and backfill, feeding the same scope gate before anything reaches your
            workspace brain.
          </p>
        </div>
      </DialogContent>
    );
  }

  if (node.modal === "hometurf") {
    return (
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        overlayClassName="bg-transparent backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle>
            <HomeTurfLogo size={22} />
          </DialogTitle>
          <DialogDescription>This workspace · always on</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-foreground-muted">
          <p>
            Home Turf is Indigo Iota&apos;s own home for your brain — right here in
            this workspace. Ask questions, explore the knowledge graph, and read
            entity pages from the{" "}
            <span className="font-medium text-foreground">Ask</span>,{" "}
            <span className="font-medium text-foreground">Graph</span>, and{" "}
            <span className="font-medium text-foreground">Pages</span> tabs.
          </p>
          <p className="flex items-start gap-1.5 text-xs text-foreground-subtle">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            No setup needed — it&apos;s on by default for everyone in the
            workspace and always reflects the latest brain.
          </p>
        </div>
      </DialogContent>
    );
  }

  // assistant (Claude / ChatGPT)
  return (
    <DialogContent
      className="max-w-2xl max-h-[85vh] overflow-y-auto"
      overlayClassName="bg-transparent backdrop-blur-none"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {node.provider && <ProviderLogo id={node.provider} size={22} />}
          {node.label}
        </DialogTitle>
        <DialogDescription>
          Link this workspace&apos;s brain to {node.label} over MCP (read-only).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background-soft/30 px-3 py-2">
          {assistantConnected ? (
            <Badge variant="success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              An assistant is connected
            </Badge>
          ) : (
            <Badge variant="default">
              <Plug className="h-3.5 w-3.5" />
              Not connected yet
            </Badge>
          )}
          {lastActivity && (
            <span className="text-[11px] text-foreground-subtle">
              Last activity: {new Date(lastActivity).toLocaleString("en-US")}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground-subtle">
          Connection status is shared across assistants — it reflects whether any
          assistant (Claude or ChatGPT) is linked. Follow the steps below for{" "}
          {node.label}.
        </p>
        <ConnectTab only={node.id === "claude" ? "claude" : "chatgpt"} />
      </div>
    </DialogContent>
  );
}

function LegendKey({ kind, label }: { kind: EdgeKind; label: string }) {
  const s = edgeStroke(kind);
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={22} height={6} aria-hidden>
        <line
          x1={1}
          y1={3}
          x2={21}
          y2={3}
          stroke={s.stroke as string}
          strokeWidth={2}
          strokeDasharray={s.strokeDasharray as string | undefined}
          opacity={s.opacity as number}
        />
      </svg>
      {label}
    </span>
  );
}

