"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Loader2, CircleCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ApiError,
  type ComprehendSettings,
  type DiligenceMode,
} from "@/lib/api";

const MODES: { value: DiligenceMode; label: string; desc: string }[] = [
  {
    value: "anchored",
    label: "Anchored",
    desc: "Link the principal and the third party to each other and to every other entity. Linear cost — the default.",
  },
  {
    value: "capped",
    label: "Capped",
    desc: "Anchored, but evaluate every pair when an email has only a few entities. Bounded worst case.",
  },
  {
    value: "exhaustive",
    label: "Exhaustive",
    desc: "Evaluate every pair of entities, every email. Most thorough, most LLM calls.",
  },
];

// Human labels for the per-agent context toggles (keys come from the backend).
const AGENT_LABELS: Record<string, string> = {
  identifier: "Entity identifier",
  relationship: "Relationship inference",
  attribute: "Attribute (frontmatter)",
  timeline: "Timeline",
  description: "Description",
};

/**
 * The comprehend "Diligence" config: how exhaustively relationships are inferred
 * (pairing mode) and which per-email agents get third-party brain-page context.
 * Reused by the Admin Center and the Control Tower — the caller supplies load/save.
 */
export function DiligencePanel({
  load,
  save,
  onAuthError,
  title = "Comprehension diligence",
}: {
  load: () => Promise<ComprehendSettings>;
  save: (body: Partial<ComprehendSettings>) => Promise<ComprehendSettings>;
  onAuthError?: (e: ApiError) => void;
  title?: string;
}) {
  const [settings, setSettings] = useState<ComprehendSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleErr = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403) && onAuthError) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed.");
    },
    [onAuthError],
  );

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await load();
        if (live) setSettings(res);
      } catch (e) {
        if (live) handleErr(e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(patch: Partial<ComprehendSettings>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await save(patch);
      setSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      handleErr(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-accent" />
          {title}
        </CardTitle>
        <CardDescription>
          Tune how hard comprehension works per email. More diligence finds more
          relationships and context, but costs more LLM calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}
        {loading || !settings ? (
          <div className="flex h-24 items-center justify-center text-foreground-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-background-soft/30 px-3 py-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-accent"
                disabled={saving}
                checked={!!settings.drive_comprehend_enabled}
                onChange={(e) =>
                  persist({ drive_comprehend_enabled: e.target.checked })
                }
              />
              <span className="min-w-0">
                <span className="font-medium text-foreground">
                  Comprehend Google Drive documents
                </span>
                <span className="mt-0.5 block text-xs text-foreground-muted">
                  Run the agents over connected Drive files to extract people,
                  companies, and relationships into brain pages + the graph.{" "}
                  <strong className="text-foreground">Uses credits.</strong> Off =
                  documents are still searchable (chunked), they just don&rsquo;t
                  enrich the brain.
                </span>
              </span>
            </label>

            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-subtle">
                Relationship pairing
              </p>
              <div className="space-y-2">
                {MODES.map((m) => {
                  const active = settings.relationship_diligence === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      disabled={saving}
                      onClick={() => persist({ relationship_diligence: m.value })}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        active
                          ? "border-accent bg-accent/5"
                          : "border-border hover:bg-background-soft/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2",
                          active ? "border-accent bg-accent" : "border-border-strong",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">{m.label}</span>
                        <span className="mt-0.5 block text-xs text-foreground-muted">
                          {m.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-foreground-subtle">
                Brain-page context per agent
              </p>
              <p className="text-xs text-foreground-muted">
                Feed the third party&rsquo;s 1-hop neighbour pages to these agents as
                extra context (off by default — each one adds tokens).
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {Object.keys(settings.context_agents).map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-foreground-muted"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      disabled={saving}
                      checked={!!settings.context_agents[key]}
                      onChange={(e) =>
                        persist({
                          context_agents: {
                            ...settings.context_agents,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {AGENT_LABELS[key] ?? key}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-foreground-muted">Max neighbour pages</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  disabled={saving}
                  value={settings.context_max_neighbors}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      context_max_neighbors: Number(e.target.value),
                    })
                  }
                  onBlur={(e) =>
                    persist({ context_max_neighbors: Number(e.target.value) })
                  }
                  className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-foreground-subtle">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saved && (
                <span className="flex items-center gap-1 text-success">
                  <CircleCheck className="h-3.5 w-3.5" /> Saved
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
