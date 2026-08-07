"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  GraphLink,
  GraphNode,
  KnowledgeGraph,
  Project,
} from "@/lib/mock/types";

const TYPE_COLORS: Record<string, string> = {
  person: "#22d3ee",       // teal
  company: "#c084fc",      // purple
  project: "#818cf8",      // indigo (default-ontology project type)
  workstream: "#818cf8",   // indigo
  deliverable: "#fbbf24",  // amber
  task: "#fb923c",         // orange
  milestone: "#34d399",    // green
  objective: "#f472b6",    // pink
  decision: "#4ade80",     // emerald
  risk: "#f87171",         // coral
};

const TYPE_LABEL: Record<string, string> = {
  person: "Person",
  company: "Company",
  project: "Project",
  workstream: "Workstream",
  deliverable: "Deliverable",
  task: "Task",
  milestone: "Milestone",
  objective: "Project",
  decision: "Decision",
  risk: "Risk",
};

// Render a stored predicate (snake_case, e.g. "works_at" / "communicated_with")
// as a human display name ("Works at" / "Communicated with").
function prettyPredicate(pred?: string): string {
  if (!pred) return "related to";
  return pred.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// A link endpoint may be an id string or (after the force engine runs) a node
// object — normalise to the id either way.
function endId(e: unknown): string {
  if (typeof e === "string") return e;
  const o = e as { id?: string } | null;
  return o?.id ?? "";
}

interface RFGNode extends GraphNode {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export function KnowledgeGraph3D({
  project,
  graph,
  title,
  highlightIds,
  onOpenPage,
  onClearHighlight,
}: {
  project?: Project;
  graph: KnowledgeGraph;
  // Label shown in the stats overlay. Falls back to the project name (the
  // projects-demo caller) or a generic label (the Ask-page brain caller).
  title?: string;
  // Node ids to spotlight — the entities an answer cited. When set, the graph
  // flies to them and emphasises them + their neighbours (same visual the
  // manual click-to-focus uses), without needing a manual selection.
  highlightIds?: string[];
  // Brain caller only: open the selected node's full brain page. When set, the
  // inspector shows an "Open page" action for nodes that carry a page_path.
  onOpenPage?: (pagePath: string) => void;
  // Brain caller only: clear the source of the cited highlight upstream, so it
  // doesn't reapply when this component remounts (e.g. on tab switch).
  onClearHighlight?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<RFGNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 640 });
  const [hovered, setHovered] = useState<RFGNode | null>(null);
  const [selected, setSelected] = useState<RFGNode | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // When the user clears the answer-cited spotlight, suppress highlightIds until
  // a new set arrives (a fresh question re-populates and un-suppresses it).
  const [highlightCleared, setHighlightCleared] = useState(false);
  useEffect(() => {
    setHighlightCleared(false);
  }, [highlightIds]);
  const activeHighlight = highlightCleared ? undefined : highlightIds;

  // Per-type visibility — types in this set are hidden. Empty = everything visible.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  // Always compute legend counts from the unfiltered source so toggling
  // doesn't make the "total per type" number jump around.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [graph]);

  // id -> display name, so an edge tooltip can render "Source — Predicate → Target"
  // (the force engine may pass an endpoint as an id string or a node object).
  const nodeLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) m.set(n.id, n.label);
    return m;
  }, [graph]);
  // All relationships keyed by the UNORDERED pair of endpoint ids ("a|b"), so an
  // edge hover can list every predicate between the two entities (multiple
  // predicates render as separate, overlapping links — this re-groups them).
  // Built from the raw links (stable string ids, not mutated by the engine).
  const pairRelations = useMemo(() => {
    const m = new Map<string, { s: string; t: string; label?: string }[]>();
    for (const l of graph.links) {
      const s = endId(l.source);
      const t = endId(l.target);
      if (!s || !t) continue;
      const key = [s, t].sort().join("|");
      const arr = m.get(key);
      if (arr) arr.push({ s, t, label: l.label });
      else m.set(key, [{ s, t, label: l.label }]);
    }
    return m;
  }, [graph]);

  // Filtered graph data. Re-derived whenever the user toggles a type.
  // We filter nodes by type, then drop any link whose endpoint is gone.
  // Links from the force engine may have been mutated to point at node
  // objects rather than ids — handle both.
  const graphData = useMemo(() => {
    const visibleNodeIds = new Set(
      graph.nodes
        .filter((n) => !hiddenTypes.has(n.type))
        .map((n) => n.id)
    );
    const linkEnd = (e: string | { id: string }) =>
      typeof e === "string" ? e : e.id;
    return {
      nodes: graph.nodes
        .filter((n) => !hiddenTypes.has(n.type))
        .map((n) => ({ ...n })) as RFGNode[],
      links: graph.links
        .filter(
          (l) =>
            visibleNodeIds.has(linkEnd(l.source as string | { id: string })) &&
            visibleNodeIds.has(linkEnd(l.target as string | { id: string }))
        )
        .map((l) => ({ ...l })),
    };
  }, [hiddenTypes, graph]);

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // If the currently-selected node's type gets hidden, drop the selection
  // so the inspector panel doesn't dangle.
  useEffect(() => {
    if (selected && hiddenTypes.has(selected.type)) {
      setSelected(null);
    }
  }, [hiddenTypes, selected]);

  // Keep a live ref to the working graphData (whose nodes the force engine
  // populates with x/y/z) so flyToNode can read fresh positions inside a
  // setTimeout closure.
  const graphDataRef = useRef(graphData);
  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  // Center the camera on a node — used by both onNodeClick and the search
  // bar. Handles the case where the node's type is currently hidden by
  // unhiding it first, then waiting for the force engine to assign
  // positions before flying.
  const flyToNode = useCallback(
    (target: GraphNode, opts?: { select?: boolean }) => {
      const select = opts?.select ?? true;
      const wasHidden = hiddenTypes.has(target.type);
      if (wasHidden) {
        setHiddenTypes((prev) => {
          const next = new Set(prev);
          next.delete(target.type);
          return next;
        });
      }
      // Try a few times — if we just unhid the type, the node needs a
      // moment for the force engine to give it coordinates.
      let attempts = 20;
      const tryFly = () => {
        attempts -= 1;
        const live = graphDataRef.current.nodes.find(
          (n) => n.id === target.id
        ) as RFGNode | undefined;
        if (!live || live.x == null) {
          if (attempts > 0) setTimeout(tryFly, 80);
          return;
        }
        // Manual fly (click / search) locks the node as the selection; an
        // answer-driven fly leaves selection alone so the full cited set stays
        // emphasised via highlightIds.
        if (select) setSelected(live);
        if (!fgRef.current) return;
        const distance = 110;
        const distRatio =
          1 +
          distance /
            Math.hypot(live.x, live.y ?? 1, live.z ?? 1);
        fgRef.current.cameraPosition(
          {
            x: live.x * distRatio,
            y: (live.y ?? 0) * distRatio,
            z: (live.z ?? 0) * distRatio,
          },
          { x: live.x, y: live.y ?? 0, z: live.z ?? 0 },
          1400
        );
      };
      setTimeout(tryFly, wasHidden ? 320 : 0);
    },
    [hiddenTypes]
  );

  // The "focus roots": the nodes whose 1-hop neighbourhood gets spotlighted.
  // A manual selection wins (single node); otherwise the answer's cited
  // entities (highlightIds). Empty = neutral rendering (no spotlight).
  const focusRootIds = useMemo(() => {
    if (selected) return new Set<string>([selected.id]);
    if (activeHighlight && activeHighlight.length)
      return new Set<string>(activeHighlight);
    return null;
  }, [selected, activeHighlight]);

  // For the focus roots, compute the combined 1-hop neighborhood. Used by the
  // render callbacks below to "focus" the roots + their neighbors and
  // de-emphasize everything else. Recomputes on root change or graph change.
  const focus = useMemo(() => {
    if (!focusRootIds) return null;
    const linkEnd = (e: string | { id: string }) =>
      typeof e === "string" ? e : e.id;
    const neighborIds = new Set<string>(focusRootIds);
    const connectedLinkKeys = new Set<string>();
    for (const link of graphData.links) {
      const s = linkEnd(link.source as string | { id: string });
      const t = linkEnd(link.target as string | { id: string });
      if (focusRootIds.has(s)) {
        neighborIds.add(t);
        connectedLinkKeys.add(`${s}→${t}`);
      } else if (focusRootIds.has(t)) {
        neighborIds.add(s);
        connectedLinkKeys.add(`${s}→${t}`);
      }
    }
    return { neighborIds, connectedLinkKeys, linkEnd, rootIds: focusRootIds };
  }, [focusRootIds, graphData]);

  // When the cited entities change (a new answer), fly to the first one. Don't
  // select it — focusRootIds already emphasises the whole cited set.
  useEffect(() => {
    if (!activeHighlight || activeHighlight.length === 0) return;
    const first = graph.nodes.find((n) => n.id === activeHighlight[0]);
    if (first) flyToNode(first, { select: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHighlight]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [fullscreen]);

  // Auto-zoom on mount
  useEffect(() => {
    const t = setTimeout(() => {
      fgRef.current?.zoomToFit(800, 80);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  const handleReset = () => {
    fgRef.current?.zoomToFit(800, 80);
    setSelected(null);
  };

  const visible = hovered ?? selected;

  return (
    <div
      className={cn(
        "relative dark",
        fullscreen && "fixed inset-0 z-50 bg-background p-4"
      )}
    >
      <Card
        ref={containerRef}
        className={cn(
          "relative overflow-hidden bg-[hsl(230_30%_4%)] border-border-strong",
          fullscreen ? "h-full" : "h-[640px]"
        )}
      >
        {/* Ambient gradient backdrop */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(ellipse at center, hsl(230 60% 12% / 0.6), transparent 70%)",
          }}
        />

        {/* 3D Graph */}
        <div className="absolute inset-0 z-10">
          <ForceGraph3D
            ref={fgRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={(n: RFGNode) => `<div style="
              background: rgba(15, 18, 28, 0.95);
              border: 1px solid rgba(34, 211, 238, 0.4);
              backdrop-filter: blur(8px);
              padding: 8px 12px;
              border-radius: 6px;
              font-family: var(--font-inter), system-ui, sans-serif;
              font-size: 12px;
              color: #e6e8eb;
              max-width: 280px;
              line-height: 1.4;
              ">
              <div style="color: ${TYPE_COLORS[n.type] ?? "#fff"}; font-size: 9px; text-transform:; letter-spacing: 1px; font-family: var(--font-albert-sans), monospace; margin-bottom: 3px;">${TYPE_LABEL[n.type] ?? n.type}</div>
              <div style="font-weight: 600; margin-bottom: ${n.description ? "3px" : "0"};">${n.label}</div>
              ${n.description ? `<div style="color: #9aa3b2; font-size: 11px;">${n.description}</div>` : ""}
            </div>`}
            linkLabel={(l: GraphLink) => {
              const a = endId(l.source);
              const b = endId(l.target);
              // Every relationship between this pair (both directions), so a pair
              // with multiple predicates shows them all — not just the one edge hit.
              const rels = pairRelations.get([a, b].sort().join("|")) ?? [
                { s: a, t: b, label: l.label },
              ];
              const rows = rels
                .map((r) => {
                  const sName = nodeLabelById.get(r.s) ?? r.s;
                  const tName = nodeLabelById.get(r.t) ?? r.t;
                  return `<div style="display:flex; align-items:baseline; gap:6px; padding:2px 0;">
                    <span style="color:#9aa3b2;">${sName}</span>
                    <span style="color:#22d3ee; font-family: var(--font-albert-sans), monospace;">${prettyPredicate(r.label)} →</span>
                    <span style="color:#9aa3b2;">${tName}</span>
                  </div>`;
                })
                .join("");
              const header =
                rels.length > 1
                  ? `<div style="font-size:11px; font-family: var(--font-albert-sans), sans-serif; color:#6b7280; margin-bottom:4px;">${rels.length} relationships</div>`
                  : "";
              return `<div style="
                background: rgba(15, 18, 28, 0.95);
                border: 1px solid rgba(180, 200, 220, 0.35);
                backdrop-filter: blur(8px);
                padding: 8px 12px;
                border-radius: 6px;
                font-family: var(--font-inter), system-ui, sans-serif;
                font-size: 12px;
                color: #e6e8eb;
                white-space: nowrap;
                ">${header}${rows}</div>`;
            }}
            nodeColor={(n: RFGNode) => TYPE_COLORS[n.type] ?? "#888"}
            nodeVal={(n: RFGNode) => n.val ?? 6}
            nodeOpacity={0.92}
            nodeResolution={20}
            nodeThreeObject={(n: RFGNode) => {
              const color = TYPE_COLORS[n.type] ?? "#888";
              const group = new THREE.Group();
              const baseSize = Math.cbrt(n.val ?? 6) * 2.2;

              // Focus state: in-focus (a focus root or its neighbor) vs
              // out-of-focus (everything else when something is focused) vs
              // neutral (nothing selected or highlighted).
              const isSelected = focus !== null && focus.rootIds.has(n.id);
              const inFocus = focus === null || focus.neighborIds.has(n.id);

              const size = isSelected ? baseSize * 1.18 : baseSize;
              const sphereOpacity = inFocus ? 0.95 : 0.18;
              const haloScale = isSelected ? 2.0 : 1.55;
              const haloOpacity = isSelected
                ? 0.4
                : inFocus
                ? 0.18
                : 0.04;

              // Inner solid sphere
              const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(size, 24, 24),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: sphereOpacity,
                })
              );
              group.add(sphere);

              // Outer halo
              const halo = new THREE.Mesh(
                new THREE.SphereGeometry(size * haloScale, 24, 24),
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: haloOpacity,
                  depthWrite: false,
                })
              );
              group.add(halo);

              // Extra inner pulse-ring for the selected node — pure visual
              // beacon. Stationary; subtle so it doesn't fight the inspector.
              if (isSelected) {
                const beacon = new THREE.Mesh(
                  new THREE.SphereGeometry(size * 1.35, 24, 24),
                  new THREE.MeshBasicMaterial({
                    color: "#ffffff",
                    transparent: true,
                    opacity: 0.18,
                    depthWrite: false,
                  })
                );
                group.add(beacon);
              }

              return group;
            }}
            linkColor={(l: GraphLink) => {
              if (!focus) return "rgba(180, 200, 220, 0.22)";
              const s = focus.linkEnd(l.source as string | { id: string });
              const t = focus.linkEnd(l.target as string | { id: string });
              const isConnected = focus.connectedLinkKeys.has(`${s}→${t}`);
              return isConnected
                ? "rgba(34, 211, 238, 0.9)" // bright teal
                : "rgba(180, 200, 220, 0.05)"; // very dim
            }}
            linkOpacity={1}
            linkWidth={(l: GraphLink) => {
              if (!focus) return 0.6;
              const s = focus.linkEnd(l.source as string | { id: string });
              const t = focus.linkEnd(l.target as string | { id: string });
              return focus.connectedLinkKeys.has(`${s}→${t}`) ? 1.8 : 0.25;
            }}
            linkDirectionalParticles={(l: GraphLink) => {
              if (!focus) return 2;
              const s = focus.linkEnd(l.source as string | { id: string });
              const t = focus.linkEnd(l.target as string | { id: string });
              return focus.connectedLinkKeys.has(`${s}→${t}`) ? 4 : 0;
            }}
            linkDirectionalParticleSpeed={(l: GraphLink) => {
              if (!focus) return 0.004;
              const s = focus.linkEnd(l.source as string | { id: string });
              const t = focus.linkEnd(l.target as string | { id: string });
              return focus.connectedLinkKeys.has(`${s}→${t}`) ? 0.007 : 0.004;
            }}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleColor={() => "#22d3ee"}
            onNodeHover={(n) => setHovered(n as RFGNode | null)}
            onNodeClick={(n) => flyToNode(n as RFGNode)}
            onBackgroundClick={() => setSelected(null)}
            cooldownTime={4000}
            enableNodeDrag={true}
            warmupTicks={80}
          />
        </div>

        {/* Top overlay — stats + controls */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-start justify-between gap-3 pointer-events-none">
          <div className="rounded-md border border-border bg-background/80 backdrop-blur-sm p-3 pointer-events-auto">
            <div className="text-[11px] text-foreground-subtle mb-1.5">
              {title ?? project?.name ?? "Brain"} · brain
            </div>
            <div className="flex items-baseline gap-3">
              <div>
                <div className="text-2xl font-semibold font-mono leading-none text-foreground">
                  {graphData.nodes.length}
                </div>
                <div className="text-[11px] text-foreground-subtle">
                  entities
                </div>
              </div>
              <div className="text-foreground-subtle text-xs">·</div>
              <div>
                <div className="text-2xl font-semibold font-mono leading-none text-foreground">
                  {graphData.links.length}
                </div>
                <div className="text-[11px] text-foreground-subtle">
                  edges
                </div>
              </div>
            </div>
          </div>

          {/* Search bar — centered */}
          <div className="pointer-events-auto flex-1 max-w-md mx-auto">
            <EntitySearch
              nodes={graph.nodes}
              onSelect={flyToNode}
              hiddenTypes={hiddenTypes}
            />
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Clear the answer-cited spotlight (or a manual selection) so the
                graph returns to its neutral, un-highlighted view. */}
            {(focusRootIds !== null) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  setHighlightCleared(true);
                  // Clear upstream too so a tab-switch remount doesn't re-apply
                  // the cited highlight from a stale parent state.
                  onClearHighlight?.();
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Recenter
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" />
                  Exit
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  Fullscreen
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Legend — clickable filters */}
        <div className="absolute bottom-3 left-3 z-20 rounded-md border border-border bg-background/80 backdrop-blur-sm p-3 pointer-events-auto">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div className="text-[11px] text-foreground-subtle">
              Entity types
            </div>
            {hiddenTypes.size > 0 && (
              <button
                type="button"
                onClick={() => setHiddenTypes(new Set())}
                className="text-[11px] text-accent hover:text-foreground transition-colors"
              >
                Show all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(counts).map(([type, count]) => {
              const hidden = hiddenTypes.has(type);
              const color = TYPE_COLORS[type] ?? "#888";
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    "flex items-center gap-2 text-xs rounded px-1.5 py-0.5 -mx-1.5 transition-colors text-left",
                    "hover:bg-background-elevated/60",
                    hidden && "opacity-45"
                  )}
                  title={hidden ? `Show ${TYPE_LABEL[type] ?? type}` : `Hide ${TYPE_LABEL[type] ?? type}`}
                >
                  {/* Custom checkbox: filled square in type color when on,
                      hollow gray outline when off */}
                  <span
                    className="h-3 w-3 rounded-[3px] shrink-0 flex items-center justify-center transition-all"
                    style={{
                      backgroundColor: hidden ? "transparent" : color,
                      border: hidden
                        ? "1px solid hsl(var(--border-strong))"
                        : `1px solid ${color}`,
                    }}
                  >
                    {!hidden && (
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M1.5 4.2 L3.2 5.8 L6.5 2.2"
                          stroke="hsl(230 50% 10%)"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    className={cn(
                      "transition-colors",
                      hidden ? "text-foreground-subtle line-through" : "text-foreground-muted"
                    )}
                  >
                    {TYPE_LABEL[type] ?? type}
                  </span>
                  <span className="ml-auto font-mono text-foreground-subtle">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hint */}
        <div className="absolute bottom-3 right-3 z-20 text-[10px] text-foreground-subtle font-mono">
          drag to rotate · scroll to zoom · click a node
        </div>

        {/* Inspector panel */}
        {visible && (
          <div className="absolute top-3 right-3 z-30 w-72 rounded-lg border border-border-strong bg-background-elevated/95 backdrop-blur-md p-4 shadow-2xl fade-in-up pointer-events-auto">
            <div className="flex items-center justify-between mb-2">
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{
                  color: TYPE_COLORS[visible.type],
                  borderColor: `${TYPE_COLORS[visible.type]}55`,
                }}
              >
                {TYPE_LABEL[visible.type] ?? visible.type}
              </Badge>
              {selected && (
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs text-foreground-subtle hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>
            <h3 className="text-base font-semibold mb-1.5 leading-tight">
              {visible.label}
            </h3>
            {visible.description && (
              <p className="text-xs text-foreground-muted leading-relaxed">
                {visible.description}
              </p>
            )}
            {/* Open the full brain page (brain caller only, selected node with
                a stored page). Hover-only inspections don't show it. */}
            {selected &&
              visible.id === selected.id &&
              onOpenPage &&
              visible.page_path && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => onOpenPage(visible.page_path!)}
                >
                  Open page
                </Button>
              )}
            {/* Connection count — only when this is the *selected* node
                (focus state). Hover doesn't trigger focus, so don't show
                the count then. */}
            {selected && visible.id === selected.id && focus && (
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <span className="text-[11px] text-foreground-subtle">
                  Connections
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono text-foreground">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#22d3ee" }}
                  />
                  {focus.connectedLinkKeys.size} edge
                  {focus.connectedLinkKeys.size === 1 ? "" : "s"} ·{" "}
                  {focus.neighborIds.size - 1} neighbor
                  {focus.neighborIds.size - 1 === 1 ? "" : "s"}
                </span>
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-foreground-subtle">
              {selected
                ? "selected · click background to dismiss"
                : "hover · click to lock"}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EntitySearch — autocomplete search bar over the project's entities.
// Source data is the unfiltered graph nodes (passed in) so the user can still
// jump to entities of a type they've currently hidden (we auto-unhide on
// select).
// ---------------------------------------------------------------------------

interface EntitySearchProps {
  nodes: GraphNode[];
  onSelect: (node: GraphNode) => void;
  hiddenTypes: Set<string>;
}

const MAX_RESULTS = 6;

function scoreMatch(node: GraphNode, q: string): number {
  const label = node.label.toLowerCase();
  const desc = (node.description ?? "").toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  // word-boundary match anywhere in the label
  if (new RegExp(`\\b${escapeRe(q)}`).test(label)) return 70;
  if (label.includes(q)) return 55;
  if (desc.includes(q)) return 30;
  return 0;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function EntitySearch({ nodes, onSelect, hiddenTypes }: EntitySearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .map((n) => ({ node: n, score: scoreMatch(n, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.node);
  }, [query, nodes]);

  // Reset highlight whenever results change
  useEffect(() => {
    setHighlighted(0);
  }, [results]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (node: GraphNode) => {
    onSelect(node);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[highlighted];
      if (pick) choose(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-background/80 backdrop-blur-sm px-3 h-9",
          "border-border transition-colors",
          open && "border-accent/50 ring-2 ring-accent/20"
        )}
      >
        <Search className="h-3.5 w-3.5 text-foreground-subtle shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search entities… (people, decisions, deliverables)"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-foreground-subtle min-w-0"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="text-foreground-subtle hover:text-foreground shrink-0"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <kbd className="hidden md:inline-flex items-center text-[10px] font-mono text-foreground-subtle border border-border rounded px-1 py-0.5 shrink-0">
          ⌘K
        </kbd>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1.5 rounded-md border border-border-strong bg-background-elevated/95 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden fade-in-up">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-foreground-subtle">
              No entities match &ldquo;
              <span className="text-foreground">{query}</span>&rdquo;
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((n, i) => {
                const isHighlighted = i === highlighted;
                const color = TYPE_COLORS[n.type] ?? "#888";
                const isFiltered = hiddenTypes.has(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlighted(i)}
                      onMouseDown={(e) => {
                        // mousedown so we beat the outside-click handler
                        e.preventDefault();
                        choose(n);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
                        isHighlighted
                          ? "bg-accent/10"
                          : "hover:bg-background-soft/60"
                      )}
                    >
                      <span
                        className="mt-1 h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground font-medium truncate">
                            {highlightMatch(n.label, query)}
                          </span>
                          <span
                            className="text-[11px] shrink-0"
                            style={{ color }}
                          >
                            {TYPE_LABEL[n.type] ?? n.type}
                          </span>
                          {isFiltered && (
                            <span className="text-[10px] font-mono text-foreground-subtle shrink-0">
                              · hidden
                            </span>
                          )}
                        </div>
                        {n.description && (
                          <div className="text-xs text-foreground-subtle truncate mt-0.5">
                            {n.description}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px] text-foreground-subtle font-mono">
            <span>
              <span className="text-foreground">↑↓</span> navigate ·{" "}
              <span className="text-foreground">↵</span> select ·{" "}
              <span className="text-foreground">esc</span> close
            </span>
            <span>{results.length} match{results.length === 1 ? "" : "es"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function highlightMatch(label: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return label;
  const lower = label.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <span className="text-accent">{label.slice(idx, idx + q.length)}</span>
      {label.slice(idx + q.length)}
    </>
  );
}
