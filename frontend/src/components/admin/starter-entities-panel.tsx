"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Plus, CheckCircle2, Pencil, Trash2, X, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  api,
  ApiError,
  type Ontology,
  type StarterEntity,
} from "@/lib/api";

// Matches the look of the shared <Input> for native <select> elements.
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-sm " +
  "text-foreground transition-colors focus-visible:outline-none focus-visible:border-accent " +
  "focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50";

export function StarterEntitiesPanel({
  onAuthError,
  ontologyVersion = 0,
}: {
  onAuthError: (e: ApiError) => void;
  // Bumped by the parent when the ontology is saved, so we re-read the entity
  // types and a freshly added type becomes pickable here right away.
  ontologyVersion?: number;
}) {
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [starters, setStarters] = useState<StarterEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The add-one form.
  const [entityType, setEntityType] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [isPrincipal, setIsPrincipal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // The edit-one-in-place form. editPath = the anchor currently being edited
  // (its page_path), or null when nothing is being edited.
  const [editPath, setEditPath] = useState<string | null>(null);
  const [eType, setEType] = useState("");
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [ePrincipal, setEPrincipal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [o, s] = await Promise.all([
        api.ontology(),
        api.starterEntities(),
      ]);
      setOntology(o);
      setStarters(s.starters);
      // Default the type picker to the first entity type if not chosen yet.
      setEntityType((cur) => cur || o.entity_types[0]?.key || "");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(
        e instanceof Error ? e.message : "Failed to load starter entities.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-read the ontology when the parent signals the Ontology panel saved, so a
  // freshly added entity type shows up in the Type picker without a reload.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ontologyVersion]);

  async function add() {
    const trimmed = name.trim();
    if (!entityType || !trimmed) return;
    setAdding(true);
    setError(null);
    setJustAdded(null);
    try {
      const next = await api.addStarterEntity(
        entityType,
        trimmed,
        description.trim() || undefined,
        { is_principal: isPrincipal, email: email.trim() || undefined },
      );
      setStarters(next.starters);
      setJustAdded(trimmed);
      // Clear name + description + email + principal so the next anchor is quick
      // to type; keep the type selected since onboarding usually adds a run of
      // the same kind.
      setName("");
      setDescription("");
      setEmail("");
      setIsPrincipal(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(
        e instanceof Error ? e.message : "Failed to add the starter entity.",
      );
    } finally {
      setAdding(false);
    }
  }

  function startEdit(s: StarterEntity) {
    setEditPath(s.page_path);
    setEType(s.entity_type);
    setEName(s.name);
    setEDesc(s.description || "");
    setEEmail(s.email || "");
    setEPrincipal(s.is_principal);
    setError(null);
    setJustAdded(null);
  }

  function cancelEdit() {
    setEditPath(null);
  }

  async function saveEdit() {
    if (!editPath || !eType || !eName.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      const next = await api.updateStarterEntity(
        editPath,
        eType,
        eName.trim(),
        eDesc.trim() || undefined,
        { is_principal: ePrincipal, email: eEmail.trim() || undefined },
      );
      setStarters(next.starters);
      setEditPath(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to save the change.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(s: StarterEntity) {
    if (removingPath) return;
    if (
      !window.confirm(
        `Remove "${s.name}" from your starter entities? This deletes its brain page.`,
      )
    )
      return;
    setRemovingPath(s.page_path);
    setError(null);
    try {
      const next = await api.removeStarterEntity(s.page_path);
      setStarters(next.starters);
      if (editPath === s.page_path) setEditPath(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to remove the entity.");
    } finally {
      setRemovingPath(null);
    }
  }

  // key -> human label, for showing the type on each placed anchor.
  const typeLabel = (key: string) =>
    ontology?.entity_types.find((t) => t.key === key)?.label || key;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          Starter entities
        </CardTitle>
        <CardDescription>
          The things you already know — your company, key people, key projects.
          Add them here so Indigo Iota has a page for each one before it reads a
          single email. When those names later turn up in your mail, what it
          learns attaches to the page you created instead of starting a new,
          near-duplicate one. Best done at onboarding, before any email is read.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : ontology ? (
          <>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            {ontology.entity_types.length === 0 ? (
              <p className="text-foreground-muted">
                Define at least one entity type in the ontology above before
                adding starter entities.
              </p>
            ) : (
              <>
                {/* ---- Add one ---- */}
                <section className="space-y-3 rounded-lg border border-border/60 bg-background-soft/20 p-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_1fr]">
                    <div className="space-y-1">
                      <Label className="text-xs">Type</Label>
                      <select
                        className={SELECT_CLASS}
                        value={entityType}
                        disabled={adding}
                        onChange={(e) => setEntityType(e.target.value)}
                      >
                        {ontology.entity_types.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={name}
                        disabled={adding}
                        placeholder="Acme GmbH"
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") add();
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">
                        One-line description (optional)
                      </Label>
                      <Input
                        value={description}
                        disabled={adding}
                        placeholder="Our company — the workspace this brain belongs to."
                        onChange={(e) => setDescription(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") add();
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Email (optional)</Label>
                      <Input
                        value={email}
                        disabled={adding}
                        placeholder="name@company.com"
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") add();
                        }}
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-foreground-muted">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-accent"
                      checked={isPrincipal}
                      disabled={adding}
                      onChange={(e) => setIsPrincipal(e.target.checked)}
                    />
                    <span>
                      <strong className="text-foreground">
                        This is the workspace&apos;s center of gravity
                      </strong>{" "}
                      — the company (your customer) or person everything in the
                      brain should relate to. Only one entity can hold this;
                      setting it moves it here.
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={adding || !name.trim()}
                      onClick={add}
                    >
                      <Plus className="h-4 w-4" />
                      {adding ? "Adding…" : "Add entity"}
                    </Button>
                    {justAdded && (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        Added{" "}
                        <strong>{justAdded}</strong>
                      </span>
                    )}
                  </div>
                </section>

                {/* ---- Placed anchors ---- */}
                <section className="space-y-2">
                  <h3 className="text-xs text-accent">
                    Placed ({starters.length})
                  </h3>
                  {starters.length === 0 ? (
                    <p className="text-xs text-foreground-subtle">
                      Nothing placed yet. Add your company and the people you
                      already know above.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-background-soft/20">
                      {starters.map((s) =>
                        editPath === s.page_path ? (
                          <li key={s.page_path} className="space-y-3 px-4 py-3">
                            <p className="text-xs font-medium text-foreground">
                              Editing <span className="text-accent">{s.name}</span>
                            </p>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_1fr]">
                              <div className="space-y-1">
                                <Label className="text-xs">Type</Label>
                                <select
                                  className={SELECT_CLASS}
                                  value={eType}
                                  disabled={savingEdit}
                                  onChange={(e) => setEType(e.target.value)}
                                >
                                  {ontology.entity_types.map((t) => (
                                    <option key={t.key} value={t.key}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Name</Label>
                                <Input
                                  value={eName}
                                  disabled={savingEdit}
                                  onChange={(e) => setEName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEdit();
                                  }}
                                />
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label className="text-xs">
                                  One-line description (optional)
                                </Label>
                                <Input
                                  value={eDesc}
                                  disabled={savingEdit}
                                  onChange={(e) => setEDesc(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEdit();
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Email (optional)</Label>
                                <Input
                                  value={eEmail}
                                  disabled={savingEdit}
                                  onChange={(e) => setEEmail(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveEdit();
                                  }}
                                />
                              </div>
                            </div>
                            <label className="flex items-start gap-2 text-xs text-foreground-muted">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 accent-accent"
                                checked={ePrincipal}
                                disabled={savingEdit}
                                onChange={(e) => setEPrincipal(e.target.checked)}
                              />
                              <span>
                                <strong className="text-foreground">
                                  This is the workspace&apos;s center of gravity
                                </strong>{" "}
                                — only one entity can hold this; setting it moves it
                                here.
                              </span>
                            </label>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={savingEdit || !eName.trim()}
                                onClick={saveEdit}
                              >
                                {savingEdit ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                {savingEdit ? "Saving…" : "Save changes"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={savingEdit}
                                onClick={cancelEdit}
                              >
                                <X className="h-3.5 w-3.5" />
                                Cancel
                              </Button>
                            </div>
                          </li>
                        ) : (
                          <li
                            key={s.page_path}
                            className="flex items-start justify-between gap-3 px-4 py-2.5"
                          >
                            <div className="flex min-w-0 items-baseline gap-3">
                              <span className="shrink-0 rounded bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                                {typeLabel(s.entity_type)}
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">
                                    {s.name}
                                  </span>
                                  {s.is_principal && (
                                    <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">
                                      principal
                                    </span>
                                  )}
                                  {s.email && (
                                    <span className="truncate text-[11px] text-foreground-subtle">
                                      {s.email}
                                    </span>
                                  )}
                                </span>
                                {s.description && (
                                  <span className="block text-xs text-foreground-muted">
                                    {s.description}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!removingPath || savingEdit}
                                onClick={() => startEdit(s)}
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={removingPath === s.page_path}
                                onClick={() => remove(s)}
                                title="Remove"
                                aria-label={`Remove ${s.name}`}
                              >
                                {removingPath === s.page_path ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                )}
                              </Button>
                            </div>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        ) : (
          <p className="text-destructive">
            {error ?? "Could not load starter entities."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
