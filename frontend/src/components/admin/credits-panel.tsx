"use client";

import { useEffect, useState } from "react";
import { Wallet, Mail, FileText, AlertTriangle, Ban, Plus, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  api,
  ApiError,
  type Credits,
  type CreditsHistory,
  type CreditsHistoryPoint,
} from "@/lib/api";

/** A customer-facing money figure in US dollars, e.g. "$1,000" or "$12.50".
 *  Credits ARE dollars (1 credit = $1); we never show a bare unitless number. */
function money(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const isWhole = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function count(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

const CONFIRM_WORD = "CONFIRM";

export function CreditsPanel({
  onAuthError,
  embedded,
}: {
  onAuthError: (e: ApiError) => void;
  // When true, render bare content (no Card chrome) — for use inside an Expander.
  embedded?: boolean;
}) {
  const [data, setData] = useState<Credits | null>(null);
  const [history, setHistory] = useState<CreditsHistory | null>(null);
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [saving, setSaving] = useState(false);

  function handleError(e: unknown): boolean {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onAuthError(e);
      return true;
    }
    setError(e instanceof Error ? e.message : "Failed to load spending.");
    return false;
  }

  async function load(g: "day" | "week" = granularity) {
    setError(null);
    try {
      const [c, h] = await Promise.all([api.credits(), api.creditsHistory(g)]);
      setData(c);
      setHistory(h);
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeGranularity(g: "day" | "week") {
    if (g === granularity) return;
    setGranularity(g);
    try {
      setHistory(await api.creditsHistory(g));
    } catch (e) {
      handleError(e);
    }
  }

  function startAdd() {
    setAmountInput("");
    setConfirmInput("");
    setError(null);
    setAdding(true);
  }

  function cancelAdd() {
    setAdding(false);
    setConfirmInput("");
    setError(null);
  }

  const trimmed = amountInput.trim();
  const parsedAmount = trimmed === "" ? null : Number(trimmed);
  const amountValid =
    parsedAmount !== null && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const confirmed = confirmInput.trim().toUpperCase() === CONFIRM_WORD;
  const canSave = amountValid && confirmed && !saving;

  async function submitAdd() {
    if (!amountValid) {
      setError("Enter a whole dollar amount greater than 0.");
      return;
    }
    if (!confirmed) {
      setError(`Type ${CONFIRM_WORD} to confirm this billable top-up.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Whole credits only — a top-up is a billable purchase, not a fine meter.
      await api.addCredits(Math.round(parsedAmount!));
      cancelAdd();
      await load();
    } catch (e) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  }

  const pct =
    data != null ? Math.min(100, Math.max(0, Math.round(data.fraction_used * 100))) : 0;
  const barColor = data?.out_of_credits
    ? "bg-destructive"
    : data?.low_balance
      ? "bg-warning"
      : "bg-accent";

  const body = (
    <div className="space-y-4 text-sm">
        {loading ? (
          <p className="text-foreground-subtle">Loading…</p>
        ) : data ? (
          <>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            {/* Run-out states. At zero, every LLM request is paused until the
                workspace is topped up — so we say so plainly. */}
            {data.out_of_credits ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-destructive">
                <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Out of credits — processing paused</div>
                  <div className="text-xs opacity-90">
                    No new emails or documents will be analysed until this
                    workspace is topped up.
                  </div>
                </div>
              </div>
            ) : data.low_balance ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Running low on credits</div>
                  <div className="text-xs opacity-90">
                    {pct}% of purchased credits used. Processing pauses
                    automatically at zero.
                  </div>
                </div>
              </div>
            ) : null}

            {/* What you have, what you've used, what you funded. Remaining is
                the hero — it's the only ceiling. */}
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Credits remaining"
                value={money(data.balance)}
                big
                tone={data.out_of_credits ? "danger" : data.low_balance ? "warn" : "normal"}
              />
              <Stat label="Spent so far" value={money(data.credits_spent)} />
              <Stat
                label="Total purchased"
                value={money(data.credits_granted)}
                hint="Sum of all credit top-ups."
              />
            </div>

            {/* Share of purchased credits consumed. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-foreground-subtle">
                <span>{pct}% of purchased credits used</span>
                {data.out_of_credits && (
                  <Badge
                    variant="default"
                    className="border-destructive/30 bg-destructive/10 text-destructive"
                  >
                    <Ban className="h-3 w-3" /> Depleted
                  </Badge>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-background-soft">
                <div
                  className={`h-full ${barColor} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Daily (or weekly) spend + the remaining balance after each
                period — how fast the workspace is burning down. */}
            <div className="space-y-2 rounded-md border border-border/50 bg-background-soft/20 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-foreground">
                  Spend &amp; remaining balance
                </div>
                <div className="flex items-center gap-1">
                  <ToggleButton
                    active={granularity === "day"}
                    onClick={() => changeGranularity("day")}
                  >
                    Daily
                  </ToggleButton>
                  <ToggleButton
                    active={granularity === "week"}
                    onClick={() => changeGranularity("week")}
                  >
                    Weekly
                  </ToggleButton>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-foreground-subtle">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent/25" />
                  Spent / {granularity === "week" ? "week" : "day"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 rounded-full bg-accent" />
                  Remaining
                </span>
              </div>
              <SpendChart series={history?.series ?? []} granularity={granularity} />
            </div>

            {/* What the remaining balance buys, in real work. */}
            <div className="rounded-md border border-accent/20 bg-accent/5 px-4 py-3">
              <div className="text-xs text-foreground-subtle">
                Your remaining credits cover roughly
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Capacity icon={Mail} value={count(data.estimate.emails)} unit="emails" />
                <Capacity icon={FileText} value={count(data.estimate.files)} unit="documents" />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-foreground-subtle">
                Estimated from typical email and document sizes — actual mileage
                varies with length and complexity.
              </p>
            </div>

            {/* Top up. Adding credits raises the spending ceiling by exactly
                that amount and is logged as a timestamped purchase for
                invoicing. */}
            <div className="border-t border-border/40 pt-3">
              {!adding ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-foreground-subtle">Need more headroom?</div>
                    <div className="text-foreground">Add credits to this workspace.</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={startAdd}>
                    <Plus className="h-4 w-4" /> Add credits
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-md border border-warning/30 bg-warning/5 p-3">
                  <div className="flex items-start gap-2 text-xs text-foreground">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span>
                      This is a billable purchase. Credits are charged at{" "}
                      <span className="font-medium">$1 per credit</span>{" "}
                      and this amount will be added to this workspace&apos;s
                      invoice. It raises what the workspace can spend
                      immediately.
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="add-credits-input">Amount to add (whole US dollars)</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-subtle">
                        $
                      </span>
                      <Input
                        id="add-credits-input"
                        className="h-9 pl-7"
                        placeholder="1,000"
                        inputMode="numeric"
                        value={amountInput}
                        autoFocus
                        onChange={(e) => setAmountInput(e.target.value.replace(/[^\d]/g, ""))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="add-confirm-input">
                      Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm the charge
                    </Label>
                    <Input
                      id="add-confirm-input"
                      className="h-9"
                      placeholder={CONFIRM_WORD}
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && canSave && submitAdd()}
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={saving} onClick={cancelAdd}>
                      Cancel
                    </Button>
                    <Button size="sm" disabled={!canSave} onClick={submitAdd}>
                      {saving
                        ? "Adding…"
                        : amountValid
                          ? `Add $${Math.round(parsedAmount!).toLocaleString("en-US")}`
                          : "Add credits"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-destructive">{error ?? "Could not load spending."}</p>
        )}
    </div>
  );
  if (embedded) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4 text-accent" />
          Credits
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/** Daily/weekly spend (bars) overlaid with the remaining balance (line).
 *  Hand-rolled SVG — no chart dependency, brand tokens only. */
function SpendChart({
  series,
  granularity,
}: {
  series: CreditsHistoryPoint[];
  granularity: "day" | "week";
}) {
  if (series.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-foreground-subtle">
        No spend recorded yet — your burn-down appears here once the brain
        starts processing.
      </p>
    );
  }

  const W = 640;
  const H = 190;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = series.length;

  const spent = series.map((p) => Number(p.spent) || 0);
  const remaining = series.map((p) => Number(p.remaining) || 0);
  const spendMax = Math.max(...spent, 1e-9);
  const remainMax = Math.max(...remaining, 1e-9);

  const slot = plotW / n;
  const barW = Math.max(1, Math.min(slot * 0.62, 26));
  const xAt = (i: number) => padL + slot * (i + 0.5);
  const baseline = padT + plotH;
  const barTop = (v: number) => baseline - (v / spendMax) * plotH;
  const lineY = (v: number) => baseline - (v / remainMax) * plotH;
  const linePts = remaining.map((v, i) => `${xAt(i).toFixed(1)},${lineY(v).toFixed(1)}`).join(" ");

  const fmtDate = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  const fmtMoney = (v: number) =>
    v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2,
      maximumFractionDigits: 2,
    });

  // Sparse x-axis labels: first, middle, last (avoids crowding).
  const labelIdx = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Credit spend per ${granularity} and remaining balance over time`}
    >
      {/* baseline */}
      <line
        x1={padL}
        y1={baseline}
        x2={W - padR}
        y2={baseline}
        stroke="hsl(var(--border))"
        strokeWidth={1}
      />

      {/* spend bars */}
      {spent.map((v, i) =>
        v > 0 ? (
          <rect
            key={i}
            x={xAt(i) - barW / 2}
            y={barTop(v)}
            width={barW}
            height={Math.max(0, baseline - barTop(v))}
            rx={1.5}
            fill="hsl(var(--accent))"
            fillOpacity={0.22}
          >
            <title>{`${fmtDate(series[i].period_start)} · spent ${fmtMoney(v)}`}</title>
          </rect>
        ) : null,
      )}

      {/* remaining-balance line */}
      <polyline
        points={linePts}
        fill="none"
        stroke="hsl(var(--accent))"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={xAt(n - 1)} cy={lineY(remaining[n - 1])} r={3} fill="hsl(var(--accent))">
        <title>{`${fmtDate(series[n - 1].period_start)} · remaining ${fmtMoney(remaining[n - 1])}`}</title>
      </circle>

      {/* x labels */}
      {labelIdx.map((i) => (
        <text
          key={i}
          x={xAt(i)}
          y={H - 6}
          textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          fontSize={10}
          fill="hsl(var(--foreground-subtle))"
        >
          {fmtDate(series[i].period_start)}
        </text>
      ))}
    </svg>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-7 px-2.5 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Stat({
  label,
  value,
  big,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string;
  big?: boolean;
  hint?: string;
  tone?: "normal" | "warn" | "danger";
}) {
  const valueColor =
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-md border border-border/50 bg-background-soft/30 px-3 py-2">
      <div className="text-[11px] text-foreground-subtle">{label}</div>
      <div className={`${valueColor} ${big ? "text-lg font-semibold" : "text-sm"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-snug text-foreground-subtle">{hint}</div>}
    </div>
  );
}

function Capacity({
  icon: Icon,
  value,
  unit,
}: {
  icon: typeof Mail;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent" />
      <div>
        <span className="text-lg font-semibold text-foreground">{value}</span>{" "}
        <span className="text-xs text-foreground-subtle">{unit}</span>
      </div>
    </div>
  );
}
