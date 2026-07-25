"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MorningCheckIn } from "@/components/morning-check-in";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useProjects } from "@/lib/store/projects-store";

/** Morning check-in at /projects/check-in?id=<projectId>. */
function CheckInInner() {
  const params = useSearchParams();
  const projectId = params.get("id") ?? "";
  const { getProject, hydrated } = useProjects();
  const project = getProject(projectId);

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-foreground-muted">
        <Loader2 className="h-5 w-5 animate-spin text-accent mr-2" />
        Loading…
      </div>
    );
  }

  if (!project || !project.todaysCheckIn) {
    return (
      <div className="relative z-10 p-6 md:p-10 max-w-2xl mx-auto">
        <div className="rounded-lg border border-dashed border-border bg-background-elevated/40 p-12 text-center">
          <h1 className="text-lg font-semibold mb-1">No check-in available</h1>
          <p className="text-sm text-foreground-muted mb-5">
            This project doesn&apos;t have a morning check-in yet.
          </p>
          <Button asChild variant="primary">
            <Link href="/demo">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <MorningCheckIn project={project} />;
}

export default function CheckInPage() {
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
        <CheckInInner />
      </Suspense>
    </AppShell>
  );
}
