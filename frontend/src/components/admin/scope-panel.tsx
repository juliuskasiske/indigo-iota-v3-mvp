"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Filter, Save, RotateCcw, CheckCircle2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { api, ApiError, type Scope, type ScopeUpdate } from "@/lib/api";
import type { CommitHandle } from "@/components/admin/commit-handle";

// Fixed, authored copy for the four buckets. Which one is included is policy
// (fixed in the backend); admins only tune each bucket's example snippets.
const BUCKET_META: Record<
  string,
  { label: string; included: boolean; blurb: string }
> = {
  in_scope: {
    label: "In scope",
    included: true,
    blurb:
      "The work this engagement is actually about. Only these emails feed the project brain.",
  },
  redzone: {
    label: "Red zone",
    included: false,
    blurb:
      "Sensitive, privileged, or legally off-limits material that must never enter the brain — even when it involves the same people or project.",
  },
  spam: {
    label: "Spam",
    included: false,
    blurb: "Bulk, automated, or promotional mail with no bearing on the engagement.",
  },
  out_of_scope: {
    label: "Out of scope",
    included: false,
    blurb: "Genuine correspondence that simply isn't about this engagement.",
  },
};

interface Draft {
  anchors: Record<string, string[]>;
}

function toDraft(scope: Scope): Draft {
  const anchors: Record<string, string[]> = {};
  for (const name of scope.editable_buckets) {
    anchors[name] = [...(scope.buckets[name]?.anchors ?? [])];
  }
  return { anchors };
}

function AnchorEditor({
  anchors,
  onChange,
  disabled,
}: {
  anchors: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  function add(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (!anchors.some((a) => a.toLowerCase() === v.toLowerCase())) {
      onChange([...anchors, v]);
    }
    setText("");
  }

  function remove(i: number) {
    onChange(anchors.filter((_, idx) => idx !== i));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && text === "" && anchors.length > 0) {
      remove(anchors.length - 1);
    }
  }

  return (
    <div className="space-y-2">
      {anchors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {anchors.map((a, i) => (
            <span
              key={`${a}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-background-elevated px-2.5 py-1 text-xs text-foreground-muted"
            >
              {a}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(i)}
                className="text-foreground-subtle transition-colors hover:text-destructive disabled:cursor-not-allowed"
                aria-label={`Remove "${a}"`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={text}
        disabled={disabled}
        placeholder="Type an example snippet…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="text-xs text-foreground-subtle">
        Press Enter or comma to add each example. Each snippet is matched on its own;
        the email joins this category if any one of them is a strong match.
      </p>
    </div>
  );
}

export const ScopePanel = forwardRef<
  CommitHandle,
  {
    onAuthError: (e: ApiError) => void;
    // In the wizard the footer Save/Reset is hidden and the wizard's Next calls
    // commit() instead. In the dashboard (default) the buttons render as usual.
    embedded?: boolean;
  }
>(function ScopePanel({ onAuthError, embedded = false }, ref) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api.scope();
      setScope(s);
      setDraft(toDraft(s));
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

  function setAnchors(name: string, next: string[]) {
    setDraft((d) => (d ? { ...d, anchors: { ...d.anchors, [name]: next } } : d));
    setSaved(false);
  }

  async function commit() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const update: ScopeUpdate = { buckets: {} };
      for (const [name, anchors] of Object.entries(draft.anchors)) {
        update.buckets![name] = { anchors };
      }
      const next = await api.updateScope(update);
      setScope(next);
      setDraft(toDraft(next));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
      } else {
        setError(e instanceof Error ? e.message : "Failed to save scope.");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Filter className="h-4 w-4 text-accent" />
          Email scope
        </CardTitle>
        <CardDescription>
          Every incoming email is matched against the example snippets below and sorted
          into one of four categories. Only{" "}
          <strong>In scope</strong>{" "}
          email feeds the project brain — the other three are kept out. Tune the
          examples to teach Indigo Iota what your engagement&apos;s mail looks
          like.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : draft && scope ? (
          <>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-4">
              {scope.editable_buckets.map((name) => {
                const meta =
                  BUCKET_META[name] ??
                  {
                    label: name,
                    included: name === scope.include_bucket,
                    blurb: "",
                  };
                return (
                  <div
                    key={name}
                    className="space-y-3 rounded-lg border border-border/60 bg-background-soft/20 p-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-accent">
                          {meta.label}
                        </span>
                        <Badge variant={meta.included ? "success" : "destructive"}>
                          {meta.included ? "Included" : "Excluded"}
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground-muted">
                        {meta.blurb}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Example snippets</Label>
                      <AnchorEditor
                        anchors={draft.anchors[name] ?? []}
                        disabled={saving}
                        onChange={(next) => setAnchors(name, next)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {!embedded && (
              <div className="flex items-center gap-2 border-t border-border/40 pt-3">
                <Button disabled={saving} onClick={save}>
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save scope"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => scope && setDraft(toDraft(scope))}
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
          <p className="text-destructive">{error ?? "Could not load scope."}</p>
        )}
      </CardContent>
    </Card>
  );
});
