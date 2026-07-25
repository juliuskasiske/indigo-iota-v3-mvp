"use client";

import { Badge } from "@/components/ui/badge";
import type { BrainPage } from "@/lib/api";

// Display labels for the default ontology's entity types; unknown types fall
// back to a humanized version of the raw key.
export const ENTITY_TYPE_LABEL: Record<string, string> = {
  person: "Person",
  company: "Company",
  project: "Project",
  workstream: "Workstream",
  deliverable: "Deliverable",
  task: "Task",
  milestone: "Milestone",
  objective: "Objective",
  decision: "Decision",
  risk: "Risk",
  todo: "To-do",
};

export function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABEL[type] ?? humanize(type);
}

// Frontmatter keys that are structural (already shown as title/badge) or
// internal — never rendered in the key/value table.
const HIDDEN_FRONTMATTER = new Set(["type", "name", "seeded"]);

function renderValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => String(v)).join(", ") : "—";
  }
  return String(value);
}

// Renders one brain page in full — title, type badge, description, the
// structured frontmatter fields, the dated timeline, and outgoing
// relationships. Presentational only; the caller decides where it lives
// (a slide-over Sheet on node click, or inline in the Pages tab).
export function BrainPageDetail({ page }: { page: BrainPage }) {
  const frontmatter = page.data.frontmatter ?? {};
  const fields = Object.entries(frontmatter).filter(
    ([k]) => !HIDDEN_FRONTMATTER.has(k),
  );
  const timeline = page.data.timeline ?? [];
  const relationships = page.data.relationships ?? [];

  return (
    <div className="space-y-7 p-6">
      <div>
        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {page.name}
        </h2>
        <Badge variant="primary" className="mt-2.5 uppercase tracking-wide">
          {entityTypeLabel(page.entity_type)}
        </Badge>
      </div>

      {page.data.description && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
          {page.data.description}
        </p>
      )}

      {fields.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.18em] text-foreground-subtle">
            Frontmatter
          </h3>
          <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
            {fields.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-foreground-subtle">{humanize(key)}</dt>
                <dd className="break-words text-foreground">{renderValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {timeline.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.18em] text-foreground-subtle">
            Timeline
          </h3>
          <ol className="relative space-y-5 border-l border-border pl-5">
            {timeline.map((entry, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full border border-accent bg-background" />
                <p className="text-xs font-medium text-foreground">{entry.date}</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
                  {entry.entry}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {relationships.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-mono uppercase tracking-[0.18em] text-foreground-subtle">
            Relationships
          </h3>
          <ul className="space-y-1.5 text-sm">
            {relationships.map((rel, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2">
                <span className="text-foreground-subtle">{humanize(rel.predicate)}</span>
                <span className="text-foreground-subtle">→</span>
                <span className="font-medium text-foreground">{rel.object}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
