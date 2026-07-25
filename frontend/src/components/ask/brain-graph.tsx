"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Network, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { KnowledgeGraph, EntityType } from "@/lib/mock/types";

// The 3D graph pulls in three.js + WebGL, which can't server-render, so it's
// loaded only in the browser (the projects-demo graph tab does the same).
const KnowledgeGraph3D = dynamic(
  () => import("@/components/knowledge-graph-3d").then((m) => m.KnowledgeGraph3D),
  {
    ssr: false,
    loading: () => (
      <Card className="h-[640px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <span className="text-sm">Initializing 3D graph engine…</span>
        </div>
      </Card>
    ),
  },
);

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; graph: KnowledgeGraph };

// Renders the caller org's whole brain as the same 3D knowledge graph the
// product demo shows — but fed by the real `/api/qa/graph` data. `highlightIds`
// are the entity ids an answer cited; the graph flies to / spotlights them.
export function BrainGraph({
  title,
  highlightIds,
  onAuthError,
  onOpenPage,
  onClearHighlight,
}: {
  title: string;
  highlightIds?: string[];
  onAuthError: (reason: string) => void;
  // Open a clicked node's full brain page (the Ask page handles it).
  onOpenPage?: (pagePath: string) => void;
  // Clear the cited-highlight source upstream (the Ask page's citedIds).
  onClearHighlight?: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const g = await api.graph();
      if (!g.nodes.length) {
        setState({ kind: "empty" });
        return;
      }
      // The backend node `type` is an open ontology string; the demo graph
      // type is a named union, but the renderer only uses it as a colour key,
      // so the cast is safe.
      setState({
        kind: "ready",
        graph: {
          nodes: g.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            type: n.type as EntityType,
            group: n.group,
            description: n.description ?? undefined,
            page_path: n.page_path ?? undefined,
            val: n.val,
          })),
          links: g.links.map((l) => ({
            source: l.source,
            target: l.target,
            label: l.label,
          })),
        },
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(
          e.status === 403
            ? "Your session lacks access to this workspace. Sign in again."
            : "Your session expired. Please sign in again.",
        );
        return;
      }
      setState({
        kind: "error",
        message:
          e instanceof Error ? e.message : "Could not load the knowledge graph.",
      });
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="h-[640px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <span className="text-sm">Loading the knowledge graph…</span>
        </div>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="h-[640px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (state.kind === "empty") {
    return (
      <Card className="h-[640px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center px-6 max-w-sm">
          <Network className="h-7 w-7 text-foreground-subtle" />
          <p className="text-sm font-medium text-foreground">
            The brain has no entities yet
          </p>
          <p className="text-xs text-foreground-muted leading-relaxed">
            Once mail has been ingested and processed, the people, companies,
            and projects it mentions appear here as a living graph.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <KnowledgeGraph3D
      graph={state.graph}
      title={title}
      highlightIds={highlightIds}
      onOpenPage={onOpenPage}
      onClearHighlight={onClearHighlight}
    />
  );
}
