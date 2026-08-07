"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  HardDrive,
  Mail,
  RefreshCw,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  type ObservabilityPage,
  type QuestionCostRow,
  type DeliverySyncRow,
  type RelationshipTrace,
  type RelSubjectTrace,
} from "@/lib/api";
import { DocumentCostPanel } from "@/components/admin/document-cost-panel";

const PAGE_SIZE = 50;

type SortDir = "asc" | "desc";

// Column header config. `sort` is the server-side sort key (omitted = not
// sortable, e.g. derived cost or the always-"in scope" triage).
const COLUMNS: { label: string; sort?: string; align?: "right" | "center" }[] = [
  { label: "Fetched", sort: "fetched" },
  { label: "Sender", sort: "sender" },
  { label: "Recipients" },
  { label: "Subject", sort: "subject" },
  { label: "Email text" },
  { label: "Triage", sort: "bucket" },
  { label: "Dup", sort: "duplicate_hits", align: "center" },
  { label: "Processed", sort: "processed" },
  { label: "Entities", sort: "entities", align: "right" },
  { label: "Rel.", sort: "relationships", align: "right" },
  { label: "In tok", sort: "in_tokens", align: "right" },
  { label: "Out tok", sort: "out_tokens", align: "right" },
  { label: "Model", sort: "model" },
  { label: "LLM calls", sort: "llm_calls", align: "right" },
  { label: "Cost", sort: "cost", align: "right" },
];

function fmtInt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtCost(cost: number | null, currency: string): string {
  if (cost == null) return "—";
  const sym = currency === "USD" ? "$" : `${currency} `;
  return `${sym}${cost.toFixed(cost < 0.01 ? 5 : 4)}`;
}

// Triage bucket → badge label + variant.
const BUCKET_META: Record<
  string,
  { label: string; variant: "success" | "destructive" | "warning" | "outline" }
> = {
  in_scope: { label: "in scope", variant: "success" },
  redzone: { label: "red zone", variant: "destructive" },
  spam: { label: "spam", variant: "warning" },
  out_of_scope: { label: "out of scope", variant: "outline" },
};

/**
 * Tenant observability, split by how data moves through the brain:
 *   • Ingress — one expander per source type (Microsoft 365 / IMAP mail and
 *     Google Drive documents), each opening to that source's per-item trace.
 *   • Egress — what's pulled back OUT of the brain: per-question Q&A cost (Ask)
 *     and the Delivery agenda-inference cost (with document drafting reserved).
 */
export function ObservabilityPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          Tenant observability
        </CardTitle>
        <CardDescription>
          Every LLM call this workspace runs — split into{" "}
          <strong>ingress</strong> (data read into the brain) and{" "}
          <strong>egress</strong> (the brain queried back out). Expand a source
          or surface to see its per-item token and cost trace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ingress">
          <TabsList>
            <TabsTrigger value="ingress" className="gap-1.5">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Ingress
            </TabsTrigger>
            <TabsTrigger value="egress" className="gap-1.5">
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              Egress
            </TabsTrigger>
          </TabsList>

          {/* INGRESS — one expander per source type from the Sources tab. */}
          <TabsContent value="ingress" className="mt-4 space-y-3">
            <Expander
              icon={<Mail className="h-4 w-4 text-accent" />}
              title="Microsoft 365"
              subtitle="Outlook / Exchange mail"
            >
              <EmailTraceTable provider="graph" onAuthError={onAuthError} />
            </Expander>
            <Expander
              icon={<Mail className="h-4 w-4 text-accent" />}
              title="IMAP"
              subtitle="Custom-domain mailboxes"
            >
              <EmailTraceTable provider="imap" onAuthError={onAuthError} />
            </Expander>
            <Expander
              icon={<HardDrive className="h-4 w-4 text-accent" />}
              title="Google Drive"
              subtitle="Comprehended documents"
            >
              <DocumentCostPanel onAuthError={onAuthError} embedded />
            </Expander>
          </TabsContent>

          {/* EGRESS — what's pulled back out of the brain. */}
          <TabsContent value="egress" className="mt-4 space-y-3">
            <Expander
              icon={<Sparkles className="h-4 w-4 text-accent" />}
              title="Ask"
              subtitle="Per-question Q&A cost"
            >
              <QuestionCostTable onAuthError={onAuthError} />
            </Expander>
            <Expander
              icon={<ClipboardCheck className="h-4 w-4 text-accent" />}
              title="Delivery"
              subtitle="Agenda inference & drafting"
            >
              <DeliverySyncTable onAuthError={onAuthError} />
            </Expander>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** A lazy, hand-rolled disclosure (no accordion primitive exists). Children are
 *  mounted on first open and kept mounted (hidden) so their fetch + paging state
 *  survives a collapse. */
