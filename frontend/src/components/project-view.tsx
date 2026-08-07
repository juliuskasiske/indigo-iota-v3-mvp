"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Building2,
  Users,
  Sun,
  ArrowRight,
  X,
  Mail,
  MessageSquare,
  FolderOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClientLogo } from "@/components/client-logo";
import { DeleteProjectControl } from "@/components/delete-project-control";
import { ProjectOverviewTab } from "./project-tabs/overview-tab";
import { ProjectTeamTab } from "./project-tabs/team-tab";
import { ProjectWorkstreamTab } from "./project-tabs/workstream-tab";
import { ProjectDeliverableTab } from "./project-tabs/deliverable-tab";
import { ProjectGraphTab } from "./project-tabs/graph-tab";
import { formatDate } from "@/lib/utils";
import type { Project } from "@/lib/mock/types";

const statusVariant = {
  active: "success",
  planning: "accent",
  closing: "warning",
  draft: "outline",
} as const;

export function ProjectView({ project }: { project: Project }) {
  const router = useRouter();
  const isDeepProject = project.workstreams.length > 0;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showCheckInBanner =
    isDeepProject &&
    !bannerDismissed &&
    project.todaysCheckIn &&
    project.todaysCheckIn.status === "draft";

    // Note: no `z-10` here. A positioned z-index would create a stacking
    // context that traps the graph's fullscreen overlay (fixed z-50) below
    // the app header (z-20). The ambient grain sits at z-index:-1 instead,
    // so content layers correctly without needing to lift this container.
  return (
    <div className="relative p-6 md:p-10 max-w-7xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <Link
          href="/demo"
          className="inline-flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to dashboard
        </Link>
        <DeleteProjectControl
          projectId={project.id}
          projectName={project.name}
          mode="button"
          onDeleted={() => router.push("/demo")}
        />
      </div>

      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
        <div className="flex-1 min-w-0 flex items-start gap-5">
          <ClientLogo
            companyId={project.clientCompany.id}
            variant={project.clientCompany.logoVariant}
            size={56}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-accent">
                {project.client}
              </p>
              <span className="text-foreground-subtle text-xs">·</span>
              <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <p className="mt-2 text-foreground-muted max-w-2xl">{project.description}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 text-xs text-foreground-muted shrink-0 md:items-end">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-foreground-subtle" />
            <span className="font-mono">
              Week {project.weekNumber} / {project.totalWeeks}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-foreground-subtle" />
            {project.clientCompany.industry}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-foreground-subtle" />
            <span className="font-mono">{project.team.length}</span> consultants
          </span>
          <span className="inline-flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1"
              title="Emails synced"
            >
              <Mail className="h-3 w-3 text-foreground-subtle" />
              <span className="font-mono">{project.emailsScanned}</span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              title="Files synced"
            >
              <FolderOpen className="h-3 w-3 text-foreground-subtle" />
              <span className="font-mono">{project.filesScanned}</span>
            </span>
            <span
              className="inline-flex items-center gap-1"
              title="Slack messages synced"
            >
              <MessageSquare className="h-3 w-3 text-foreground-subtle" />
              <span className="font-mono">
                {project.slackMessagesScanned.toLocaleString()}
              </span>
            </span>
          </span>
        </div>
      </header>

      {showCheckInBanner && project.todaysCheckIn && (
        <div className="relative mb-6 overflow-hidden rounded-lg border border-accent/30 bg-gradient-to-r from-accent/10 via-primary/5 to-transparent p-4 fade-in-up">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-10 w-10 rounded-md bg-accent/15 flex items-center justify-center shrink-0">
                <Sun className="h-5 w-5 text-accent" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  Morning check-in ready ·{" "}
                  <span className="text-foreground-muted font-normal">
                    {formatDate(project.todaysCheckIn.date, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild variant="primary" size="sm">
                <Link href={`/projects/check-in?id=${project.id}`}>
                  Open check-in
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="text-foreground-subtle hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeepProject ? (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="workstreams">Workstreams</TabsTrigger>
            <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
            <TabsTrigger value="graph">Knowledge Graph</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <ProjectOverviewTab project={project} />
          </TabsContent>
          <TabsContent value="team">
            <ProjectTeamTab project={project} />
          </TabsContent>
          <TabsContent value="workstreams">
            <ProjectWorkstreamTab project={project} />
          </TabsContent>
          <TabsContent value="deliverables">
            <ProjectDeliverableTab project={project} />
          </TabsContent>
          <TabsContent value="graph">
            <ProjectGraphTab project={project} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-background-elevated/40 p-12 text-center">
          <p className="text-foreground-muted text-sm">
            This project is still being initialized. Check back in a minute — Iota is
            building the brain pages now.
          </p>
        </div>
      )}
    </div>
  );
}
