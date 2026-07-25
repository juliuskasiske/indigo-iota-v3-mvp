"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Search,
  Download,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type DbDatabase,
  type DbTable,
  type DbRows,
} from "@/lib/api";

const PAGE_SIZE = 50;

type SortDir = "asc" | "desc";

/**
 * Read-only browser over every database the owner can see — the control plane
 * and each tenant's brain DB. Pick a database, pick a table, page through its
 * rows. Sort by any column and filter across columns (both server-side, so they
 * span the whole table, not just the page), and download the current view as
 * CSV or XLSX. Secret columns come back masked from the server.
 */
export function DbBrowserPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [databases, setDatabases] = useState<DbDatabase[] | null>(null);
  const [dbKey, setDbKey] = useState<string>("control");
  const [tables, setTables] = useState<DbTable[] | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [data, setData] = useState<DbRows | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  // Server-side sort + filter (apply across the whole table).
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("");

  function handleAuth(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    return false;
  }

  // Databases — once.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.platform.databases();
        setDatabases(res.databases);
      } catch (e) {
        if (handleAuth(e)) return;
        setError(e instanceof Error ? e.message : "Failed to load databases.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tables — whenever the selected database changes. Reset sort/filter/table.
  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    setError(null);
    setTable(null);
    setData(null);
    setSortCol(null);
    setSortDir("asc");
    setFilter("");
    try {
      const res = await api.platform.tables(dbKey);
      setTables(res.tables);
    } catch (e) {
      if (handleAuth(e)) return;
      setTables(null);
      setError(e instanceof Error ? e.message : "Failed to load tables.");
    } finally {
      setLoadingTables(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKey]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const loadRows = useCallback(
    async (name: string, off: number) => {
      setLoadingRows(true);
      setError(null);
      try {
        const res = await api.platform.rows(dbKey, name, PAGE_SIZE, off, {
          sort: sortCol ?? undefined,
          dir: sortDir,
          q: filter.trim() || undefined,
        });
        setData(res);
        setOffset(off);
      } catch (e) {
        if (handleAuth(e)) return;
        setError(e instanceof Error ? e.message : "Failed to load rows.");
      } finally {
        setLoadingRows(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbKey, sortCol, sortDir, filter],
  );

  // Re-query (from page 0) when the sort or filter changes — filter debounced so
  // typing doesn't fire a request per keystroke. Table selection loads directly.
  useEffect(() => {
    if (!table) return;
    const id = setTimeout(() => loadRows(table, 0), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortCol, sortDir, filter]);

  function selectTable(name: string) {
    setTable(name);
    setSortCol(null);
    setSortDir("asc");
    setFilter("");
    loadRows(name, 0);
  }

  function toggleSort(col: string) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function download(format: "csv" | "xlsx") {
    if (!table) return;
    const url = api.platform.dbExportUrl(dbKey, table, format, {
      sort: sortCol ?? undefined,
      dir: sortDir,
      q: filter.trim() || undefined,
    });
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const activeDb = databases?.find((d) => d.key === dbKey);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-accent" />
              Database browser
            </CardTitle>
            <CardDescription>
              Read-only look at every table — the control plane and each
              tenant&apos;s brain. Sort, filter, and download for analytics.
              Secret columns are masked.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dbKey}
              onChange={(e) => setDbKey(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              {(databases ?? []).map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadTables}
              title="Reload tables"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {activeDb && (
          <p className="text-[11px] text-foreground-subtle">
            <Badge variant={activeDb.kind === "control" ? "primary" : "accent"}>
              {activeDb.kind}
            </Badge>{" "}
            <span className="font-mono">{activeDb.db_name}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {error && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          {/* Table list */}
          <div className="space-y-1.5">
            <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
              Tables
            </p>
            {loadingTables ? (
              <p className="px-1 text-xs text-foreground-subtle">Loading…</p>
            ) : tables && tables.length > 0 ? (
              <ul className="space-y-0.5">
                {tables.map((t) => (
                  <li key={t.name}>
                    <button
                      type="button"
                      onClick={() => selectTable(t.name)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        table === t.name
                          ? "bg-accent/10 text-accent"
                          : "text-foreground-muted hover:bg-background-soft/50",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <TableIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        <span className="truncate font-mono">{t.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground-subtle">
                        {t.row_count.toLocaleString("en-US")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 text-xs text-foreground-subtle">No tables.</p>
            )}
          </div>

          {/* Row viewer */}
          <div className="min-w-0">
            {!table ? (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-foreground-subtle">
                Pick a table to see its rows.
              </div>
            ) : (
              <RowsView
                data={data}
                loading={loadingRows}
                sortCol={sortCol}
                sortDir={sortDir}
                filter={filter}
                onSort={toggleSort}
                onFilter={setFilter}
                onDownload={download}
                onPrev={() => loadRows(table, Math.max(0, offset - PAGE_SIZE))}
                onNext={() => loadRows(table, offset + PAGE_SIZE)}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RowsView({
  data,
  loading,
  sortCol,
  sortDir,
  filter,
  onSort,
  onFilter,
  onDownload,
  onPrev,
  onNext,
}: {
  data: DbRows | null;
  loading: boolean;
  sortCol: string | null;
  sortDir: SortDir;
  filter: string;
  onSort: (col: string) => void;
  onFilter: (value: string) => void;
  onDownload: (format: "csv" | "xlsx") => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-2">
      {/* Controls: filter + downloads */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            placeholder="Filter rows…"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-foreground-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onDownload("csv")}
            disabled={!data}
            title="Download the current view as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onDownload("xlsx")}
            disabled={!data}
            title="Download the current view as XLSX"
          >
            <Download className="h-3.5 w-3.5" />
            XLSX
          </Button>
        </div>
      </div>

      {!data ? (
        <p className="px-1 text-xs text-foreground-subtle">Loading…</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-foreground">{data.table}</span>
            <span className="text-[11px] text-foreground-subtle">
              {(data.total === 0 ? 0 : data.offset + 1).toLocaleString("en-US")}–
              {Math.min(data.offset + data.rows.length, data.total).toLocaleString(
                "en-US",
              )}{" "}
              of {data.total.toLocaleString("en-US")}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-background-soft/40">
                <tr>
                  {data.columns.map((c) => {
                    const active = sortCol === c.name;
                    return (
                      <th
                        key={c.name}
                        className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium text-foreground"
                        title={c.type}
                      >
                        <button
                          type="button"
                          onClick={() => onSort(c.name)}
                          className="inline-flex items-center gap-1 hover:text-accent"
                        >
                          {c.name}
                          {active &&
                            (sortDir === "asc" ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            ))}
                        </button>
                        {c.masked && (
                          <span className="ml-1 text-[10px] text-foreground-subtle">
                            (masked)
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, data.columns.length)}
                      className="px-3 py-6 text-center text-foreground-subtle"
                    >
                      No rows.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-border/40 last:border-0 hover:bg-background-soft/30"
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="max-w-xs truncate px-3 py-1.5 align-top font-mono text-foreground-muted"
                          title={cellTitle(cell)}
                        >
                          {renderCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={data.offset <= 0 || loading}
              onClick={onPrev}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={data.offset + data.limit >= data.total || loading}
              onClick={onNext}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function renderCell(cell: unknown): React.ReactNode {
  if (cell === null) {
    return <span className="italic text-foreground-subtle">null</span>;
  }
  if (typeof cell === "object") {
    return JSON.stringify(cell);
  }
  return String(cell);
}

function cellTitle(cell: unknown): string {
  if (cell === null) return "null";
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}
