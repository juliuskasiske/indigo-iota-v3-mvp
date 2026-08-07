"use client";

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, ApiError, type Ingestion, type CaptureDay } from "@/lib/api";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US");
}

type Status =
  | { kind: "none" }
  | { kind: "ok" }
  | { kind: "running" }
  | { kind: "failed" };

function statusOf(data: Ingestion): Status {
  const run = data.last_run;
  if (!run) return { kind: "none" };
  if (run.error) return { kind: "failed" };
  if (!run.finished_at) return { kind: "running" };
  return { kind: "ok" };
}

export function IngestionPanel({
  onAuthError,
  embedded,
}: {
  onAuthError: (e: ApiError) => void;
  embedded?: boolean;
}) {
  const [data, setData] = useState<Ingestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.ingestion());
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          onAuthError(e);
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load sync status.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = (
    <div className="space-y-4 text-sm">
      {loading ? (
        <p className="text-foreground-subtle">Loading…</p>
      ) : data ? (
        <Body data={data} />
      ) : (
        <p className="text-destructive">{error ?? "Could not load sync status."}</p>
      )}
    </div>
  );
  if (embedded) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-accent" />
          Mail sync
        </CardTitle>
        <CardDescription>
          When Indigo Iota last pulled new mail and how the most recent run went.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Status }) {
  switch (status.kind) {
    case "ok":
      return (
        <Badge variant="success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Healthy
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge variant="warning">
          <RefreshCw className="h-3.5 w-3.5" />
          Running
        </Badge>
      );
    default:
      return (
        <Badge variant="default">
          <Clock className="h-3.5 w-3.5" />
          No runs yet
        </Badge>
      );
  }
}

function Body({ data }: { data: Ingestion }) {
  const status = statusOf(data);
  const run = data.last_run;
  const mailbox = data.last_sync?.mailbox ?? run?.mailbox ?? null;
  const today = data.today;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {mailbox && (
          <span className="font-mono text-xs text-foreground-subtle">{mailbox}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Row label="Last synced" value={fmtTime(data.last_sync?.at ?? null)} />
        <Row label="Last run finished" value={fmtTime(run?.finished_at ?? null)} />
      </div>

      {/* Today's running tally across every run so far today. */}
      <div className="space-y-2 border-t border-border/40 pt-3">
        <p className="text-xs text-accent">
          Today
        </p>
        <div className="grid grid-cols-5 gap-2">
          <Stat label="Fetched" value={today.fetched} />
          <Stat label="Included" value={today.included} tone="success" />
          <Stat label="Excluded" value={today.excluded} />
          <Stat label="Duplicates" value={today.duplicates} />
          <Stat label="Removed" value={today.removed} />
        </div>
      </div>

      {/* Daily fetched vs included over the last 30 days. */}
      <div className="space-y-2 border-t border-border/40 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-accent">
            Last 30 days
          </p>
          <div className="flex items-center gap-4 text-[11px] text-foreground-subtle">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
              Fetched
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" />
              Included
            </span>
          </div>
        </div>
        <DailyChart daily={data.daily} />
      </div>

      {run?.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Last run failed</p>
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-destructive/90">
            {run.error}
          </p>
        </div>
      )}
    </>
  );
}

/** Daily stacked bars: each day's bar rises to ``fetched``, filled green up to
 *  ``included`` and blue (accent) for the ``fetched − included`` remainder on top.
 *  Hand-rolled SVG — brand tokens only, no chart dependency. */
function DailyChart({ daily }: { daily: CaptureDay[] }) {
  if (daily.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-foreground-subtle">
        No mail fetched in the last 30 days — daily activity appears here once
        syncs start landing.
      </p>
    );
  }

  const W = 640;
  const H = 170;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const n = daily.length;

  const maxY = Math.max(...daily.map((d) => d.fetched), ...daily.map((d) => d.included), 1);

  // One slot per day; the bar sits centred in its slot. Cap the width so a lone
  // day doesn't render as a giant block.
  const slot = plotW / n;
  const barW = Math.min(slot * 0.7, 44);
  const slotX = (i: number) => padL + slot * i;
  const barX = (i: number) => slotX(i) + (slot - barW) / 2;
  const hOf = (v: number) => (v / maxY) * plotH;

  // A rect with only its TOP two corners rounded (square base), so stacked
  // segments meet flush while the bar's crown stays soft.
  const topRoundedPath = (x: number, y: number, w: number, h: number) => {
    if (h <= 0) return "";
    const r = Math.min(3, w / 2, h);
    return (
      `M${x.toFixed(1)},${(y + h).toFixed(1)}` +
      `L${x.toFixed(1)},${(y + r).toFixed(1)}` +
      `Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}` +
      `L${(x + w - r).toFixed(1)},${y.toFixed(1)}` +
      `Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}` +
      `L${(x + w).toFixed(1)},${(y + h).toFixed(1)}Z`
    );
  };

  const fmtDate = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  const labelIdx = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Mail fetched (with the included share) per day over the last 30 days"
    >
      {/* baseline */}
      <line
        x1={padL}
        y1={baseY}
        x2={W - padR}
        y2={baseY}
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />
      {/* max gridline label */}
      <text x={padL} y={padT - 4} fontSize={9} fill="hsl(var(--foreground-subtle))">
        {maxY.toLocaleString("en-US")}
      </text>

      {daily.map((d, i) => {
        const x = barX(i);
        const incH = hOf(d.included);
        const extraH = hOf(Math.max(d.fetched - d.included, 0));
        const incTop = baseY - incH; // top of the green segment
        const extraTop = incTop - extraH; // top of the blue (remainder) segment
        const incIsTop = extraH <= 0; // green is the crown when nothing extra
        return (
          <g key={d.date}>
            <title>
              {`${fmtDate(d.date)}: ${d.fetched.toLocaleString("en-US")} fetched, ${d.included.toLocaleString("en-US")} included`}
            </title>
            {/* Included (green) — bottom segment. Rounds its own top only when
                there's no remainder stacked above it. */}
            {incH > 0 &&
              (incIsTop ? (
                <path d={topRoundedPath(x, incTop, barW, incH)} fill="hsl(var(--success))" />
              ) : (
                <rect x={x} y={incTop} width={barW} height={incH} fill="hsl(var(--success))" />
              ))}
            {/* Fetched remainder (blue) — top segment, rounded crown. */}
            {extraH > 0 && (
              <path d={topRoundedPath(x, extraTop, barW, extraH)} fill="hsl(var(--accent))" />
            )}
          </g>
        );
      })}

      {labelIdx.map((i) => (
        <text
          key={i}
          x={slotX(i) + slot / 2}
          y={H - 6}
          textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          fontSize={10}
          fill="hsl(var(--foreground-subtle))"
        >
          {fmtDate(daily[i].date)}
        </text>
      ))}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-foreground-subtle">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success";
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-soft/30 px-2 py-1.5 text-center">
      <div
        className={
          tone === "success"
            ? "text-base font-semibold text-success"
            : "text-base font-semibold text-foreground"
        }
      >
        {value.toLocaleString("en-US")}
      </div>
      <div className="text-[10px] text-foreground-subtle">{label}</div>
    </div>
  );
}
