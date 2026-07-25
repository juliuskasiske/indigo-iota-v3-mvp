import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  Server,
  Mail,
  MessageSquare,
  FolderOpen,
  Activity,
} from "lucide-react";
import { allProjects } from "@/lib/mock/data";

export default function SettingsPage() {
  const totals = allProjects.reduce(
    (acc, p) => ({
      emails: acc.emails + p.emailsScanned,
      files: acc.files + p.filesScanned,
      slack: acc.slack + p.slackMessagesScanned,
    }),
    { emails: 0, files: 0, slack: 0 }
  );

  return (
    <AppShell>
      <div className="relative z-10 p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-3">
            Settings
          </p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Workspace settings
          </h1>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-accent" />
                Meridian Strategy Partners
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Plan" value={<Badge variant="accent">Team — 12 seats</Badge>} />
              <Row label="Workspace ID" value={<span className="font-mono text-xs text-foreground-muted">ws_meridian_a8f3</span>} />
              <Row label="Created" value="March 2, 2026" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                Sources synced with project brains
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    Emails
                  </span>
                }
                value={
                  <span className="font-mono">
                    {totals.emails.toLocaleString()}
                  </span>
                }
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" />
                    Files (SharePoint)
                  </span>
                }
                value={
                  <span className="font-mono">
                    {totals.files.toLocaleString()}
                  </span>
                }
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Slack messages
                  </span>
                }
                value={
                  <span className="font-mono">
                    {totals.slack.toLocaleString()}
                  </span>
                }
              />
              <Row
                label="Across projects"
                value={
                  <span className="font-mono">
                    {allProjects.length}
                  </span>
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-accent" />
                Connected providers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Google Workspace" value={<Badge variant="success">Connected</Badge>} />
              <Row label="Microsoft 365" value={<Badge variant="success">Connected</Badge>} />
              <Row label="Slack" value={<Badge variant="success">Connected</Badge>} />
              <Row label="SharePoint" value={<Badge variant="success">Connected</Badge>} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4 text-accent" />
                Model &amp; compute
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="LLM provider" value="EU-sovereign (LLMBase)" />
              <Row label="Synthesis model" value={<span className="font-mono text-xs">claude-opus-4.7</span>} />
              <Row label="Embeddings" value={<span className="font-mono text-xs">bge-small-en-v1.5 (local)</span>} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 py-1.5 border-b border-border/40 last:border-0">
      <div className="text-xs uppercase tracking-wider text-foreground-subtle">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}
