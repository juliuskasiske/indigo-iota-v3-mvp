"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { buildKnowledgeGraph } from "@/lib/mock/data";
import type { Project } from "@/lib/mock/types";

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
  }
);

export function ProjectGraphTab({ project }: { project: Project }) {
  // Derive the graph fresh whenever the project's content changes. Cheap —
  // just iterates the project arrays. For new (empty) projects this still
  // produces a coherent core graph: company, consultancy, project, team,
  // workstreams.
  const graph = useMemo(() => buildKnowledgeGraph(project), [project]);
  return <KnowledgeGraph3D project={project} graph={graph} />;
}
