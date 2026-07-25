"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  Boxes,
  Save,
  RotateCcw,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronRight,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { api, ApiError, type Ontology } from "@/lib/api";
import type { CommitHandle } from "@/components/admin/commit-handle";

// Matches the look of the shared <Input> for native <select> elements.
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-sm " +
  "text-foreground transition-colors focus-visible:outline-none focus-visible:border-accent " +
  "focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50";

// Turn a human label into a stable machine key ("Email address" -> "email_address").
// The customer never sees or types these — they're derived on save and frozen
// once an entity exists, so renaming a label later can't break stored data.
function slugify(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Frontend-only draft shapes. `key`/`field_key` carry the server's machine key
// for things that already exist ("" for new ones, derived on save). `cid` is a
// throwaway client id so relationships can point at an entity even before it
// has a saved key.
interface DraftField {
  field_key: string;
  label: string;
  description: string;
  is_list: boolean;
}
interface DraftEntity {
  cid: string;
  key: string;
  label: string;
  description: string;
  page_folder: string; // carried (hidden) so an existing folder is never reshuffled
  fields: DraftField[];
}
interface DraftRel {
  cid: string;
  key: string;
  label: string;
  description: string;
  subjectCid: string | null;
  objectCid: string | null;
}
interface Draft {
  entities: DraftEntity[];
  rels: DraftRel[];
}

function toDraft(o: Ontology): Draft {
  const entities: DraftEntity[] = o.entity_types.map((t) => ({
    cid: crypto.randomUUID(),
    key: t.key,
    label: t.label,
    description: t.description,
    page_folder: t.page_folder ?? "",
    fields: t.fields.map((f) => ({
      field_key: f.field_key,
      label: f.label,
      description: f.description,
      is_list: f.is_list,
    })),
  }));
  const keyToCid = new Map<string, string>();
  for (const e of entities) if (e.key) keyToCid.set(e.key, e.cid);
  const rels: DraftRel[] = o.relationship_types.map((r) => ({
    cid: crypto.randomUUID(),
    key: r.key,
    label: r.label,
    description: r.description,
    subjectCid: r.subject_type ? keyToCid.get(r.subject_type) ?? null : null,
    objectCid: r.object_type ? keyToCid.get(r.object_type) ?? null : null,
  }));
  return { entities, rels };
}

const blankField = (): DraftField => ({
  field_key: "",
  label: "",
  description: "",
  is_list: false,
});
const blankEntity = (): DraftEntity => ({
  cid: crypto.randomUUID(),
  key: "",
  label: "",
  description: "",
  page_folder: "", // new entity: server derives a folder from the key
  fields: [],
});
const blankRel = (): DraftRel => ({
  cid: crypto.randomUUID(),
  key: "",
  label: "",
  description: "",
  subjectCid: null,
  objectCid: null,
});

export const OntologyPanel = forwardRef<
  CommitHandle,
  {
    onAuthError: (e: ApiError) => void;
    // Called after the ontology is successfully saved, so sibling panels (e.g.
    // starter entities) can re-read the new entity types.
    onSaved?: () => void;
    // Wizard hides the Save/Reset footer and drives commit() from Next.
    embedded?: boolean;
  }
>(function OntologyPanel({ onAuthError, onSaved, embedded = false }, ref) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [server, setServer] = useState<Ontology | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Which entity cards are expanded (by cid). Collapsed by default so the
  // section stays short; you open the one you want to edit.
  const [openEntities, setOpenEntities] = useState<Set<string>>(new Set());

  const [openRels, setOpenRels] = useState<Set<string>>(new Set());

  const toggleEntity = (cid: string) =>
    setOpenEntities((s) => {
      const n = new Set(s);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });

  const toggleRel = (cid: string) =>
    setOpenRels((s) => {
      const n = new Set(s);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });

  async function load() {
    setError(null);
    try {
      const o = await api.ontology();
      setServer(o);
      setDraft(toDraft(o));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load the ontology.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mutate(fn: (d: Draft) => Draft) {
    setDraft((d) => (d ? fn(structuredClone(d)) : d));
    setSaved(false);
  }

  // --- entity mutations ---
  const setEntity = (i: number, patch: Partial<DraftEntity>) =>
    mutate((d) => {
      d.entities[i] = { ...d.entities[i], ...patch };
      return d;
    });
  const addEntity = () => {
    const e = blankEntity();
    mutate((d) => {
      d.entities.push(e);
      return d;
    });
    // Open the new card right away so it can be filled in.
    setOpenEntities((s) => new Set(s).add(e.cid));
  };
  const removeEntity = (i: number) =>
    mutate((d) => {
      const cid = d.entities[i]?.cid;
      d.entities.splice(i, 1);
      // A removed entity can no longer sit at either end of a relationship.
      for (const r of d.rels) {
        if (r.subjectCid === cid) r.subjectCid = null;
        if (r.objectCid === cid) r.objectCid = null;
      }
      return d;
    });

  // --- field mutations ---
  const setField = (ei: number, fi: number, patch: Partial<DraftField>) =>
    mutate((d) => {
      d.entities[ei].fields[fi] = { ...d.entities[ei].fields[fi], ...patch };
      return d;
    });
  const addField = (ei: number) =>
    mutate((d) => {
      d.entities[ei].fields.push(blankField());
      return d;
    });
  const removeField = (ei: number, fi: number) =>
    mutate((d) => {
      d.entities[ei].fields.splice(fi, 1);
      return d;
    });

  // --- relationship mutations ---
  const setRel = (i: number, patch: Partial<DraftRel>) =>
    mutate((d) => {
      d.rels[i] = { ...d.rels[i], ...patch };
      return d;
    });
  const addRel = () => {
    const r = blankRel();
    mutate((d) => {
      d.rels.push(r);
      return d;
    });
    setOpenRels((s) => new Set(s).add(r.cid));
  };
  const removeRel = (i: number) =>
    mutate((d) => {
      d.rels.splice(i, 1);
      return d;
    });

  async function commit() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Existing things keep their saved key; new things get one from the label.
      const effKey = (e: DraftEntity) => e.key || slugify(e.label);
      const cidToKey = new Map<string, string>();
      for (const e of draft.entities) cidToKey.set(e.cid, effKey(e));

      const next = await api.updateOntology({
        entity_types: draft.entities.map((e) => ({
          key: effKey(e),
          label: e.label,
          description: e.description,
          // Keep an existing entity's folder; only a brand-new one (no folder
          // yet) falls through to the server's key-based default.
          page_folder: e.page_folder || null,
          fields: e.fields.map((f) => ({
            field_key: f.field_key || slugify(f.label),
            label: f.label,
            description: f.description,
            is_list: f.is_list,
          })),
        })),
        relationship_types: draft.rels.map((r) => ({
          key: r.key || slugify(r.label),
          label: r.label,
          description: r.description,
          subject_type: r.subjectCid ? cidToKey.get(r.subjectCid) ?? null : null,
          object_type: r.objectCid ? cidToKey.get(r.objectCid) ?? null : null,
        })),
      });
      setServer(next);
      setDraft(toDraft(next));
      setSaved(true);
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
      } else {
        setError(e instanceof Error ? e.message : "Failed to save the ontology.");
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
          <Boxes className="h-4 w-4 text-accent" />
          Brain ontology
        </CardTitle>
        <CardDescription>
          Your brain&apos;s vocabulary — what Indigo Iota looks for in your mail
          and keeps.{" "}
          <strong>Entities</strong>{" "}
          are the things it tracks (people, companies, projects); each one gets
          its own page in the brain.{" "}
          <strong>Relationships</strong>{" "}
          are how those things connect (who works at a company, which project
          belongs to a client). Indigo Iota reads the descriptions you write here
          to decide what to pull out of every email, so describe each one the way
          you&apos;d brief a new analyst. Best set during onboarding, before any
          email is read.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : draft ? (
          <>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            {/* ---- Entities ---- */}
            <section className="space-y-3">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-[0.18em] text-accent">
                  Entities
                </h3>
                <p className="mt-1 text-xs text-foreground-muted">
                  The things worth their own page. Name each one and describe
                  what counts, so Indigo Iota recognises it when it appears.
                </p>
              </div>
              {draft.entities.map((t, ti) => {
                const open = openEntities.has(t.cid);
                return (
                <div
                  key={t.cid}
                  className="rounded-lg border border-border/60 bg-background-soft/20"
                >
                  {/* Collapsed header: name + fact count, with expand + remove. */}
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => toggleEntity(t.cid)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={open}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
                          open && "rotate-90",
                        )}
                      />
                      <span className="truncate font-medium text-foreground">
                        {t.label.trim() || "(unnamed entity)"}
                      </span>
                      {!open && t.fields.length > 0 && (
                        <span className="shrink-0 text-xs text-foreground-subtle">
                          · {t.fields.length}{" "}
                          {t.fields.length === 1 ? "fact" : "facts"}
                        </span>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={saving}
                      onClick={() => removeEntity(ti)}
                      title="Remove entity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {open && (
                  <div className="space-y-3 border-t border-border/40 p-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={t.label}
                        disabled={saving}
                        placeholder="Person"
                        onChange={(e) => setEntity(ti, { label: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      What is it? (this is what Indigo Iota looks for)
                    </Label>
                    <Input
                      value={t.description}
                      disabled={saving}
                      placeholder="An individual person named in our communications — a contact, colleague, or client-side stakeholder."
                      onChange={(e) =>
                        setEntity(ti, { description: e.target.value })
                      }
                    />
                  </div>

                  {/* fields */}
                  <div className="space-y-2 rounded-md border border-border/40 bg-background/40 p-3">
                    <div>
                      <Label className="text-xs text-foreground-muted">
                        Facts to remember
                      </Label>
                      <p className="mt-1 text-xs text-foreground-subtle">
                        Details Indigo Iota saves on this entity&apos;s page as it
                        reads your mail — e.g. a person&apos;s role or email.
                        Add only what&apos;s worth keeping; leave empty to track
                        it by name alone.
                      </p>
                    </div>
                    {t.fields.map((f, fi) => (
                      <div
                        key={fi}
                        className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto_auto]"
                      >
                        <Input
                          value={f.label}
                          disabled={saving}
                          placeholder="Role"
                          onChange={(e) =>
                            setField(ti, fi, { label: e.target.value })
                          }
                        />
                        <Input
                          value={f.description}
                          disabled={saving}
                          placeholder="What to capture, e.g. their job title if stated."
                          onChange={(e) =>
                            setField(ti, fi, { description: e.target.value })
                          }
                        />
                        <label
                          className="flex items-center gap-1.5 text-xs text-foreground-muted"
                          title="Tick if there can be more than one value (e.g. several phone numbers). Otherwise Indigo Iota keeps a single value."
                        >
                          <input
                            type="checkbox"
                            checked={f.is_list}
                            disabled={saving}
                            onChange={(e) =>
                              setField(ti, fi, { is_list: e.target.checked })
                            }
                          />
                          Can have several
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={saving}
                          onClick={() => removeField(ti, fi)}
                          title="Remove fact"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => addField(ti)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add fact
                    </Button>
                  </div>

                  </div>
                  )}
                </div>
                );
              })}
              <Button variant="outline" disabled={saving} onClick={addEntity}>
                <Plus className="h-4 w-4" />
                Add entity
              </Button>
            </section>

            {/* ---- Relationships ---- */}
            <section className="space-y-3">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-[0.18em] text-accent">
                  Relationships
                </h3>
                <p className="mt-1 text-xs text-foreground-muted">
                  Your <strong>preferred</strong> link types. The extractor reads
                  every email freely and can still discover new connections, but
                  it&rsquo;s steered to reuse these canonical names (so synonyms
                  collapse instead of fragmenting the graph). Name the link,
                  describe when it applies, and set the typical ends as a hint (or
                  leave them on &ldquo;Any&rdquo;).
                </p>
              </div>
              {draft.rels.map((r, ri) => {
                const open = openRels.has(r.cid);
                const endLabel = (cid: string | null) =>
                  cid
                    ? draft.entities.find((e) => e.cid === cid)?.label.trim() ||
                      "(unnamed)"
                    : "Any";
                return (
                <div
                  key={r.cid}
                  className="rounded-lg border border-border/60 bg-background-soft/20"
                >
                  {/* Collapsed header: name + from→to, with expand + remove. */}
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => toggleRel(r.cid)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={open}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
                          open && "rotate-90",
                        )}
                      />
                      <span className="truncate font-medium text-foreground">
                        {r.label.trim() || "(unnamed link)"}
                      </span>
                      {!open && (
                        <span className="shrink-0 text-xs text-foreground-subtle">
                          · {endLabel(r.subjectCid)} → {endLabel(r.objectCid)}
                        </span>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={saving}
                      onClick={() => removeRel(ri)}
                      title="Remove relationship"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {open && (
                  <div className="space-y-3 border-t border-border/40 p-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={r.label}
                      disabled={saving}
                      placeholder="Works at"
                      onChange={(e) => setRel(ri, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">When does this link apply?</Label>
                    <Input
                      value={r.description}
                      disabled={saving}
                      placeholder="The person is employed by the company."
                      onChange={(e) =>
                        setRel(ri, { description: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">From</Label>
                      <select
                        className={SELECT_CLASS}
                        value={r.subjectCid ?? ""}
                        disabled={saving}
                        onChange={(e) =>
                          setRel(ri, { subjectCid: e.target.value || null })
                        }
                      >
                        <option value="">Any entity</option>
                        {draft.entities.map((ent) => (
                          <option key={ent.cid} value={ent.cid}>
                            {ent.label.trim() || "(unnamed entity)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">To</Label>
                      <select
                        className={SELECT_CLASS}
                        value={r.objectCid ?? ""}
                        disabled={saving}
                        onChange={(e) =>
                          setRel(ri, { objectCid: e.target.value || null })
                        }
                      >
                        <option value="">Any entity</option>
                        {draft.entities.map((ent) => (
                          <option key={ent.cid} value={ent.cid}>
                            {ent.label.trim() || "(unnamed entity)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  </div>
                  )}
                </div>
                );
              })}
              <Button variant="outline" disabled={saving} onClick={addRel}>
                <Plus className="h-4 w-4" />
                Add relationship
              </Button>
            </section>

            {!embedded && (
              <div className="flex items-center gap-2 border-t border-border/40 pt-3">
                <Button disabled={saving} onClick={save}>
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save ontology"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => server && setDraft(toDraft(server))}
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
          <p className="text-destructive">
            {error ?? "Could not load the ontology."}
          </p>
        )}
      </CardContent>
    </Card>
  );
});
