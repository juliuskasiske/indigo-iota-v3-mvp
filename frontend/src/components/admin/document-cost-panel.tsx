"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { api, ApiError, type DocumentCost } from "@/lib/api";

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number, currency: string): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * Per-document token + cost rollup for comprehended Google Drive files — which
 * documents are the most token- and credit-hungry. Empty until Drive
 * comprehension is enabled (Ontology → Comprehension diligence) and has run.
 */
export function DocumentCostPanel({
  onAuthError,
  embedded = false,
}: {
  onAuthError: (e: ApiError) => void;
  // When embedded (e.g. inside the Observability "Google Drive" expander) the
  // outer Card chrome is dropped — the container already labels the section.
  embedded?: boolean;
}) {
  const [data, setData] = useState<DocumentCost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.observabilityByDocument());
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load document costs.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data?.rows ?? [];

  const body = (
    <div className="text-sm">
      {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : error ? (
          <p className="text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-foreground-subtle">
            No documents comprehended yet. Connect a Drive folder and turn on
            &ldquo;Comprehend Google Drive documents&rdquo; (Ontology → Comprehension
            diligence) to populate this.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-left text-foreground-subtle">
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 px-3 font-medium">Model</th>
                  <th className="py-2 px-3 text-right font-medium">Entities</th>
                  <th className="py-2 px-3 text-right font-medium">Rel.</th>
                  <th className="py-2 px-3 text-right font-medium">LLM calls</th>
                  <th className="py-2 px-3 text-right font-medium">Input tokens</th>
                  <th className="py-2 px-3 text-right font-medium">Output tokens</th>
                  <th className="py-2 pl-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.filename}
                    className="border-b border-border/30 last:border-0"
                  >
                    <td className="max-w-[22rem] truncate py-2 pr-3 text-foreground">
                      {r.filename}
                    </td>
                    <td className="max-w-[12rem] truncate py-2 px-3 font-mono text-foreground-muted" title={r.model ?? ""}>
                      {r.model ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground-muted">
                      {fmtInt(r.entities)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground-muted">
                      {fmtInt(r.relationships)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground-muted">
                      {fmtInt(r.llm_calls)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground-muted">
                      {fmtInt(r.input_tokens)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-foreground-muted">
                      {fmtInt(r.output_tokens)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium text-foreground">
                      {fmtCost(r.cost, data?.currency ?? "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );

  if (embedded) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          Cost by document
        </CardTitle>
        <CardDescription>
          Tokens and credits each Google Drive document has cost to comprehend into
          the brain — most expensive first. (Searching documents is free; this is the
          metered agent extraction.)
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
