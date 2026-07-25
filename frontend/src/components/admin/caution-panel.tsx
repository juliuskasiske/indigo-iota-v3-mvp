"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { ShieldAlert, Save, RotateCcw, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, ApiError, type Scope } from "@/lib/api";
import type { CommitHandle } from "@/components/admin/commit-handle";

// The Layer-2 red zone runoff is hard for anyone to reason about as a raw
// number, so we expose it as a few named caution levels instead. Each maps to
// a cosine margin given to "red zone" when it goes head-to-head with "in scope".
const CAUTION_LEVELS = [
  {
    key: "balanced",
    label: "Balanced",
    margin: 0.0,
    blurb:
      "Excludes an email only when it looks more like red zone material than in scope work.",
  },
  {
    key: "cautious",
    label: "Cautious",
    margin: 0.08,
    blurb:
      "Excludes when red zone material is a close match, even if in scope edges it out.",
  },
  {
    key: "strict",
    label: "Strict",
    margin: 0.18,
    blurb:
      "Excludes at the first real hint of red zone material, even if it mostly looks in scope.",
  },
] as const;

type CautionLevel = (typeof CAUTION_LEVELS)[number];

function levelForMargin(m: number): CautionLevel {
  let best: CautionLevel = CAUTION_LEVELS[0];
  for (const l of CAUTION_LEVELS) {
    if (Math.abs(l.margin - m) < Math.abs(best.margin - m)) best = l;
  }
  return best;
}

export const CautionPanel = forwardRef<
  CommitHandle,
  {
    onAuthError: (e: ApiError) => void;
    // Wizard hides the Save/Reset footer and drives commit() from Next.
    embedded?: boolean;
  }
>(function CautionPanel({ onAuthError, embedded = false }, ref) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [margin, setMargin] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.scope();
      setScope(s);
      setMargin(s.margin);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load scope.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(next: number) {
    setMargin(next);
    setSaved(false);
  }

  async function commit() {
    if (margin == null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api.updateScope({ margin });
      setScope(next);
      setMargin(next.margin);
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
      } else {
        setError(e instanceof Error ? e.message : "Failed to save caution level.");
      }
      throw e; // surfaces to the wizard's Next so it can stay put
    } finally {
      setSaving(false);
    }
  }

  // Expose commit() so the wizard's Next can persist this step in one click.
  useImperativeHandle(ref, () => ({ commit }));

  // The dashboard's own Save button — errors are already shown inline.
  function save() {
    commit().catch(() => {});
  }

  const level = margin != null ? levelForMargin(margin) : CAUTION_LEVELS[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-accent" />
          Red zone caution
        </CardTitle>
        <CardDescription>
          When an email looks like in scope, Indigo Iota double-checks against the red
          zone. Adjust how cautious Indigo Iota should be to include in scope emails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : margin != null && scope ? (
          <>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            <div className="inline-flex rounded-md border border-border p-0.5">
              {CAUTION_LEVELS.map((l) => {
                const active = level.key === l.key;
                return (
                  <button
                    key={l.key}
                    type="button"
                    disabled={saving}
                    onClick={() => pick(l.margin)}
                    className={cn(
                      "rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                      active
                        ? "bg-accent text-white"
                        : "text-foreground-muted hover:text-foreground",
                    )}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-accent">{level.blurb}</p>

            {!embedded && (
              <div className="flex items-center gap-2 border-t border-border/40 pt-3">
                <Button disabled={saving} onClick={save}>
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save caution"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => scope && setMargin(scope.margin)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                {saved && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Saved
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-destructive">{error ?? "Could not load caution level."}</p>
        )}
      </CardContent>
    </Card>
  );
});
