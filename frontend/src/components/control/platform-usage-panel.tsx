"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  api,
  ApiError,
  type PlatformUsageRow,
  type UsageTimeseriesPoint,
} from "@/lib/api";
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

function metricVals(r: PlatformUsageRow, m: Metric) {
  const ing = m === "$" ? Number(r.ingestion_cost) : r.ingestion_tokens;
  const qa = m === "$" ? Number(r.qa_cost) : r.qa_tokens;
  return { ing, qa, tot: ing + qa };
}

type OrgSummary = {
  org_id: number;
  org_slug: string;
  org_name: string;
  ing: number;
  qa: number;
  tot: number;
};

export function PlatformUsagePanel({
  onAuthError,
}: {
  onAuthError: (e: ApiError) => void;
}) {
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [metric, setMetric] = useState<Metric>("$");

  const [rows, setRows] = useState<PlatformUsageRow[] | null>(null);
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
          api.platform.usage(days),
          api.platform.usageTimeseries(days),
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

  const orgSummaries = useMemo<OrgSummary[]>(() => {
    if (!rows) return [];
    const map = new Map<number, OrgSummary>();
    for (const r of rows) {
      const v = metricVals(r, metric);
      const existing = map.get(r.org_id);
      if (existing) {
        existing.ing += v.ing;
        existing.qa += v.qa;
        existing.tot += v.tot;
      } else {
        map.set(r.org_id, {
          org_id: r.org_id,
          org_slug: r.org_slug,
          org_name: r.org_name,
          ing: v.ing,
          qa: v.qa,
          tot: v.tot,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.tot - a.tot);
  }, [rows, metric]);

  const maxOrg = Math.max(1, ...orgSummaries.map((o) => o.tot));
  const memberRows = useMemo(
    () => (rows ?? []).map((r) => ({ r, ...metricVals(r, metric) })),
    [rows, metric],
  );
  const maxMember = Math.max(1, ...memberRows.map((m) => m.tot));

  const hasData = (series?.length ?? 0) > 0 && totals.tot > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-accent" />
              Platform usage
            </CardTitle>
            <CardDescription>
              Raw internal cost (before customer markup) across all workspaces —
              automated{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-2 rounded-sm bg-amber-500/70" />
                ingestion
              </span>{" "}
              vs interactive{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-1.5 w-2 rounded-sm bg-accent/60" />
                Q&amp;A
              </span>
              .
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
          <p className="text-sm text-foreground-subtle">
            No LLM usage recorded in this range across any workspace.
          </p>
        ) : (
          <>
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-foreground-subtle">
              <b className="font-semibold text-foreground-muted">{range}</b> ·{" "}
              {presetById(preset).label.toLowerCase()}
            </div>

            <StatCards metric={metric} totals={totals} range={range} />

            <UsageChart data={chart} metric={metric} />

            {/* Per-workspace */}
            <div className="mt-6 pt-1.5">
              <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                By workspace · {range}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col />
                    <col className="w-[170px]" />
                    <col className="w-[92px]" />
                    <col className="w-[80px]" />
                    <col className="w-[92px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-foreground-subtle">
                      <th className="pb-2.5 text-left font-normal">Workspace</th>
                      <th className="pb-2.5 text-right font-normal">Mix</th>
                      <th className="pb-2.5 text-right font-normal">Ingestion</th>
                      <th className="pb-2.5 text-right font-normal">Q&amp;A</th>
                      <th className="pb-2.5 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgSummaries.map((o) => (
                      <tr key={o.org_id} className="border-t border-border/40">
                        <td className="py-3 pr-4">
                          <span className="font-semibold text-foreground">{o.org_name}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-foreground-subtle">
                            {o.org_slug}
                          </span>
                        </td>
                        <td className="py-3 pl-4">
                          <div className="ml-auto w-[150px]">
                            <SplitBar ing={o.ing} qa={o.qa} max={maxOrg} />
                          </div>
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-amber-500">
                          {fmtVal(o.ing, metric)}
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-accent">
                          {fmtVal(o.qa, metric)}
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-foreground">
                          {fmtVal(o.tot, metric)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-member, grouped by workspace */}
            <div className="mt-7 pt-1.5">
              <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                By member · {range}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[170px]" />
                    <col className="w-[92px]" />
                    <col className="w-[80px]" />
                    <col className="w-[92px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-foreground-subtle">
                      <th className="pb-2.5 text-left font-normal">Workspace</th>
                      <th className="pb-2.5 text-left font-normal">Member</th>
                      <th className="pb-2.5 text-right font-normal">Mix</th>
                      <th className="pb-2.5 text-right font-normal">Ingestion</th>
                      <th className="pb-2.5 text-right font-normal">Q&amp;A</th>
                      <th className="pb-2.5 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map(({ r, ing, qa, tot }, i) => {
                      const name =
                        r.user_id !== null
                          ? r.display_name || r.email || `User #${r.user_id}`
                          : r.source_mailbox || "Unattributed";
                      // Show the email as a secondary label only when it isn't
                      // already the primary name — members without a display
                      // name are listed BY their email, so don't print it twice.
                      const secondary =
                        r.user_id !== null && r.display_name ? r.email : null;
                      return (
                        <tr
                          key={`${r.org_id}-${r.user_id ?? r.source_mailbox ?? "x"}-${i}`}
                          className="border-t border-border/40"
                        >
                          <td className="py-3 pr-3">
                            <span className="block truncate font-mono text-[10px] text-foreground-subtle">
                              {r.org_slug}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <span className="flex items-baseline gap-2">
                              <span className="truncate font-medium text-foreground">
                                {name}
                              </span>
                              {secondary && (
                                <span className="shrink-0 text-[10px] font-normal text-foreground-subtle">
                                  {secondary}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-3 pl-4">
                            <div className="ml-auto w-[150px]">
                              <SplitBar ing={ing} qa={qa} max={maxMember} />
                            </div>
                          </td>
                          <td className="py-3 pl-3 text-right font-semibold tabular-nums text-amber-500">
                            {fmtVal(ing, metric)}
                          </td>
                          <td className="py-3 pl-3 text-right font-semibold tabular-nums text-accent">
                            {fmtVal(qa, metric)}
                          </td>
                          <td className="py-3 pl-3 text-right font-semibold tabular-nums text-foreground">
                            {fmtVal(tot, metric)}
                          </td>
                        </tr>
                      );
                    })}
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
