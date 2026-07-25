"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Boxes, ChevronRight, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { entityTypeLabel } from "@/components/ask/brain-page-detail";
import type { BrainPage } from "@/lib/api";

// The Pages tab: every brain page the workspace holds, grouped by entity type,
// with a search box (so it stays usable as the brain grows). Each type section
// is a fixed-height card that scrolls internally. Clicking a card opens the full
// page detail (the same panel a graph node click opens). Presentational — the
// parent owns the fetch so the data is shared with the graph node-detail lookup.
export function PagesTab({
  pages,
  loading,
  error,
  onReload,
  onOpen,
}: {
  pages: BrainPage[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onOpen: (page: BrainPage) => void;
}) {
  const [query, setQuery] = useState("");

  // Filter by name + description, then group by type (types sorted by count).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = (pages ?? []).filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.data.description ?? "").toLowerCase().includes(q)
      );
    });
    const by: Record<string, BrainPage[]> = {};
    for (const p of matched) (by[p.entity_type] ??= []).push(p);
    for (const list of Object.values(by)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Object.entries(by).sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  }, [pages, query]);

  if (loading) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <span className="text-sm">Loading brain pages…</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <Boxes className="h-7 w-7 text-foreground-subtle" />
          <p className="text-sm font-medium text-foreground">No brain pages yet</p>
          <p className="text-xs leading-relaxed text-foreground-muted">
            Once mail has been ingested and processed, every person, company, and
            project it mentions gets a page here.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages by name or description…"
          className="h-10 w-full rounded-lg border border-border bg-background-soft/40 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-subtle focus:border-border-strong focus:outline-none"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-foreground-subtle">
          No pages match “{query}”.
        </p>
      ) : (
        groups.map(([type, list]) => (
          <section key={type}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {entityTypeLabel(type)}
              </h2>
              <Badge variant="outline" className="text-[10px]">
                {list.length}
              </Badge>
            </div>
            {/* Fixed-height section: cards scroll within it as the type grows. */}
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border/40 bg-background-soft/20 p-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((page) => (
                  <button
                    key={page.page_path}
                    type="button"
                    onClick={() => onOpen(page)}
                    className="group flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-background-soft/40 px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-background-soft/80"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {page.name}
                      </p>
                      {page.data.description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground-muted">
                          {page.data.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
