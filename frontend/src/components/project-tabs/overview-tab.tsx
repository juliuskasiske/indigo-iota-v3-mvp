"use client";

import {
  Activity,
  Mail,
  FileCheck,
  AlertTriangle,
  Flag,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate, initials, relativeTime } from "@/lib/utils";
import type { ActivityItem, Project, Workstream } from "@/lib/mock/types";

const workstreamStatus = {
  "on-track": { label: "On track", variant: "success" as const, color: "text-success" },
  "at-risk": { label: "At risk", variant: "warning" as const, color: "text-warning" },
  blocked: { label: "Blocked", variant: "default" as const, color: "text-destructive" },
  completed: { label: "Completed", variant: "default" as const, color: "text-success" },
};

const activityIcon = {
  email: Mail,
  decision: CheckCircle2,
  deliverable: FileCheck,
  risk: AlertTriangle,
  milestone: Flag,
};

const activityColor = {
  email: "text-foreground-subtle",
  decision: "text-success",
  deliverable: "text-accent",
  risk: "text-destructive",
  milestone: "text-warning",
};

export function ProjectOverviewTab({ project }: { project: Project }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Workstreams + activity (main column) */}
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Workstreams</span>
              <span className="text-xs font-normal text-foreground-subtle">
                {project.workstreams.length} active
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.workstreams.map((ws) => (
              <WorkstreamRow
                key={ws.id}
                workstream={ws}
                ownerName={project.team.find((p) => p.id === ws.owner)?.name ?? "—"}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                Recent activity
              </span>
              <span className="text-xs font-normal text-foreground-subtle">
                synthesized from email traffic
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative border-l border-border ml-2 space-y-5">
              {project.recentActivity.slice(0, 8).map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  workstream={
                    project.workstreams.find((w) => w.id === item.workstreamId) ?? null
                  }
                />
              ))}
            </ol>
            {project.recentActivity.length > 8 && (
              <div className="mt-4 pt-3 border-t border-border text-center">
                <button className="text-xs text-foreground-muted hover:text-foreground inline-flex items-center gap-1">
                  Show all {project.recentActivity.length} events
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team + meta (sidebar) */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.team.map((person) => (
              <div key={person.id} className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-[10px]">
                    {initials(person.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{person.name}</div>
                  <div className="text-xs text-foreground-subtle truncate">
                    {person.role}
                  </div>
                </div>
                {person.synced && (
                  <span
                    title="Synced with project brain"
                    className="inline-flex h-1.5 w-1.5 rounded-full bg-success shrink-0"
                  />
                )}
              </div>
            ))}
            <div className="border-t border-border pt-3 mt-2">
              <div className="text-[11px] text-foreground-subtle mb-2">
                Partners
              </div>
              {project.partners.map((person) => (
                <div key={person.id} className="flex items-center gap-3 mt-2 first:mt-0">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-[10px]">
                      {initials(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{person.name}</div>
                    <div className="text-xs text-foreground-subtle truncate">
                      {person.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project context</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground-muted leading-relaxed">
              {project.context}
            </p>

            {/* What the manager configured during init */}
            <div className="mt-4 pt-3 border-t border-border space-y-3">
              <div>
                <div className="text-[11px] text-foreground-subtle mb-1.5">
                  Project window
                </div>
                <div className="text-xs text-foreground font-mono">
                  {formatDate(project.startDate)} → {formatDate(project.endDate)}
                </div>
              </div>

              {project.slackChannels.length > 0 && (
                <div>
                  <div className="text-[11px] text-foreground-subtle mb-1.5">
                    Slack channels
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {project.slackChannels.map((ch) => (
                      <span
                        key={ch}
                        className="inline-flex items-center rounded-full border border-border bg-background-soft px-2 py-0.5 text-[10px] font-mono text-foreground-muted"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {project.sharepointPath && (
                <div>
                  <div className="text-[11px] text-foreground-subtle mb-1.5">
                    SharePoint folder
                  </div>
                  <div className="text-[11px] text-foreground-muted font-mono break-all">
                    {project.sharepointPath}
                  </div>
                </div>
              )}
            </div>

            {/* What Iota has synced so far */}
            <div className="mt-4 pt-3 border-t border-border space-y-2 text-xs">
              <div className="text-[11px] text-foreground-subtle mb-1">
                Activity
              </div>
              <MetaRow label="Brain pages" value={`${project.brainPages}`} />
              <MetaRow label="Emails synced" value={`${project.emailsScanned}`} />
              <MetaRow label="Files synced" value={`${project.filesScanned}`} />
              <MetaRow
                label="Slack messages"
                value={project.slackMessagesScanned.toLocaleString()}
              />
              <MetaRow label="Last sync" value={relativeTime(project.lastSync)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkstreamRow({
  workstream: ws,
  ownerName,
}: {
  workstream: Workstream;
  ownerName: string;
}) {
  const status = workstreamStatus[ws.status];
  return (
    <div className="rounded-md border border-border bg-background-soft/30 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold">{ws.name}</h4>
            <Badge variant={status.variant} className="text-[10px]">
              {status.label}
            </Badge>
          </div>
          <p className="text-xs text-foreground-muted leading-relaxed line-clamp-2">
            {ws.description}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-foreground-subtle">Owner</div>
          <div className="text-xs font-medium">{ownerName}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 relative h-1 rounded-full overflow-hidden bg-background-soft">
          <div
            className={cn(
              "absolute inset-y-0 left-0 transition-all",
              ws.status === "at-risk"
                ? "bg-warning"
                : ws.status === "blocked"
                ? "bg-destructive"
                : "bg-gradient-to-r from-primary to-accent"
            )}
            style={{ width: `${ws.progress}%` }}
          />
        </div>
        <span className="text-xs font-mono text-foreground-muted shrink-0">
          {ws.progress}%
        </span>
      </div>

      {ws.nextMilestone && (
        <div className="mt-2.5 text-xs text-foreground-muted">
          Next:{" "}
          <span className="text-foreground">{ws.nextMilestone}</span>
          {ws.dueDate && (
            <span className="text-foreground-subtle font-mono ml-1.5">
              · due {new Date(ws.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  item,
  workstream,
}: {
  item: ActivityItem;
  workstream: Workstream | null;
}) {
  const Icon = activityIcon[item.type];
  return (
    <li className="ml-5 fade-in-up">
      <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-background bg-background-elevated">
        <span
          className={cn(
            "absolute inset-0.5 rounded-full",
            activityColor[item.type].replace("text-", "bg-")
          )}
        />
      </span>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-3.5 w-3.5", activityColor[item.type])} />
        <span className="text-[11px] text-foreground-subtle">
          {item.type}
        </span>
        {workstream && (
          <Badge variant="outline" className="text-[10px]">
            {workstream.name}
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-foreground-subtle font-mono">
          {relativeTime(item.date)}
        </span>
      </div>
      <h5 className="text-sm font-medium text-foreground mb-1">{item.title}</h5>
      <p className="text-xs text-foreground-muted leading-relaxed">{item.summary}</p>
      <p className="mt-1.5 text-[10px] text-foreground-subtle font-mono truncate">
        ↳ {item.source}
      </p>
    </li>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground-subtle text-[11px]">
        {label}
      </span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
