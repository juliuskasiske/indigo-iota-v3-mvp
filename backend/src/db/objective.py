"""The objective function: what this workspace is trying to achieve, by when.

One singleton row per tenant brain (``objective_function``, migrations 0031 +
0032). It holds three layers:

  * the ranked **levers** — which balanced-scorecard priorities matter, in order;
  * the **program** — the unit impact is measured in (revenue / EBIT / …),
    whether it is a recurring run-rate or a one-time gain, the baseline and the
    target, the window it has to happen in, and how often it is reviewed;
  * the **headline** — the one sentence the agents compress all of the above
    into, which becomes the root node of every hypothesis tree.

The headline is stored rather than regenerated per run on purpose: the whole
diagnosis hangs off that sentence, so the user gets to read and correct it
before any agent time is spent building a tree on top of it.

Functions take an open *tenant* connection so the caller picks the brain DB and
owns the transaction boundary (same convention as ``db/ontology.py`` and
``ingestion/triage/scope_store.py``).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

# Recognized values. Validation lives in the API layer (Pydantic enums) rather
# than in CHECK constraints, so extending these is a code change and not a
# migration against every tenant database.
IMPACT_METRICS = ("revenue", "ebit", "ebitda", "gross_margin", "cash", "custom")
IMPACT_TYPES = ("recurring", "one_time")
TARGET_BASES = ("absolute", "percent", "multiple")
REPORTING_CADENCES = ("weekly", "biweekly", "monthly", "quarterly")

METRIC_LABELS = {
    "revenue": "revenue",
    "ebit": "EBIT",
    "ebitda": "EBITDA",
    "gross_margin": "gross margin",
    "cash": "cash",
}

_COLUMNS = (
    "priorities, context, impact_metric, impact_metric_label, impact_type, "
    "currency, baseline_amount, target_basis, target_amount, program_start_date, "
    "program_end_date, run_rate_year, reporting_cadence, headline, "
    "headline_source, headline_at, updated_at"
)


@dataclass
class Objective:
    """The whole objective function, loaded in one shot."""

    priorities: list[dict] = field(default_factory=list)
    context: str = ""
    impact_metric: str = "revenue"
    impact_metric_label: str = ""
    impact_type: str = "recurring"
    currency: str = "EUR"
    baseline_amount: Decimal | None = None
    target_basis: str = "absolute"
    target_amount: Decimal | None = None
    program_start_date: date | None = None
    program_end_date: date | None = None
    run_rate_year: int | None = None
    reporting_cadence: str = "monthly"
    headline: str = ""
    headline_source: str = "agent"
    headline_at: datetime | None = None
    updated_at: datetime | None = None

    # --- derived ------------------------------------------------------------

    @property
    def metric_label(self) -> str:
        """Human name of the impact metric ('EBIT', 'revenue', or the custom text)."""
        if self.impact_metric == "custom":
            return self.impact_metric_label.strip() or "impact"
        return METRIC_LABELS.get(self.impact_metric, self.impact_metric)

    def resolved_target(self) -> Decimal | None:
        """The target as an ABSOLUTE amount, whatever basis it was entered in.

        'absolute' is the goal itself; 'percent' is an uplift ON TOP of the
        baseline (+20% of 100 = 120); 'multiple' is a factor OF the baseline
        (2x of 100 = 200). The percent and multiple bases need a baseline to
        mean anything, so they return None without one — the caller decides
        whether that is a problem (the UI hides the coverage bar; the Sizer
        prompt simply omits the target).

        Kept here, in one place, so the coverage bar the user sees and the
        number the Sizer is briefed with can never disagree.
        """
        if self.target_amount is None:
            return None
        target = Decimal(self.target_amount)
        if self.target_basis == "absolute":
            return target
        if self.baseline_amount is None:
            return None
        baseline = Decimal(self.baseline_amount)
        if self.target_basis == "percent":
            return baseline * (Decimal(1) + target / Decimal(100))
        if self.target_basis == "multiple":
            return baseline * target
        return None

    @property
    def headline_stale(self) -> bool:
        """True when the objective changed after the headline was written.

        Lets the Objectives tab flag a headline that no longer describes what it
        claims to, instead of silently letting a stale sentence root the tree.
        """
        if not self.headline:
            return False
        if self.headline_at is None:
            return True
        if self.updated_at is None:
            return False
        return self.updated_at > self.headline_at

    @property
    def is_configured(self) -> bool:
        """Whether enough of the program is filled in to brief an agent with it."""
        return bool(self.priorities) or self.target_amount is not None

    def ranked_labels(self) -> list[str]:
        """Lever labels in the user's ranked order (honouring `rank`, not array order)."""
        ranked = sorted(
            (p for p in self.priorities if isinstance(p, dict) and p.get("label")),
            key=lambda p: p.get("rank", 0),
        )
        return [str(p["label"]) for p in ranked]


