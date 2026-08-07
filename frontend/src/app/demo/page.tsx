"use client";

import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  Activity,
  Users,
  Network,
  Mail,
  FileText,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientLogo } from "@/components/client-logo";
import { RelativeTime } from "@/components/relative-time";
import { DeleteProjectControl } from "@/components/delete-project-control";
import { useProjects } from "@/lib/store/projects-store";
import { latticePayProject } from "@/lib/mock/data";

const statusVariant = {
  active: "success",
  planning: "accent",
  closing: "warning",
  draft: "outline",
} as const;

export default function Dashboard() {
  const { projects: allProjects } = useProjects();
  return (
    <AppShell>
      <div className="relative z-10 p-6 md:p-10 max-w-7xl mx-auto">
        {/* Hero */}
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs text-accent mb-3">
              Welcome back, Maya
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              Your engagements at a glance
            </h1>
            <p className="mt-2 text-foreground-muted text-base max-w-xl">
              Iota is in sync with{" "}
              <span className="font-mono text-foreground">
                {allProjects.reduce((s, p) => s + p.emailsScanned, 0).toLocaleString()}
              </span>{" "}
              emails,{" "}
              <span className="font-mono text-foreground">
                {allProjects.reduce((s, p) => s + p.filesScanned, 0).toLocaleString()}
              </span>{" "}
              files, and{" "}
              <span className="font-mono text-foreground">
                {allProjects.reduce((s, p) => s + p.slackMessagesScanned, 0).toLocaleString()}
              </span>{" "}
              Slack messages across{" "}
              <span className="font-mono text-foreground">{allProjects.length}</span> active
              projects. Here&apos;s what&apos;s happening.
            </p>
          </div>
          <Button asChild variant="primary" size="lg">
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              Initialize Project
            </Link>
          </Button>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <StatCard
            icon={Activity}
            label="Active projects"
            value={allProjects.filter((p) => p.status === "active").length.toString()}
            sub="+1 this month"
          />
          <StatCard
            icon={Mail}
            label="Sources synced"
            value={(
              allProjects.reduce((s, p) => s + p.emailsScanned, 0) +
              allProjects.reduce((s, p) => s + p.filesScanned, 0) +
              allProjects.reduce((s, p) => s + p.slackMessagesScanned, 0)
            ).toLocaleString()}
            sub="emails · files · Slack"
          />
          <StatCard
            icon={Network}
            label="Brain pages"
            value={allProjects.reduce((s, p) => s + p.brainPages, 0).toString()}
            sub="across all projects"
          />
          <StatCard
            icon={Users}
            label="Team in the loop"
            value={latticePayProject.team.length.toString()}
            sub="active consultants"
          />
        </div>

        {/* Projects */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Active projects</h2>
          <Link
            href="/projects"
            className="text-xs text-foreground-muted hover:text-foreground inline-flex items-center gap-1"
          >
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allProjects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/view?id=${project.id}`}
              className="group"
            >
              <Card className="h-full flex flex-col hover:border-border-strong hover:bg-background-elevated transition-all relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <ClientLogo
                      companyId={project.clientCompany.id}
                      variant={project.clientCompany.logoVariant}
                      size={36}
                    />
                    <div className="flex-1 min-w-0">
                      {/* Reserve 2 lines so cards with short titles still
                          align their progress bars with longer-title cards. */}
                      <CardTitle className="text-base line-clamp-2 min-h-[2.6em] leading-[1.3]">
                        {project.name}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        {project.client} · {project.clientCompany.industry}
                      </CardDescription>
                    </div>
                    <Badge variant={statusVariant[project.status]}>
                      {project.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  {/* Reserve 2 lines so 1-line descriptions don't shift
                      everything below up. */}
                  <p className="text-sm text-foreground-muted leading-relaxed line-clamp-2 min-h-[2.9em]">
                    {project.description}
                  </p>

                  {/* Footer block pinned to bottom of card */}
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex flex-col">
                        <span className="text-[11px] text-foreground-subtle">
                          Progress
                        </span>
                        <span className="text-sm font-mono text-foreground">
                          Week {project.weekNumber} / {project.totalWeeks}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[11px] text-foreground-subtle">
                          Last sync
                        </span>
                        <RelativeTime
                          date={project.lastSync}
                          className="text-sm font-mono text-foreground"
                        />
                      </div>
                    </div>

                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-background-soft">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent transition-all"
                        style={{
                          width: `${(project.weekNumber / project.totalWeeks) * 100}%`,
                        }}
                      />
                    </div>

                    <div className="mt-4 flex items-center gap-4 text-xs text-foreground-muted flex-wrap">
                      <span className="inline-flex items-center gap-1" title="Emails synced">
                        <Mail className="h-3 w-3" />
                        <span className="font-mono">{project.emailsScanned}</span>
                      </span>
                      <span className="inline-flex items-center gap-1" title="Files tracked">
                        <FileText className="h-3 w-3" />
                        <span className="font-mono">{project.filesScanned}</span>
                      </span>
                      <span className="inline-flex items-center gap-1" title="Slack messages synced">
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-mono">{project.slackMessagesScanned.toLocaleString()}</span>
                      </span>
                      <span className="inline-flex items-center gap-1" title="Brain pages">
                        <Network className="h-3 w-3" />
                        <span className="font-mono">{project.brainPages}</span>
                      </span>
                      <DeleteProjectControl
                        projectId={project.id}
                        projectName={project.name}
                        className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          <Link href="/projects/new" className="group">
            <Card className="h-full border-dashed bg-transparent hover:bg-background-elevated/30 hover:border-accent/50 transition-all flex items-center justify-center min-h-[260px]">
              <div className="flex flex-col items-center gap-2 text-foreground-muted group-hover:text-accent transition-colors">
                <div className="rounded-full bg-background-elevated p-3 group-hover:bg-accent/10 transition-colors">
                  <Plus className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">Initialize new project</span>
                <span className="text-xs text-foreground-subtle">
                  Sync sources in under 60 seconds
                </span>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs text-foreground-subtle">
            {label}
          </span>
          <Icon className="h-4 w-4 text-foreground-subtle" />
        </div>
        <div className="text-2xl font-semibold tracking-tight font-mono">
          {value}
        </div>
        <div className="text-xs text-foreground-muted mt-1 flex items-center gap-1">
          <TrendingUp className="h-3 w-3 text-success" />
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
