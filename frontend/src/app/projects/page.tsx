"use client";

import Link from "next/link";
import { ArrowRight, Mail, Network } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientLogo } from "@/components/client-logo";
import { RelativeTime } from "@/components/relative-time";
import { DeleteProjectControl } from "@/components/delete-project-control";
import { useProjects } from "@/lib/store/projects-store";

const statusVariant = {
  active: "success",
  planning: "accent",
  closing: "warning",
  draft: "outline",
} as const;

export default function ProjectsListPage() {
  const { projects: allProjects } = useProjects();
  return (
    <AppShell>
      <div className="relative z-10 p-6 md:p-10 max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs text-accent mb-3">
              All engagements
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Projects
            </h1>
            <p className="mt-2 text-foreground-muted">
              {allProjects.length} active project brains
            </p>
          </div>
          <Button asChild variant="primary">
            <Link href="/projects/new">Initialize Project</Link>
          </Button>
        </div>

        <div className="space-y-3">
          {allProjects.map((project) => (
            <Link key={project.id} href={`/projects/view?id=${project.id}`} className="block group">
              <Card className="hover:border-border-strong hover:bg-background-elevated transition-all">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <ClientLogo
                      companyId={project.clientCompany.id}
                      variant={project.clientCompany.logoVariant}
                      size={40}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-base">{project.name}</CardTitle>
                        <Badge variant={statusVariant[project.status]}>
                          {project.status}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {project.client} · {project.clientCompany.industry}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-foreground-muted shrink-0">
                      <span className="hidden md:inline">
                        Week{" "}
                        <span className="font-mono text-foreground">
                          {project.weekNumber}
                        </span>{" "}
                        / {project.totalWeeks}
                      </span>
                      <span className="hidden md:inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        <span className="font-mono">{project.emailsScanned}</span>
                      </span>
                      <span className="hidden md:inline-flex items-center gap-1">
                        <Network className="h-3 w-3" />
                        <span className="font-mono">{project.brainPages}</span>
                      </span>
                      <RelativeTime
                        date={project.lastSync}
                        className="font-mono text-foreground-subtle"
                      />
                      <DeleteProjectControl
                        projectId={project.id}
                        projectName={project.name}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      />
                      <ArrowRight className="h-4 w-4 text-foreground-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
