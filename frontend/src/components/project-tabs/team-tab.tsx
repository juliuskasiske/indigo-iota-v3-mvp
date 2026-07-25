"use client";

import { useState } from "react";
import {
  UserPlus,
  Mail,
  Inbox,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  X,
  Send,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PartnerBriefingPanel } from "@/components/panels/partner-briefing-panel";
import { TeamOnboardingPanel } from "@/components/panels/team-onboarding-panel";
import { cn, initials } from "@/lib/utils";
import type { Person, Project } from "@/lib/mock/types";

export function ProjectTeamTab({ project }: { project: Project }) {
  // Local state — manager can pause sync for a teammate for this demo.
  // State is component-local; on refresh, everyone is synced again.
  const [unsubscribed, setUnsubscribed] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<Person | null>(null);
  const [briefingForPartner, setBriefingForPartner] = useState<Person | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Consultants */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Consultants</h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              {project.team.length - unsubscribed.size} of {project.team.length}{" "}
              in the loop
            </p>
          </div>
          <Button variant="primary" onClick={() => setOnboardingOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Onboard team member
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {project.team.map((person) => {
                const isUnsubscribed = unsubscribed.has(person.id);
                const taskCount = project.tasks.filter(
                  (t) => t.assigneeId === person.id
                ).length;
                return (
                  <li
                    key={person.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors",
                      isUnsubscribed && "opacity-55"
                    )}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{initials(person.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate mb-0.5">
                        {person.name}
                      </div>
                      <div className="text-xs text-foreground-subtle font-mono truncate">
                        {person.email}
                      </div>
                    </div>
                    <div className="hidden md:flex items-center gap-3 text-xs text-foreground-muted shrink-0">
                      <span className="inline-flex items-center gap-1">
                        <Inbox className="h-3 w-3" />
                        <span className="font-mono">
                          {Math.floor(70 + Math.random() * 40)}
                        </span>{" "}
                        synced · 7d
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        <span className="font-mono">{taskCount}</span> tasks
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isUnsubscribed ? (
                        <Badge variant="outline" className="text-foreground-subtle">
                          Sync paused
                        </Badge>
                      ) : (
                        <Badge variant="success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Synced
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          isUnsubscribed
                            ? setUnsubscribed((prev) => {
                                const next = new Set(prev);
                                next.delete(person.id);
                                return next;
                              })
                            : setConfirmRemove(person)
                        }
                      >
                        {isUnsubscribed ? (
                          <>Re-enable</>
                        ) : (
                          <>
                            <ShieldOff className="h-3.5 w-3.5" />
                            Remove
                          </>
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Partners */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Partners</h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              Send any partner a tailored briefing on demand — no manual
              catch-up required.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {project.partners.map((partner) => (
                <li
                  key={partner.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{initials(partner.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {partner.name}
                    </div>
                    <div className="text-xs text-foreground-subtle font-mono truncate">
                      {partner.email}
                    </div>
                  </div>
                  <Badge variant="primary" className="hidden md:inline-flex">
                    Partner
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setBriefingForPartner(partner)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send partner briefing
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* --- Confirm remove dialog --- */}
      <Dialog
        open={!!confirmRemove}
        onOpenChange={(v) => !v && setConfirmRemove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Pause sync for {confirmRemove?.name}?
            </DialogTitle>
            <DialogDescription>
              Iota will stop syncing their email, Slack, and shared files into
              the project brain. They&apos;ll keep their access — brain pages
              already extracted are kept too. You can resume sync anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmRemove) {
                  setUnsubscribed((prev) => {
                    const next = new Set(prev);
                    next.add(confirmRemove.id);
                    return next;
                  });
                  setConfirmRemove(null);
                }
              }}
            >
              <ShieldOff className="h-4 w-4" />
              Pause sync
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Briefing dialog --- */}
      <Dialog
        open={!!briefingForPartner}
        onOpenChange={(v) => !v && setBriefingForPartner(null)}
      >
        <DialogContent className="max-w-5xl p-0 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" />
              Partner briefing
              {briefingForPartner && (
                <>
                  <span className="text-foreground-subtle font-normal mx-1">
                    ·
                  </span>
                  <span className="font-normal text-foreground-muted">
                    for {briefingForPartner.name}
                  </span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Generate a tailored briefing for the partner.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto p-6">
            {briefingForPartner && (
              <PartnerBriefingPanel
                project={project}
                forPartnerName={briefingForPartner.name}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* --- Onboarding dialog --- */}
      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent className="max-w-5xl p-0 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              Onboard a new team member
            </DialogTitle>
            <DialogDescription className="sr-only">
              Pick a workstream + new hire to generate the onboarding brief.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto p-6">
            <TeamOnboardingPanel project={project} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
