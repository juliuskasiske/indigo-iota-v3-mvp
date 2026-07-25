"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProjectView } from "@/components/project-view";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/lib/store/projects-store";

/**
 * Project detail at /projects/view?id=<projectId>.
 *
 * Query-param routing (rather than a /projects/[id] dynamic segment) so the
 * static export is a single page that resolves any id — including projects
 * the user just created — entirely client-side. Survives hard refresh.
 */
function ProjectViewInner() {
  const params = useSearchParams();
  const projectId = params.get("id") ?? "";
  const { getProject, hydrated } = useProjects();
  const project = getProject(projectId);

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-foreground-muted">
        <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
        Loading project…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="relative z-10 p-6 md:p-10 max-w-2xl mx-auto">
        <div className="rounded-lg border border-dashed border-border bg-background-elevated/40 p-12 text-center">
          <h1 className="text-lg font-semibold mb-1">Project not found</h1>
          <p className="text-sm text-foreground-muted mb-5">
            We couldn&apos;t find a project with that id. It may have been
            created in a different browser.
          </p>
          <Button asChild variant="primary">
            <Link href="/demo">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <ProjectView project={project} />;
}

export default function ProjectViewPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[40vh] text-foreground-muted">
            <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
            Loading…
          </div>
        }
      >
        <ProjectViewInner />
      </Suspense>
    </AppShell>
  );
}