function Expander({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setMounted(true);
        }}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-background-soft/40",
          open && "bg-background-soft/30",
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-2">
          {subtitle && (
            <span className="text-[11px] text-foreground-subtle">{subtitle}</span>
          )}
          <ChevronRight
            className={cn(
              "h-4 w-4 text-foreground-subtle transition-transform",
              open && "rotate-90",
            )}
          />
        </span>
      </button>
      {mounted && (
        <div className={cn("border-t border-border/60 p-3", !open && "hidden")}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Per-email trace for one mail source type (``provider`` = graph | imap): a
 * sortable, filterable, paged view of every mail the pipeline saw from that
 * source — capture, triage, dedupe, comprehension yield, token/call fan-out,
 * model, and derived LLM cost. Rows with a stored comprehend debug trace expand
 * to the RelationshipAgent decisions.
 */
function EmailTraceTable({
  provider,
  onAuthError,
}: {
  provider: string;
  onAuthError: (e: ApiError) => void;
}) {
  const [data, setData] = useState<ObservabilityPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string>("fetched");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [traces, setTraces] = useState<
    Record<number, RelationshipTrace | "loading" | { error: string }>
  >({});

  const toggleTrace = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (traces[id] && traces[id] !== "loading") return;
      setTraces((t) => ({ ...t, [id]: "loading" }));
      try {
        const res = await api.relationshipTrace(id);
        setTraces((t) => ({ ...t, [id]: res.trace }));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setTraces((t) => ({
          ...t,
          [id]: { error: e instanceof Error ? e.message : "Failed to load trace." },
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedId, traces],
  );

  const load = useCallback(
    async (off: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.observability(PAGE_SIZE, off, {
          sort: sortCol,
          dir: sortDir,
          q: filter.trim() || undefined,
          provider,
        });
        setData(res);
        setOffset(off);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load the trace.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortCol, sortDir, filter, provider],
  );

  // Initial load + reload (from page 0) whenever sort or filter changes; the
  // filter is debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => load(0), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortCol, sortDir, filter]);

  function toggleSort(col: string) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, total);

  return (
    <div className="text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by sender, subject, body, model…"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-foreground-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-foreground-subtle">
            {fmtInt(from)}–{fmtInt(to)} of {fmtInt(total)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => load(offset)} title="Reload">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {error}
        </p>
      )}

      {loading && !data ? (
        <div className="flex h-40 items-center justify-center text-foreground-subtle">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-foreground-subtle">
          {filter
            ? "No emails match the filter."
            : "No emails captured from this source yet."}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-background-soft/40">
                <tr>
                  <th className={cnTh()} aria-label="Expand" />
                  {COLUMNS.map((c) => {
                    const active = c.sort && sortCol === c.sort;
                    return (
                      <th key={c.label} className={cnTh(c.align)}>
                        {c.sort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.sort!)}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-accent",
                              active && "text-accent",
                            )}
                            title="Sort by this column"
                          >
                            {c.label}
                            {active ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )
                            ) : (
                              <ChevronsUpDown className="h-3 w-3 opacity-30" />
                            )}
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const recipients = r.recipients.join(", ");
                  const bucket =
                    BUCKET_META[r.triage_bucket] ?? {
                      label: r.triage_bucket,
                      variant: "outline" as const,
                    };
                  const isOpen = expandedId === r.id;
                  return (
                    <Fragment key={`${r.kind}-${r.id}`}>
                      <tr
                        className={cn(
                          "border-b border-border/40 hover:bg-background-soft/30",
                          isOpen && "bg-background-soft/30",
                        )}
                      >
                        <td className="px-2 py-1.5 align-middle">
                          {r.has_debug ? (
                            <button
                              type="button"
                              onClick={() => toggleTrace(r.id)}
                              className="rounded p-0.5 text-foreground-subtle hover:text-accent"
                              title={isOpen ? "Hide relationship trace" : "Show relationship trace"}
                              aria-expanded={isOpen}
                            >
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  isOpen && "rotate-90",
                                )}
                              />
                            </button>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-foreground-muted">
                          {fmtDateTime(r.fetched_at)}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-1.5 text-foreground-muted" title={r.sender ?? ""}>
                          {r.sender ?? "—"}
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-1.5 text-foreground-muted" title={recipients}>
                          {recipients || "—"}
                        </td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5 text-foreground" title={r.subject ?? ""}>
                          {r.subject || "—"}
                        </td>
                        <td
                          className="max-w-[22rem] truncate px-3 py-1.5 text-foreground-subtle"
                          title={r.body_text ?? ""}
                        >
                          {r.body_text ? r.body_text.replace(/\s+/g, " ").trim() : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge
                            variant={bucket.variant}
                            className="whitespace-nowrap text-[10px]"
                            title={r.triage_reason ?? undefined}
                          >
                            {bucket.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-center text-foreground-muted">
                          {r.duplicate_hits > 0 ? `${r.duplicate_hits}×` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-foreground-muted">
                          {r.processed_at ? (
                            fmtDateTime(r.processed_at)
                          ) : (
                            <span className="italic text-foreground-subtle">queued</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.entities)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.relationships)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.input_tokens)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.output_tokens)}</td>
                        <td className="max-w-[12rem] truncate px-3 py-1.5 font-mono text-foreground-muted" title={r.model ?? ""}>
                          {r.model ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.llm_calls)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground-muted">
                          {fmtCost(r.cost, r.currency)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-background-soft/20">
                          <td colSpan={COLUMNS.length + 1} className="px-3 py-3">
                            <TraceView state={traces[r.id]} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset <= 0 || loading}
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => load(offset + PAGE_SIZE)}
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

/** Egress · Ask — every question asked of the brain with its synthesis token
 *  usage + cost, newest first. */
function QuestionCostTable({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [rows, setRows] = useState<QuestionCostRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (off: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.observabilityQuestions(PAGE_SIZE, off);
        setRows(res.rows);
        setTotal(res.total);
        setCurrency(res.currency);
        setOffset(off);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load questions.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = rows ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + list.length, total);

  return (
    <div className="text-sm">
      <div className="mb-3 flex items-center justify-end gap-3">
        <span className="text-[11px] text-foreground-subtle">
          {fmtInt(from)}–{fmtInt(to)} of {fmtInt(total)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => load(offset)} title="Reload">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {error}
        </p>
      )}
      {loading && !rows ? (
        <div className="flex h-32 items-center justify-center text-foreground-subtle">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-foreground-subtle">
          No questions asked yet — Q&amp;A cost appears here once someone uses the
          Ask tab.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-background-soft/40">
                <tr>
                  <th className={cnTh()}>Asked</th>
                  <th className={cnTh()}>Question</th>
                  <th className={cnTh()}>Model</th>
                  <th className={cnTh("right")}>LLM calls</th>
                  <th className={cnTh("right")}>In tok</th>
                  <th className={cnTh("right")}>Out tok</th>
                  <th className={cnTh("right")}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {list.map((q) => (
                  <tr key={q.id} className="border-b border-border/40 hover:bg-background-soft/30">
                    <td className="whitespace-nowrap px-3 py-1.5 text-foreground-muted">
                      {fmtDateTime(q.created_at)}
                    </td>
                    <td className="max-w-[34rem] truncate px-3 py-1.5 text-foreground" title={q.question}>
                      {q.question}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5 font-mono text-foreground-muted" title={q.model ?? ""}>
                      {q.model ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(q.llm_calls)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(q.prompt_tokens)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(q.completion_tokens)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground-muted">
                      {fmtCost(q.cost, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset <= 0 || loading}
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => load(offset + PAGE_SIZE)}
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

/** Egress · Delivery — two request kinds: the DeliveryAgent *sync* (agenda
 *  inference) cost per pool refresh, and (reserved) document drafting & edits. */
function DeliverySyncTable({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [rows, setRows] = useState<DeliverySyncRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (off: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.observabilityDelivery(PAGE_SIZE, off);
        setRows(res.rows);
        setTotal(res.total);
        setOffset(off);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load delivery cost.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = rows ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + list.length, total);

  return (
    <div className="space-y-5 text-sm">
      {/* Request type 1: agenda inference (the periodic / on-demand pool sync). */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-foreground-subtle">
            Sync · agenda inference
          </p>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-foreground-subtle">
              {fmtInt(from)}–{fmtInt(to)} of {fmtInt(total)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => load(offset)} title="Reload">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {error && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {error}
          </p>
        )}
        {loading && !rows ? (
          <div className="flex h-28 items-center justify-center text-foreground-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-foreground-subtle">
            No delivery syncs yet — cost appears here once a member&apos;s to-do
            pool is computed.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-background-soft/40">
                  <tr>
                    <th className={cnTh()}>Synced</th>
                    <th className={cnTh()}>Member</th>
                    <th className={cnTh()}>Model</th>
                    <th className={cnTh("right")}>LLM calls</th>
                    <th className={cnTh("right")}>In tok</th>
                    <th className={cnTh("right")}>Out tok</th>
                    <th className={cnTh("right")}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-background-soft/30">
                      <td className="whitespace-nowrap px-3 py-1.5 text-foreground-muted">
                        {fmtDateTime(r.occurred_at)}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-1.5 text-foreground" title={r.email ?? ""}>
                        {r.display_name || r.email || (
                          <span className="italic text-foreground-subtle">scheduled</span>
                        )}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-1.5 font-mono text-foreground-muted" title={r.model ?? ""}>
                        {r.model ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.llm_calls)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.prompt_tokens)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">{fmtInt(r.completion_tokens)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-foreground-muted">
                        {fmtCost(r.cost, r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={offset <= 0 || loading}
                onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => load(offset + PAGE_SIZE)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Request type 2: document drafting & edits — reserved (not yet active). */}
      <div>
        <p className="mb-2 text-[11px] font-semibold text-foreground-subtle">
          Document drafting &amp; edits
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 px-4 py-5 text-xs text-foreground-subtle">
          <FileText className="h-4 w-4 shrink-0" />
          <span>
            Not yet active — the tokens spent drafting and revising delivery files
            will be tracked here once Indigo Iota generates them.
          </span>
        </div>
      </div>
    </div>
  );
}

/** The expanded comprehend trace for one email: the English text the agents
 *  saw, the entities that entered the fan-out, the header-grounded structural
 *  edges, and — per subject — the RelationshipAgent's candidates, raw output,
 *  dropped objects, accepted triples, normalization, and final triples. */
function TraceView({
  state,
}: {
  state: RelationshipTrace | "loading" | { error: string } | undefined;
}) {
  if (!state || state === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-foreground-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading trace…
      </div>
    );
  }
  if ("error" in state) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {state.error}
      </p>
    );
  }
  const trace = state;
  const tp = trace.third_party;
  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-background p-3">
      {/* Direction + third-party classification (new pairwise pipeline). */}
      {(trace.direction || tp) && (
        <Section label="Third party">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            {trace.direction && (
              <span className="rounded-full border border-border bg-background-soft/40 px-2.5 py-0.5 text-foreground-muted">
                {trace.direction}
              </span>
            )}
            {tp?.bucket && (
              <span className="rounded-full border border-accent bg-accent/10 px-2.5 py-0.5 text-accent">
                {tp.bucket}
              </span>
            )}
            {tp?.person_name && (
              <span className="text-foreground-muted">person: {tp.person_name}</span>
            )}
            {tp?.company_name && (
              <span className="text-foreground-muted">company: {tp.company_name}</span>
            )}
            {tp?.address && (
              <span className="text-foreground-subtle">{tp.address}</span>
            )}
          </div>
        </Section>
      )}

      {/* English text the agents actually saw (post-translation). */}
      <Section label="Email text seen by the agents (English)">
        <p className="whitespace-pre-wrap rounded-md bg-background-soft/40 px-3 py-2 text-xs leading-relaxed text-foreground-muted">
          {trace.email_text || "—"}
        </p>
      </Section>

      {/* Entities that entered the per-entity fan-out. */}
      <Section label={`Entities in the fan-out (${trace.entities.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {trace.entities.map((e, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-background-soft/40 px-2.5 py-0.5 font-mono text-[11px] text-foreground-muted"
              title={e.email ?? undefined}
            >
              {e.name}
              <span className="text-foreground-subtle"> · {e.type}</span>
              {e.email ? <span className="text-accent"> ✉</span> : null}
            </span>
          ))}
        </div>
      </Section>

      {/* Header-grounded structural edges (written directly, not by the LLM). */}
      {trace.structural_edges.length > 0 && (
        <Section label="Structural edges (header-grounded, not LLM)">
          <ul className="space-y-0.5">
            {trace.structural_edges.map((e, i) => (
              <li key={i} className="font-mono text-[11px] text-success">
                {e.subject} —{e.predicate}→ {e.object}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Pairwise RelationshipAgent decisions (new pipeline). */}
      {trace.pairs && (
        <Section label={`RelationshipAgent · pairs evaluated (${trace.pairs.length})`}>
          {trace.pairs.length === 0 ? (
            <p className="text-xs text-foreground-subtle">No pairs evaluated.</p>
          ) : (
            <ul className="space-y-1 font-mono text-[11px]">
              {trace.pairs.map((p, i) => (
                <li
                  key={i}
                  className={p.result ? "text-foreground" : "text-foreground-subtle"}
                >
                  {p.pair?.[0]} ↔ {p.pair?.[1]}
                  {p.result ? (
                    <span className="text-accent">
                      {"  →  "}
                      {p.result.subject} —{p.result.predicate}→ {p.result.object}
                    </span>
                  ) : (
                    <span>  →  no relationship</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Legacy per-subject trace (pre-pairwise rows). */}
      {trace.subjects && trace.subjects.length > 0 && (
        <Section label={`RelationshipAgent · per subject (${trace.subjects.length})`}>
          <div className="space-y-3">
            {trace.subjects.map((s, i) => (
              <SubjectTrace key={i} s={s} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SubjectTrace({
  s,
}: {
  s: RelSubjectTrace;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background-soft/20 p-3">
      <div className="mb-2 font-mono text-xs font-semibold text-accent">
        {s.subject.name}
        <span className="text-foreground-subtle"> · {s.subject.type}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Candidate objects shown">
          {s.candidates.length ? (
            <ul className="font-mono text-[11px] text-foreground-muted">
              {s.candidates.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Raw model output">
          {s.raw_model_output.length ? (
            <ul className="font-mono text-[11px] text-foreground-muted">
              {s.raw_model_output.map((t, i) => (
                <li key={i}>
                  {t.predicate ?? "?"} → {t.object ?? "?"}
                </li>
              ))}
            </ul>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Normalization (raw → canonical)">
          {s.normalization.length ? (
            <ul className="font-mono text-[11px]">
              {s.normalization.map((n, i) => (
                <li
                  key={i}
                  className={n.canonical ? "text-foreground-muted" : "text-warning"}
                >
                  {n.raw} → {n.canonical ?? "dropped"}
                  {n.canonical && n.canonical !== n.raw ? (
                    <span className="text-accent"> ✓</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Dash />
          )}
        </Field>
        <Field label="Final triples (stored)">
          {s.final.length ? (
            <ul className="font-mono text-[11px] text-foreground">
              {s.final.map((t, i) => (
                <li key={i}>
                  —{t.predicate}→ {t.object}
                  <span className="text-foreground-subtle"> ({t.object_type})</span>
                </li>
              ))}
            </ul>
          ) : (
            <Dash />
          )}
        </Field>
        {s.dropped_unknown_object.length > 0 && (
          <Field label="Dropped — object not a known entity">
            <ul className="font-mono text-[11px] text-warning">
              {s.dropped_unknown_object.map((t, i) => (
                <li key={i}>
                  {t.predicate} → {t.object}
                </li>
              ))}
            </ul>
          </Field>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-foreground-subtle">
        {label}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-foreground-subtle">
        {label}
      </p>
      {children}
    </div>
  );
}

function Dash() {
  return <span className="text-xs text-foreground-subtle">—</span>;
}

function cnTh(align?: "right" | "center"): string {
  const base =
    "whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium text-foreground";
  if (align === "right") return `${base} text-right`;
  if (align === "center") return `${base} text-center`;
  return base;
}
