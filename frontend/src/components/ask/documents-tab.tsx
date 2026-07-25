"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  FileText,
  Search,
  ChevronRight,
  ExternalLink,
  CircleCheck,
  Circle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, type DocumentFile } from "@/lib/api";

// The Documents tab: every Google Drive file the brain has captured, with its
// MarkItDown-converted Markdown (what the agents + retrieval actually read).
// A header lists the file paths + names so it's clear which files are accessible
// / comprehended; each row expands to show the full Markdown. Documents live
// only as chunks (never graph nodes), so this reads the captured events directly.
export function DocumentsTab({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [docs, setDocs] = useState<DocumentFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.documents();
      setDocs(res.documents);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onAuthError(e);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = docs ?? [];
    if (!q) return list;
    return list.filter(
      (d) =>
        d.filename.toLowerCase().includes(q) ||
        (d.path ?? "").toLowerCase().includes(q) ||
        d.markdown.toLowerCase().includes(q),
    );
  }, [docs, query]);

  const comprehendedCount = useMemo(
    () => (docs ?? []).filter((d) => d.comprehended).length,
    [docs],
  );

  if (loading) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-foreground-muted">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <span className="text-sm">Loading documents…</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  if (!docs || docs.length === 0) {
    return (
      <Card className="flex h-[480px] items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <FileText className="h-7 w-7 text-foreground-subtle" />
          <p className="text-sm font-medium text-foreground">No documents yet</p>
          <p className="text-xs leading-relaxed text-foreground-muted">
            Connect a Google Drive folder in Sources. Once it&rsquo;s scanned,
            every supported file is converted to Markdown and listed here —
            searchable straight away, whether or not it&rsquo;s been comprehended.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary: how many files are accessible / comprehended. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
        <Badge variant="outline">{docs.length} files</Badge>
        <span>
          {comprehendedCount} comprehended into the brain · {docs.length - comprehendedCount}{" "}
          searchable only
        </span>
      </div>

      {/* Search across filename, path, and Markdown body. */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents by name, path, or content…"
          className="h-10 w-full rounded-lg border border-border bg-background-soft/40 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-subtle focus:border-border-strong focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-foreground-subtle">
          No documents match “{query}”.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc) => {
            const open = openId === doc.file_id;
            return (
              <div
                key={doc.file_id}
                className="overflow-hidden rounded-lg border border-border/60 bg-background-soft/30"
              >
                {/* Header row: filename + path on top, expand toggle, Drive link. */}
                <div className="flex items-start gap-2 px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : doc.file_id)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                  >
                    <ChevronRight
                      className={cnChevron(open)}
                    />
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {doc.filename}
                      </span>
                      {doc.path && (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-foreground-subtle">
                          {doc.path}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {doc.comprehended ? (
                      <Badge variant="success" className="gap-1">
                        <CircleCheck className="h-3 w-3" />
                        Comprehended
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-foreground-subtle">
                        <Circle className="h-3 w-3" />
                        Searchable
                      </Badge>
                    )}
                    {doc.web_view_link && (
                      <a
                        href={doc.web_view_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Google Drive"
                        className="rounded-md p-1 text-foreground-subtle transition-colors hover:bg-background-soft hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Expanded: the converted Markdown the brain reads. */}
                {open && (
                  <div className="border-t border-border/50 bg-background/40 px-3.5 py-3">
                    {doc.markdown.trim() ? (
                      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground-muted">
                        {doc.markdown}
                      </pre>
                    ) : (
                      <p className="text-xs italic text-foreground-subtle">
                        No extracted text (the file may be empty, an image, or an
                        unsupported format).
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function cnChevron(open: boolean): string {
  return [
    "mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle transition-transform",
    open ? "rotate-90" : "",
  ].join(" ");
}
