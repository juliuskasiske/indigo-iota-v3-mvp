"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api, ApiError, type UserUsageRow, type UsageTimeseriesPoint } from "@/lib/api";
import {
  UsageControls,
  StatCards,
  UsageChart,
  SplitBar,
  bucketize,
  totalsOf,
  rangeText,
  fmtVal,
  presetById,
  DEFAULT_PRESET,
  type Metric,
  type Granularity,
} from "@/components/usage/usage-shared";

type MemberRow = {
  key: string;
  name: string;
  email: string | null;
  ing: number;
  qa: number;
  tot: number;
};

function memberRows(rows: UserUsageRow[], metric: Metric): MemberRow[] {
  const out = rows.map((r, i): MemberRow => {
    const ing = metric === "$" ? Number(r.ingestion_cost) : r.ingestion_tokens;
    const qa = metric === "$" ? Number(r.qa_cost) : r.qa_tokens;
    // A row with a real member shows their name; a shared mailbox nobody signs
    // in as shows by address; the rare unattributed row falls back to a label.
    let name: string;
    if (r.user_id !== null) {
      name = r.display_name || r.email || `User #${r.user_id}`;
    } else if (r.source_mailbox) {
      name = r.source_mailbox;
    } else {
      name = "Unattributed";
    }
    return {
      key: r.user_id !== null ? `u${r.user_id}` : r.source_mailbox || `x${i}`,
      name,
      // Secondary email only when it isn't already the primary name — members
      // without a display name are listed BY their email, so don't repeat it.
      email: r.user_id !== null && r.display_name ? r.email : null,
      ing,
      qa,
      tot: ing + qa,
    };
  });
  return out.sort((a, b) => b.tot - a.tot);
}

export function SpendByUserPanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [metric, setMetric] = useState<Metric>("$");

  const [rows, setRows] = useState<UserUsageRow[] | null>(null);
  const [series, setSeries] = useState<UsageTimeseriesPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = presetById(preset).days;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [u, t] = await Promise.all([
          api.usageByUser(days),
          api.usageTimeseries(days),
        ]);
        if (cancelled) return;
        setRows(u.rows);
        setSeries(t.series);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load usage.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const totals = useMemo(() => totalsOf(series ?? [], metric), [series, metric]);
  const chart = useMemo(() => bucketize(series ?? [], granularity, metric), [series, granularity, metric]);
  const range = useMemo(() => rangeText(series ?? []), [series]);
  const members = useMemo(() => memberRows(rows ?? [], metric), [rows, metric]);
  const maxTot = Math.max(1, ...members.map((m) => m.tot));

  const hasData = (series?.length ?? 0) > 0 && totals.tot > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-accent" />
              Usage
            </CardTitle>
            <CardDescription>
              LLM spend over time — brain{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-2 rounded-sm bg-amber-500/70" />
                ingress
              </span>{" "}
              (capture &amp; comprehension) vs{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-2 rounded-sm bg-accent/60" />
                egress
              </span>{" "}
              (Q&amp;A &amp; delivery).
            </CardDescription>
          </div>
          <UsageControls
            preset={preset}
            granularity={granularity}
            metric={metric}
            onPreset={setPreset}
            onGranularity={setGranularity}
            onMetric={setMetric}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading && !series ? (
          <p className="text-sm text-foreground-subtle">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !hasData ? (
          <p className="text-xs text-foreground-subtle">
            No LLM usage recorded in this range. Spend appears here once a
            backfill, Q&amp;A, or delivery session runs.
          </p>
        ) : (
          <>
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-foreground-subtle">
              <b className="font-semibold text-foreground-muted">{range}</b> ·{" "}
              {presetById(preset).label.toLowerCase()}
            </div>

            <StatCards metric={metric} totals={totals} range={range} />

            <UsageChart data={chart} metric={metric} />

            <div className="mt-6 pt-1.5">
              <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                By team member · {range}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-foreground-subtle">
                      <th className="pb-2.5 text-left font-normal">Team member</th>
                      <th className="pb-2.5 text-right font-normal">Mix</th>
                      <th className="pb-2.5 text-right font-normal">Ingress</th>
                      <th className="pb-2.5 text-right font-normal">Egress</th>
                      <th className="pb-2.5 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.key} className="border-t border-border/40">
                        <td className="py-3 pr-4">
                          <span className="flex items-baseline gap-2">
                            <span className="font-semibold text-foreground">{m.name}</span>
                            {m.email && (
                              <span className="text-[11px] text-foreground-subtle">{m.email}</span>
                            )}
                          </span>
                        </td>
                        <td className="py-3 pl-4">
                          <div className="ml-auto w-[140px]">
                            <SplitBar ing={m.ing} qa={m.qa} max={maxTot} />
                          </div>
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-amber-500">
                          {fmtVal(m.ing, metric)}
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-accent">
                          {fmtVal(m.qa, metric)}
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-foreground">
                          {fmtVal(m.tot, metric)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