def _row_to_objective(row: tuple) -> Objective:
    return Objective(
        priorities=row[0] or [],
        context=row[1] or "",
        impact_metric=row[2] or "revenue",
        impact_metric_label=row[3] or "",
        impact_type=row[4] or "recurring",
        currency=row[5] or "EUR",
        baseline_amount=row[6],
        target_basis=row[7] or "absolute",
        target_amount=row[8],
        program_start_date=row[9],
        program_end_date=row[10],
        run_rate_year=row[11],
        reporting_cadence=row[12] or "monthly",
        headline=row[13] or "",
        headline_source=row[14] or "agent",
        headline_at=row[15],
        updated_at=row[16],
    )


def get_objective(conn: psycopg.Connection) -> Objective:
    """Read the objective. Returns defaults if the singleton row is somehow absent."""
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM objective_function WHERE id = 1;")
        row = cur.fetchone()
    return _row_to_objective(row) if row else Objective()


def save_objective(conn: psycopg.Connection, obj: Objective) -> Objective:
    """Upsert the objective and return it as stored.

    ``updated_at`` moves to now() on every save, which is what makes
    ``headline_stale`` work: edit a lever and the headline is flagged.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO objective_function
                (id, priorities, context, impact_metric, impact_metric_label,
                 impact_type, currency, baseline_amount, target_basis, target_amount,
                 program_start_date, program_end_date, run_rate_year,
                 reporting_cadence, headline, headline_source, headline_at, updated_at)
            VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (id) DO UPDATE SET
                priorities          = EXCLUDED.priorities,
                context             = EXCLUDED.context,
                impact_metric       = EXCLUDED.impact_metric,
                impact_metric_label = EXCLUDED.impact_metric_label,
                impact_type         = EXCLUDED.impact_type,
                currency            = EXCLUDED.currency,
                baseline_amount     = EXCLUDED.baseline_amount,
                target_basis        = EXCLUDED.target_basis,
                target_amount       = EXCLUDED.target_amount,
                program_start_date  = EXCLUDED.program_start_date,
                program_end_date    = EXCLUDED.program_end_date,
                run_rate_year       = EXCLUDED.run_rate_year,
                reporting_cadence   = EXCLUDED.reporting_cadence,
                headline            = EXCLUDED.headline,
                headline_source     = EXCLUDED.headline_source,
                headline_at         = EXCLUDED.headline_at,
                updated_at          = now();
            """,
            (
                Jsonb(obj.priorities), obj.context, obj.impact_metric,
                obj.impact_metric_label, obj.impact_type, obj.currency,
                obj.baseline_amount, obj.target_basis, obj.target_amount,
                obj.program_start_date, obj.program_end_date, obj.run_rate_year,
                obj.reporting_cadence, obj.headline, obj.headline_source,
                obj.headline_at,
            ),
        )
    conn.commit()
    return get_objective(conn)


def set_headline(
    conn: psycopg.Connection, headline: str, *, source: str = "agent"
) -> Objective:
    """Store the one-sentence objective without touching anything else.

    Deliberately does NOT bump ``updated_at`` — writing the headline is not a
    change to the objective it describes, and bumping it here would make every
    freshly-written headline instantly look stale.
    """
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE objective_function "
            "SET headline = %s, headline_source = %s, headline_at = now() "
            "WHERE id = 1;",
            (headline.strip(), source),
        )
    conn.commit()
    return get_objective(conn)


# --- prompt-facing rendering ------------------------------------------------

def _fmt_amount(amount: Decimal | None, currency: str) -> str:
    """A compact money string for prompts and readbacks: 6200000 -> 'EUR 6.2M'."""
    if amount is None:
        return ""
    value = Decimal(amount)
    sign = "-" if value < 0 else ""
    value = abs(value)
    if value >= 1_000_000_000:
        body, unit = f"{value / Decimal(1_000_000_000):.2f}", "B"
    elif value >= 1_000_000:
        body, unit = f"{value / Decimal(1_000_000):.2f}", "M"
    elif value >= 1_000:
        body, unit = f"{value / Decimal(1_000):.0f}", "k"
    else:
        body, unit = f"{value:.0f}", ""
    # 6.20 -> 6.2, 12.00 -> 12: trailing zeros read as false precision on an estimate.
    if "." in body:
        body = body.rstrip("0").rstrip(".")
    return f"{sign}{currency} {body}{unit}"


def describe(obj: Objective) -> str:
    """The objective as a briefing paragraph for an agent prompt.

    Everything an agent needs to judge whether an initiative is worth pursuing:
    what to optimize and in what order, in what unit, against what number, by
    when, and what the client said to respect.
    """
    parts: list[str] = []

    labels = obj.ranked_labels()
    if labels:
        ranked = "; ".join(f"{i + 1}. {lab}" for i, lab in enumerate(labels))
        parts.append(f"Optimize for, in priority order (most important first): {ranked}.")

    target = obj.resolved_target()
    kind = "recurring run-rate" if obj.impact_type == "recurring" else "one-time"
    if target is not None:
        baseline = (
            f" from {_fmt_amount(obj.baseline_amount, obj.currency)}"
            if obj.baseline_amount is not None
            else ""
        )
        parts.append(
            f"The program target is to move {obj.metric_label}{baseline} to "
            f"{_fmt_amount(target, obj.currency)} as a {kind} impact."
        )
    else:
        parts.append(f"Impact is measured in {obj.metric_label} as a {kind} impact.")

    if obj.run_rate_year:
        parts.append(f"That impact must hold as the run rate in FY{obj.run_rate_year}.")
    if obj.program_end_date:
        parts.append(
            f"The program ends {obj.program_end_date.isoformat()} — an initiative is "
            "only worth proposing if it can realistically land by then."
        )
    if obj.reporting_cadence:
        parts.append(f"Progress is reviewed {obj.reporting_cadence}.")

    ctx = (obj.context or "").strip()
    if ctx:
        parts.append(f"Client context to respect: {ctx}")

    return " ".join(parts)


def readback(obj: Objective) -> str:
    """A one-line deterministic restatement of the program (no LLM).

    Used as the fallback headline when no key is configured, and mirrored
    client-side under the Program fields so the form stays legible while it is
    being filled in.
    """
    target = obj.resolved_target()
    if target is None:
        return f"Improve {obj.metric_label}."
    baseline = (
        f" from {_fmt_amount(obj.baseline_amount, obj.currency)}"
        if obj.baseline_amount is not None
        else ""
    )
    kind = "recurring run-rate" if obj.impact_type == "recurring" else "one-time"
    when = ""
    if obj.run_rate_year:
        when = f" by FY{obj.run_rate_year}"
    elif obj.program_end_date:
        when = f" by {obj.program_end_date.isoformat()}"
    return (
        f"Grow {obj.metric_label}{baseline} to {_fmt_amount(target, obj.currency)} "
        f"as a {kind} impact{when}."
    )
