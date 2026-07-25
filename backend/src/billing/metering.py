"""LLM metering: the chokepoint that turns each API call into an accurate cost.

Design — *point-in-time costing*:

  * Prices are EDITED in ``backend/prices.yaml`` and synced into an effective-
    dated price history (``llm_model_prices``): when the YAML changes, a new
    dated row is appended (never overwritten) on the next call. The price in
    effect at instant T for a model is the row with the greatest
    ``effective_from <= T``. Input and output are priced separately.
  * ``record_llm_usage`` looks up that price for the call's timestamp, computes
    input/output/total cost with exact decimal arithmetic, and writes ONE
    immutable row to ``llm_usage_events`` with the price snapshotted in. Changing
    a price later therefore never rewrites history.

Everything runs against the control plane (billing is Indigo Iota's concern,
cross-tenant; the per-customer brain DBs stay pure brain). Metering must never
break an LLM call: callers wrap record_llm_usage in a guard, and the function
itself degrades gracefully (an un-priced model still records its tokens).
"""
from __future__ import annotations

import contextvars
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from psycopg.types.json import Jsonb

from src.db.connection import get_control_connection

_MILLION = Decimal(1_000_000)

# The human-editable price sheet. Editing this file is THE way to change prices;
# its values are synced into the dated price-history table (llm_model_prices) so
# the DB keeps a full record of when each price took effect. Override the path
# with IOTA_PRICES_FILE if needed (e.g. tests).
_PRICES_FILE = Path(
    os.environ.get("IOTA_PRICES_FILE")
    or (Path(__file__).resolve().parents[2] / "prices.yaml")
)

# Org attribution is ambient: the request / provisioning layer sets the current
# org once, and every LLM call underneath is attributed to it without threading
# org_id through dozens of call signatures. Defaults to None (system usage).
_current_org_id: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "current_org_id", default=None
)


def set_current_org(org_id: int | None):
    """Attribute subsequent LLM usage on this context to ``org_id``.

    Returns the contextvars Token; pass it to ``reset_current_org`` to restore.
    """
    return _current_org_id.set(org_id)


def reset_current_org(token) -> None:
    _current_org_id.reset(token)


def current_org() -> int | None:
    return _current_org_id.get()


# User attribution: the user who triggered the request (Q&A caller, admin who
# kicked off a backfill). NULL for scheduled / system usage. Same ambient-context
# pattern as org_id so callers don't have to thread user_id through call chains.
_current_user_id: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "current_user_id", default=None
)


def set_current_user(user_id: int | None):
    """Attribute subsequent LLM usage on this context to ``user_id``.

    Returns the contextvars Token; pass it to ``reset_current_user`` to restore.
    """
    return _current_user_id.set(user_id)


def reset_current_user(token) -> None:
    _current_user_id.reset(token)


def current_user_id() -> int | None:
    return _current_user_id.get()


# Source mailbox attribution: the mailbox an ingested email was captured from.
# Stamped into each usage event's meta so ingestion cost can be traced back to
# the mailbox that drove it — and, when that mailbox is a team member's own
# address, folded into their row (via set_current_user of the resolved owner).
# NULL for interactive Q&A (no mailbox) and for mailboxes we can't attribute.
_current_source_mailbox: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_source_mailbox", default=None
)


def set_current_source_mailbox(mailbox: str | None):
    """Tag subsequent LLM usage on this context with the mailbox it came from.

    Returns the contextvars Token; pass it to ``reset_current_source_mailbox``.
    """
    return _current_source_mailbox.set(mailbox)


def reset_current_source_mailbox(token) -> None:
    _current_source_mailbox.reset(token)


def current_source_mailbox() -> str | None:
    return _current_source_mailbox.get()


# Question attribution: the tenant `questions` row a Q&A synthesis belongs to.
# Stamped into the usage event's meta so the Ask observability table can join a
# question's text (tenant DB) to its token/cost (control DB) by id — the two
# tables live in different databases and can't be SQL-joined. NULL for any LLM
# call not made while answering a saved question.
_current_question_id: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "current_question_id", default=None
)


def set_current_question_id(question_id: int | None):
    """Tag subsequent LLM usage on this context with the question it answers.

    Returns the contextvars Token; pass it to ``reset_current_question_id``.
    """
    return _current_question_id.set(question_id)


def reset_current_question_id(token) -> None:
    _current_question_id.reset(token)


def org_id_for_db(db_name: str) -> int | None:
    """The org that owns tenant brain ``db_name`` (via tenant_databases), or None.

    Lets the comprehend driver bind usage to the right org from the tenant DB it
    was handed, even on the scheduled/CLI path where no request set the org."""
    if not db_name:
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT org_id FROM tenant_databases WHERE db_name = %s LIMIT 1;",
            (db_name,),
        )
        row = cur.fetchone()
    return row[0] if row else None


def resolve_mailbox_user(org_id: int, mailbox: str) -> int | None:
    """The member of ``org_id`` whose login email IS ``mailbox`` (case-insensitive).

    Returns their user id so a mailbox that belongs to a team member folds its
    ingestion cost into that person's row; None for a shared/ops mailbox nobody
    signs in as (it then shows on its own, labelled by address)."""
    if not mailbox:
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id
            FROM users u
            JOIN memberships m ON m.user_id = u.id
            WHERE m.org_id = %s AND lower(u.email) = lower(%s)
            LIMIT 1;
            """,
            (org_id, mailbox),
        )
        row = cur.fetchone()
    return row[0] if row else None


# --- price book -------------------------------------------------------------

@dataclass(frozen=True)
class Price:
    id: int
    model: str
    currency: str
    input_price_per_mtok: Decimal
    output_price_per_mtok: Decimal


def price_at(cur, model: str, at: datetime) -> Price | None:
    """The price in effect for ``model`` at instant ``at`` (latest effective_from
    not after ``at``). Uses an existing cursor so it can share a transaction."""
    cur.execute(
        """
        SELECT id, model, currency, input_price_per_mtok, output_price_per_mtok
        FROM llm_model_prices
        WHERE model = %s AND effective_from <= %s
        ORDER BY effective_from DESC
        LIMIT 1;
        """,
        (model, at),
    )
    row = cur.fetchone()
    if not row:
        return None
    return Price(row[0], row[1], row[2], Decimal(row[3]), Decimal(row[4]))


def list_prices() -> list[tuple]:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT model, currency, input_price_per_mtok, output_price_per_mtok,
                   effective_from, note
            FROM llm_model_prices
            ORDER BY model, effective_from DESC;
            """
        )
        return cur.fetchall()


# --- price sheet (prices.yaml) -> dated price history ------------------------

# Sync is lazy + cheap: we only diff the YAML against the DB when the file's
# mtime changes, and guard it so concurrent LLM calls sync at most once.
_sync_lock = threading.Lock()
_last_synced_mtime: float | None = None


def read_price_sheet() -> dict:
    """Parse prices.yaml -> {currency, models:{model:{input,output}}}. Returns an
    empty sheet (never raises) if the file is missing or malformed."""
    try:
        raw = yaml.safe_load(_PRICES_FILE.read_text()) or {}
    except (OSError, yaml.YAMLError):
        return {"currency": "USD", "models": {}}
    return {
        "currency": raw.get("currency", "USD"),
        "models": raw.get("models", {}) or {},
    }


def sync_prices_from_yaml() -> int:
    """Append a new dated price-history row for every model whose price in
    prices.yaml differs from its latest row in the DB (or has no row yet).

    Unchanged prices are skipped, so this is idempotent — running it twice in a
    row records nothing the second time. Returns how many new rows were written.
    Existing history is never modified, only appended to.
    """
    sheet = read_price_sheet()
    currency = sheet["currency"]
    models = sheet["models"]
    if not models:
        return 0
    now = _now()
    changed = 0
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            for model, p in models.items():
                try:
                    inp = Decimal(str(p["input"]))
                    outp = Decimal(str(p["output"]))
                except (KeyError, TypeError, ValueError):
                    continue  # skip a malformed entry rather than break the rest
                latest = price_at(cur, model, now)
                if (
                    latest is not None
                    and latest.input_price_per_mtok == inp
                    and latest.output_price_per_mtok == outp
                    and latest.currency == currency
                ):
                    continue  # already current — no new row
                cur.execute(
                    """
                    INSERT INTO llm_model_prices
                        (model, currency, input_price_per_mtok, output_price_per_mtok,
                         effective_from, note)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (model, effective_from) DO UPDATE
                        SET currency = EXCLUDED.currency,
                            input_price_per_mtok = EXCLUDED.input_price_per_mtok,
                            output_price_per_mtok = EXCLUDED.output_price_per_mtok,
                            note = EXCLUDED.note;
                    """,
                    (model, currency, inp, outp, now, "synced from prices.yaml"),
                )
                changed += 1
        conn.commit()
    return changed


def _ensure_prices_synced() -> None:
    """Sync prices.yaml -> history before pricing a call, but only re-diff when
    the file actually changed (mtime). Cheap to call on every LLM call."""
    global _last_synced_mtime
    try:
        mtime = _PRICES_FILE.stat().st_mtime
    except OSError:
        return  # no price sheet on disk; fall back to whatever's already in the DB
    if _last_synced_mtime == mtime:
        return
    with _sync_lock:
        if _last_synced_mtime == mtime:
            return
        sync_prices_from_yaml()
        _last_synced_mtime = mtime


# --- cost arithmetic --------------------------------------------------------

def _cost(tokens: int, price_per_mtok: Decimal) -> Decimal:
    """Exact cost for ``tokens`` at a per-million-token price."""
    return (Decimal(int(tokens)) / _MILLION) * price_per_mtok


# --- the chokepoint ---------------------------------------------------------

def record_llm_usage(
    *,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    org_id: int | None = None,
    user_id: int | None = None,
    agent_name: str | None = None,
    request_kind: str | None = None,
    occurred_at: datetime | None = None,
    response_model: str | None = None,
    request_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict:
    """Record one LLM API call and its accurate, point-in-time cost.

    ``input_cost`` / ``output_cost`` / ``total_cost`` are computed from the
    effective-dated price book, input and output priced separately, and frozen
    into the row at write time so later price changes never rewrite history.

    Looks up the price effective at ``occurred_at`` for ``model``. If no price
    exists yet, tokens are still recorded (computed cost 0, ``price_id`` NULL,
    ``meta.price_missing = true``); ``recost_unpriced`` fills it in later.

    ``org_id`` defaults to the ambient context org (``set_current_org``).
    Returns the costed record as a dict.
    """
    # Pick up any edits to prices.yaml first, so this call's timestamp lands at
    # or after the new dated row and it prices against the latest sheet.
    _ensure_prices_synced()
    at = occurred_at or _now()
    if org_id is None:
        org_id = current_org()
    if user_id is None:
        user_id = current_user_id()
    prompt_tokens = int(prompt_tokens or 0)
    completion_tokens = int(completion_tokens or 0)
    total_tokens = prompt_tokens + completion_tokens

    row_meta: dict[str, Any] = dict(meta or {})
    if response_model and response_model != model:
        row_meta["response_model"] = response_model
    if request_id:
        row_meta["request_id"] = request_id
    # Trace ingestion cost back to the mailbox it came from. Stamped even when
    # the mailbox resolves to a member (user_id set), so the provenance survives.
    source_mailbox = _current_source_mailbox.get()
    if source_mailbox and "source_mailbox" not in row_meta:
        row_meta["source_mailbox"] = source_mailbox
    # Trace Q&A synthesis cost back to the saved question (cross-DB join key for
    # the Ask observability table — see qa_cost_by_question).
    question_id = _current_question_id.get()
    if question_id is not None and "question_id" not in row_meta:
        row_meta["question_id"] = question_id

    with get_control_connection() as conn:
        with conn.cursor() as cur:
            price = price_at(cur, model, at)
            if price is None:
                in_rate = out_rate = Decimal(0)
                currency = "USD"
                price_id = None
                row_meta["price_missing"] = True
            else:
                in_rate = price.input_price_per_mtok
                out_rate = price.output_price_per_mtok
                currency = price.currency
                price_id = price.id

            input_cost = _cost(prompt_tokens, in_rate)
            output_cost = _cost(completion_tokens, out_rate)
            total_cost = input_cost + output_cost

            cur.execute(
                """
                INSERT INTO llm_usage_events
                    (org_id, user_id, agent_name, occurred_at, model, request_kind,
                     prompt_tokens, completion_tokens, total_tokens,
                     price_id, currency, input_price_per_mtok, output_price_per_mtok,
                     input_cost, output_cost, total_cost, meta)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (
                    org_id, user_id, agent_name, at, model, request_kind,
                    prompt_tokens, completion_tokens, total_tokens,
                    price_id, currency, in_rate, out_rate,
                    input_cost, output_cost, total_cost, Jsonb(row_meta),
                ),
            )
            event_id = cur.fetchone()[0]
        conn.commit()

    return {
        "id": event_id,
        "org_id": org_id,
        "user_id": user_id,
        "agent_name": agent_name,
        "model": model,
        "request_kind": request_kind,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "currency": currency,
        "input_price_per_mtok": in_rate,
        "output_price_per_mtok": out_rate,
        "input_cost": input_cost,
        "output_cost": output_cost,
        "total_cost": total_cost,
        "priced": price_id is not None,
    }


def record_safe(**kwargs) -> dict | None:
    """``record_llm_usage`` that never raises — metering must not break an LLM
    call. On any failure (e.g. control DB unreachable) it logs and returns None."""
    try:
        return record_llm_usage(**kwargs)
    except Exception as exc:  # noqa: BLE001 — observability must not crash callers
        import logging

        logging.getLogger(__name__).warning("LLM metering failed: %s", exc)
        return None


def recost_unpriced() -> int:
    """Re-price events recorded before their model's price existed.

    For every ``llm_usage_events`` row with ``price_id IS NULL``, find the price
    now effective at that row's ``occurred_at`` and recompute its cost in place.
    Returns the number of rows updated. Point-in-time is preserved: each row is
    priced as of when its call actually happened, not now.
    """
    updated = 0
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, model, occurred_at, prompt_tokens, completion_tokens
                FROM llm_usage_events
                WHERE price_id IS NULL
                ORDER BY occurred_at;
                """
            )
            rows = cur.fetchall()
            for event_id, model, occurred_at, ptoks, ctoks in rows:
                price = price_at(cur, model, occurred_at)
                if price is None:
                    continue
                input_cost = _cost(ptoks, price.input_price_per_mtok)
                output_cost = _cost(ctoks, price.output_price_per_mtok)
                cur.execute(
                    """
                    UPDATE llm_usage_events
                    SET price_id = %s, currency = %s,
                        input_price_per_mtok = %s, output_price_per_mtok = %s,
                        input_cost = %s, output_cost = %s, total_cost = %s,
                        meta = (meta - 'price_missing')
                    WHERE id = %s;
                    """,
                    (
                        price.id, price.currency,
                        price.input_price_per_mtok, price.output_price_per_mtok,
                        input_cost, output_cost, input_cost + output_cost,
                        event_id,
                    ),
                )
                updated += 1
        conn.commit()
    return updated


# --- credits ----------------------------------------------------------------

def grant_credits(
    org_id: int,
    amount: float | str | Decimal,
    *,
    kind: str = "grant",
    currency: str = "USD",
    actor: str | None = None,
    note: str | None = None,
) -> int:
    """Add a credit entry (kind: 'grant' | 'setup' | 'adjustment'). Positive
    ``amount`` adds credit. Returns the entry id."""
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO credit_entries (org_id, kind, amount, currency, actor, note)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (org_id, kind, Decimal(str(amount)), currency, actor, note),
            )
            entry_id = cur.fetchone()[0]
        conn.commit()
    return entry_id


def balance(org_id: int) -> dict:
    """Current credit balance for an org: granted, spent, remaining."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT credits_granted, credits_spent, balance FROM org_credit_balance WHERE org_id = %s;",
            (org_id,),
        )
        row = cur.fetchone()
    granted, spent, bal = (row or (Decimal(0), Decimal(0), Decimal(0)))
    return {
        "org_id": org_id,
        "credits_granted": Decimal(granted or 0),
        "credits_spent": Decimal(spent or 0),
        "balance": Decimal(bal or 0),
    }


def usage_summary(org_id: int | None = None) -> dict:
    """Aggregate usage: calls, input/output tokens, and cost (optionally for one
    org). Returns also a per-model breakdown."""
    where = "WHERE org_id = %s" if org_id is not None else ""
    params = (org_id,) if org_id is not None else ()
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COUNT(*), COALESCE(SUM(prompt_tokens), 0),
                   COALESCE(SUM(completion_tokens), 0),
                   COALESCE(SUM(input_cost), 0), COALESCE(SUM(output_cost), 0),
                   COALESCE(SUM(total_cost), 0)
            FROM llm_usage_events {where};
            """,
            params,
        )
        calls, ptoks, ctoks, in_cost, out_cost, tot_cost = cur.fetchone()
        cur.execute(
            f"""
            SELECT model, COUNT(*), COALESCE(SUM(prompt_tokens), 0),
                   COALESCE(SUM(completion_tokens), 0), COALESCE(SUM(total_cost), 0)
            FROM llm_usage_events {where}
            GROUP BY model ORDER BY SUM(total_cost) DESC;
            """,
            params,
        )
        by_model = [
            {
                "model": m, "calls": c, "prompt_tokens": pt,
                "completion_tokens": ct, "total_cost": Decimal(tc),
            }
            for m, c, pt, ct, tc in cur.fetchall()
        ]
    return {
        "org_id": org_id,
        "calls": calls,
        "prompt_tokens": ptoks,
        "completion_tokens": ctoks,
        "input_cost": Decimal(in_cost),
        "output_cost": Decimal(out_cost),
        "total_cost": Decimal(tot_cost),
        "by_model": by_model,
    }


def credit_timeseries(org_id: int, *, granularity: str = "day", periods: int | None = None) -> list[dict]:
    """Per-period credit spend and end-of-period remaining balance (RAW units).

    Returns a gap-filled series, oldest → newest:
        [{"period_start": date, "spent": Decimal, "remaining": Decimal}, ...]

    ``spent`` is the credits consumed within the period; ``remaining`` is the
    running balance (cumulative grants − cumulative spend) at the END of the
    period. ``granularity`` is 'day' or 'week'. ``periods`` caps how many of the
    most recent buckets to return (default: 60 days / 26 weeks). Figures are RAW
    USD; the API marks them up before they reach a customer.
    """
    week = granularity == "week"
    trunc = "week" if week else "day"
    step = timedelta(weeks=1) if week else timedelta(days=1)
    if periods is None:
        periods = 26 if week else 60

    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT date_trunc('{trunc}', occurred_at)::date AS period,
                   COALESCE(SUM(total_cost), 0)
            FROM llm_usage_events WHERE org_id = %s
            GROUP BY 1 ORDER BY 1;
            """,
            (org_id,),
        )
        spend_by_period = {p: Decimal(v) for p, v in cur.fetchall()}
        cur.execute(
            f"""
            SELECT date_trunc('{trunc}', occurred_at)::date AS period,
                   COALESCE(SUM(amount), 0)
            FROM credit_entries WHERE org_id = %s
            GROUP BY 1 ORDER BY 1;
            """,
            (org_id,),
        )
        grant_by_period = {p: Decimal(v) for p, v in cur.fetchall()}

    if not spend_by_period and not grant_by_period:
        return []

    # Build a continuous spine from the earliest activity to the current period.
    starts = list(spend_by_period) + list(grant_by_period)
    first = min(starts)
    today = _now().date()
    last = today - timedelta(days=today.weekday()) if week else today  # Monday-anchored weeks

    spine: list = []
    cursor = first
    while cursor <= last:
        spine.append(cursor)
        cursor = cursor + step

    series: list[dict] = []
    cum_grant = Decimal(0)
    cum_spend = Decimal(0)
    for period in spine:
        cum_grant += grant_by_period.get(period, Decimal(0))
        spent = spend_by_period.get(period, Decimal(0))
        cum_spend += spent
        series.append({
            "period_start": period,
            "spent": spent,
            "remaining": cum_grant - cum_spend,
        })

    return series[-periods:]


# --------------------------------------------------------------------------
#  Credit limit: a HARD ceiling enforced BEFORE each LLM call.
#
#  Tracking (the ledger) tells you what was spent; this stops you spending more.
#  The chokepoint checks the org's spend against its ``credit_limit`` before a
#  call fires — if the org is at/over the limit the call never happens. The
#  worst-case overshoot is bounded to a single in-flight call (fractions of a
#  cent), so a runaway backfill can't blow the budget.
# --------------------------------------------------------------------------
class CreditLimitExceeded(RuntimeError):
    """Raised to BLOCK an LLM call because the org is out of prepaid credits.

    ``limit`` carries the org's total granted credits (the only ceiling now —
    you can spend exactly what you funded, no more). Kept named for the call
    sites that already catch it (src/ingestion/runner.py stops the batch cleanly).
    """

    def __init__(self, org_id: int, spent: Decimal, limit: Decimal):
        self.org_id = org_id
        self.spent = spent
        self.limit = limit
        super().__init__(
            f"org {org_id} is out of credits "
            f"(spent {spent} >= granted {limit}); LLM call blocked."
        )


def get_credit_limit(org_id: int) -> Decimal | None:
    """The org's hard credit ceiling, or None if uncapped."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT credit_limit FROM organizations WHERE id = %s;", (org_id,))
        row = cur.fetchone()
    if not row or row[0] is None:
        return None
    return Decimal(row[0])


def set_credit_limit(org_id: int, amount: float | str | Decimal | None) -> None:
    """Set (or clear, with None) the org's hard credit ceiling."""
    value = None if amount is None else Decimal(str(amount))
    if value is not None and value < 0:
        raise ValueError("credit_limit must be >= 0 (or None to remove the cap).")
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE organizations SET credit_limit = %s WHERE id = %s;",
                (value, org_id),
            )
            if cur.rowcount == 0:
                raise ValueError(f"no organization with id {org_id}.")
        conn.commit()


def credit_status(org_id: int) -> dict:
    """Spend vs. limit for an org: limit, spent, headroom, fraction used, alerts.

    ``alert`` is None / 'warn' (>=80%) / 'over' (>=100%) — what the Admin Center
    surfaces. With no limit set, alert is None and headroom is None (uncapped).
    """
    spent = balance(org_id)["credits_spent"]
    limit = get_credit_limit(org_id)
    if limit is None:
        return {
            "org_id": org_id, "limit": None, "spent": spent,
            "headroom": None, "fraction_used": None, "alert": None,
        }
    headroom = limit - spent
    fraction = (spent / limit) if limit > 0 else Decimal(1)
    alert = "over" if fraction >= 1 else ("warn" if fraction >= Decimal("0.8") else None)
    return {
        "org_id": org_id, "limit": limit, "spent": spent,
        "headroom": headroom, "fraction_used": fraction, "alert": alert,
    }


def _audit_credit_block(org_id: int, spent: Decimal, granted: Decimal) -> None:
    """Record the FIRST blocked call at this funding level, then stay quiet.

    enforce_credit_limit fires on every blocked call, but we only want one
    audit event per "episode" — i.e. per funding level. We key the dedup on
    ``granted``: while an org sits over its limit every block finds the existing
    row and skips; once an admin tops up (``granted`` rises) the next block is a
    genuinely new episode and logs again. The INSERT...WHERE NOT EXISTS makes
    that atomic. Best-effort: auditing must never turn a clean block into a crash.
    """
    granted_s = str(granted)
    try:
        with get_control_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_log (org_id, actor, action, detail)
                    SELECT %s, 'system', 'credit_limit_reached', %s
                    WHERE NOT EXISTS (
                        SELECT 1 FROM audit_log
                        WHERE org_id = %s
                          AND action = 'credit_limit_reached'
                          AND detail->>'granted' = %s
                    );
                    """,
                    (
                        org_id,
                        Jsonb({"granted": granted_s, "spent": str(spent)}),
                        org_id,
                        granted_s,
                    ),
                )
            conn.commit()
    except Exception as exc:  # auditing must not wedge enforcement
        print(f"[billing] credit-limit audit skipped (error): {exc!r}")


def enforce_credit_limit(
    org_id: int | None = None, estimated_cost: Decimal | None = None
) -> None:
    """Raise ``CreditLimitExceeded`` if the org has no prepaid credits left.

    The ONLY ceiling is what the workspace funded: you can spend exactly the
    credits you bought (``granted``), never more. When ``spent`` reaches
    ``granted`` the next LLM call is blocked, so a workspace that runs out is
    paused automatically (the batch processor catches this and stops cleanly).

    Call this BEFORE an LLM call fires. ``org_id`` defaults to the ambient
    context org (``set_current_org``); with no org in context (system usage)
    enforcement is skipped. ``estimated_cost`` optionally tightens the check so
    a call that *would* push spend over the funded amount is blocked too.
    Fail-OPEN on a DB hiccup: a metering outage must not wedge the product —
    but a real out-of-credits state blocks.
    """
    if org_id is None:
        org_id = current_org()
    if org_id is None:
        return  # no org context → system usage, not metered against a balance
    try:
        b = balance(org_id)
    except Exception as exc:  # pragma: no cover - DB hiccup: fail open
        print(f"[billing] credit check skipped (error): {exc!r}")
        return
    granted = b["credits_granted"]
    projected = b["credits_spent"] + (estimated_cost or Decimal(0))
    if projected >= granted:
        _audit_credit_block(org_id, b["credits_spent"], granted)
        raise CreditLimitExceeded(org_id, b["credits_spent"], granted)


# --------------------------------------------------------------------------
#  Backfill cost estimator.
#
#  Internal planning tool — projects what a historical backfill will cost so we
#  can fund the credit grant before running it. Deliberately conservative:
#
#    quote = (cheapest model's token cost) x ESTIMATE_MARKUP
#
#  ESTIMATE_MARKUP (10x) is the single all-in factor. It both buffers the
#  estimate (model-mix, comprehend fan-out, retries, token undercount) AND
#  carries our markup — it is NOT compounded with any further margin. We base it
#  on the CHEAPEST model in the price book on purpose: real spend can only be at
#  or above that floor, and 10x over the floor is a comfortable ceiling.
#
#  The breakdown (which model, raw cost, the 10x) is INTERNAL ONLY. Anything
#  customer-facing exposes the final number alone — never our cost or markup.
# --------------------------------------------------------------------------
ESTIMATE_MARKUP = Decimal(10)
# When output token count is unknown, assume this much output per input token.
_DEFAULT_OUTPUT_RATIO = Decimal("0.5")

# --------------------------------------------------------------------------
#  Customer-facing markup.
#
#  THE single source of truth for what a customer sees vs. what we actually pay.
#  Reuses the estimator's all-in factor so a backfill quote and the live spend
#  it turns into stay consistent.
#
#  Internal storage is ALWAYS raw (our true cost): the llm_usage_events ledger,
#  credit_entries, organizations.credit_limit, and the hard-cap enforcement all
#  work in raw units. The markup lives ONLY at the customer API boundary —
#  multiply raw->customer on the way out, divide customer->raw on the way in.
#  That keeps our books honest and means a customer never sees raw cost, the
#  markup factor, or which model we ran.
# --------------------------------------------------------------------------
CUSTOMER_MARKUP = ESTIMATE_MARKUP

# Bounds on a per-workspace override, so the operator can't set 0 (everything
# free) or a runaway multiplier by fat-finger.
MIN_MARKUP = Decimal("1")
MAX_MARKUP = Decimal("1000")


def _resolve_factor(factor: Decimal | int | float | None) -> Decimal:
    """The effective markup: a per-workspace override when given, else the
    global default. Callers pass ``markup_for(org_id)`` to honour per-org pricing."""
    return CUSTOMER_MARKUP if factor is None else Decimal(factor)


def to_customer_facing(
    amount: Decimal | None, factor: Decimal | int | float | None = None
) -> Decimal | None:
    """Raw internal cost/credit -> the marked-up figure shown to a customer.

    ``factor`` overrides the global markup for a specific workspace (see
    ``markup_for``); omit it for the default."""
    return None if amount is None else Decimal(amount) * _resolve_factor(factor)


def from_customer_facing(
    amount: Decimal | None, factor: Decimal | int | float | None = None
) -> Decimal | None:
    """A customer-supplied figure (e.g. dollars they fund) -> raw units. Uses the
    workspace's ``factor`` when given, else the global default."""
    return None if amount is None else Decimal(amount) / _resolve_factor(factor)


def markup_for(org_id: int) -> Decimal:
    """This workspace's effective customer markup: its ``markup_factor`` override
    if set, otherwise the global ``CUSTOMER_MARKUP``. One cheap control-plane read;
    callers fetch it once per request and pass it to to_/from_customer_facing."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT markup_factor FROM organizations WHERE id = %s;", (org_id,))
        row = cur.fetchone()
    if row and row[0] is not None:
        return Decimal(row[0])
    return CUSTOMER_MARKUP


def set_markup(org_id: int, factor: Decimal | int | float | None) -> Decimal:
    """Set (or clear) a workspace's customer markup override. ``None`` clears it
    back to the global default. Returns the effective factor after the change.

    Validates the factor is within [MIN_MARKUP, MAX_MARKUP]. This only changes the
    customer-facing multiplier — internal raw storage (spend, grants, the credit
    ceiling) is untouched — so it re-prices what this workspace SEES, including
    historical figures (storage is raw). Set it before funding, change with care.
    """
    if factor is not None:
        factor = Decimal(factor)
        if not (MIN_MARKUP <= factor <= MAX_MARKUP):
            raise ValueError(
                f"markup must be between {MIN_MARKUP} and {MAX_MARKUP} (got {factor})."
            )
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE organizations SET markup_factor = %s WHERE id = %s;",
            (factor, org_id),
        )
        if cur.rowcount == 0:
            raise ValueError(f"No organization with id {org_id}.")
        conn.commit()
    return CUSTOMER_MARKUP if factor is None else factor


@dataclass
class BackfillEstimate:
    """A backfill cost projection. ``customer_quote`` is the only public number."""

    input_tokens: int
    output_tokens: int
    basis_model: str
    basis_input_per_mtok: Decimal
    basis_output_per_mtok: Decimal
    raw_cost: Decimal          # what the cheapest model's tokens would cost us
    markup: Decimal            # the all-in factor applied (ESTIMATE_MARKUP)
    customer_quote: Decimal    # raw_cost * markup — the figure we quote/charge


def cheapest_model_price() -> tuple[str, Decimal, Decimal]:
    """The cheapest currently-effective model in the price book.

    Cheapest by input price (the dominant cost for comprehension). Returns
    (model, input_per_mtok, output_per_mtok). Raises if no prices exist.
    """
    now = _now()
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT model FROM llm_model_prices;")
        models = [r[0] for r in cur.fetchall()]
        best: tuple[str, Decimal, Decimal] | None = None
        for model in models:
            price = price_at(cur, model, now)
            if price is None:
                continue
            if best is None or price.input_price_per_mtok < best[1]:
                best = (model, price.input_price_per_mtok, price.output_price_per_mtok)
    if best is None:
        raise RuntimeError(
            "no prices in the price book — run `python -m src.billing sync` first."
        )
    return best


def estimate_backfill(
    input_tokens: int, output_tokens: int | None = None
) -> BackfillEstimate:
    """Project a backfill's cost from token counts, conservatively (10x cheapest).

    ``input_tokens`` = total prompt tokens the backfill will process (count the
    fetched mail locally before comprehension). ``output_tokens`` defaults to a
    fraction of input when unknown. The returned ``customer_quote`` is the
    only figure to ever show a customer.
    """
    if output_tokens is None:
        output_tokens = int(Decimal(input_tokens) * _DEFAULT_OUTPUT_RATIO)
    model, in_rate, out_rate = cheapest_model_price()
    raw_cost = _cost(input_tokens, in_rate) + _cost(output_tokens, out_rate)
    return BackfillEstimate(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        basis_model=model,
        basis_input_per_mtok=in_rate,
        basis_output_per_mtok=out_rate,
        raw_cost=raw_cost,
        markup=ESTIMATE_MARKUP,
        customer_quote=raw_cost * ESTIMATE_MARKUP,
    )


# --------------------------------------------------------------------------
#  Per-item pipeline cost model (the "≈ N emails / N files" estimate).
#
#  Filling the brain is NOT a single comprehend pass. For each ingested item the
#  comprehend pipeline (src/ingestion/comprehend/pipeline.py) fans out into many LLM calls,
#  and crucially EACH call re-reads the full item text:
#
#    1 IdentifierAgent call          (reads the whole item once)
#    + PER ENTITY found, 4 agents:   attribute, relationship, description, timeline
#      (each re-reads the whole item text again)
#
#  So total LLM calls per item = 1 + PIPELINE_CALLS_PER_ENTITY * entities, and
#  because the body is resent every call, input tokens ≈ body_tokens * calls.
#  That fan-out — not the body size alone — dominates the cost. Embeddings are
#  LOCAL (fastembed) and free; canonicalization is deterministic and free.
#
#  These constants are deliberately rough (shown as "≈" in the UI) and TUNABLE:
#  once we ingest the pilot's real corpus we should re-fit entities-per-item and
#  body sizes against measured ledger spend.
# --------------------------------------------------------------------------
PIPELINE_CALLS_PER_ENTITY = 4          # attribute + relationship + description + timeline
AVG_OUTPUT_TOKENS_PER_CALL = 180       # small JSON / few-sentence replies, averaged

# One translation pass precedes comprehension for non-English email (the brain
# is English-only). It reads the body once (input ≈ body) and emits a full
# English rendering of similar length (output ≈ body) — unlike the other agents'
# short replies. Included in the per-item estimate as the upper bound (it only
# fires for German mail; English mail skips it).
TRANSLATION_OUTPUT_RATIO = 1.0         # translated length ≈ source length

AVG_BODY_TOKENS_PER_EMAIL = 2000       # a typical email body
AVG_ENTITIES_PER_EMAIL = 4             # people/companies/projects named per email

AVG_BODY_TOKENS_PER_FILE = 12000       # a typical document (~6x an email)
AVG_ENTITIES_PER_FILE = 8              # documents name more entities


def _pipeline_tokens(body_tokens: int, entities: int) -> tuple[int, int]:
    """(input_tokens, output_tokens) to run the full pipeline on one item.

    calls = 1 identifier + 4 per entity; the item body is re-read every call,
    so input scales with the number of calls, not just the body size.
    """
    calls = 1 + PIPELINE_CALLS_PER_ENTITY * entities
    input_tokens = body_tokens * calls
    output_tokens = AVG_OUTPUT_TOKENS_PER_CALL * calls
    # Pre-comprehension translation pass (German mail): reads the body once and
    # emits a same-length English rendering. Added as the estimate's upper bound.
    input_tokens += body_tokens
    output_tokens += int(body_tokens * TRANSLATION_OUTPUT_RATIO)
    return input_tokens, output_tokens


def customer_cost_per_item(
    body_tokens: int, entities: int, factor: Decimal | int | float | None = None
) -> Decimal:
    """Customer-facing (marked-up) cost of fully processing one item.

    Prices the whole pipeline fan-out off the cheapest model, then applies the
    customer markup — the workspace's ``factor`` override when given (see
    ``markup_for``), else the global default — consistent with live spend.
    """
    in_tok, out_tok = _pipeline_tokens(body_tokens, entities)
    _model, in_rate, out_rate = cheapest_model_price()
    raw_cost = _cost(in_tok, in_rate) + _cost(out_tok, out_rate)
    return raw_cost * _resolve_factor(factor)


def customer_cost_per_email(factor: Decimal | int | float | None = None) -> Decimal:
    """Customer-facing cost of fully processing one average email."""
    return customer_cost_per_item(AVG_BODY_TOKENS_PER_EMAIL, AVG_ENTITIES_PER_EMAIL, factor)


def customer_cost_per_file(factor: Decimal | int | float | None = None) -> Decimal:
    """Customer-facing cost of fully processing one average document."""
    return customer_cost_per_item(AVG_BODY_TOKENS_PER_FILE, AVG_ENTITIES_PER_FILE, factor)


def capacity_for(
    customer_budget: Decimal | None, factor: Decimal | int | float | None = None
) -> dict:
    """Roughly how many more emails / files a customer-facing budget covers.

    ``customer_budget`` is the already-marked-up figure (e.g. remaining headroom
    as the customer sees it); ``factor`` must be the SAME markup used to compute
    it, so numerator and denominator share a factor and the ratio stays
    markup-invariant. Returns None for an unknown (uncapped) budget.
    """
    if customer_budget is None:
        return {"emails": None, "files": None}
    if customer_budget <= 0:
        return {"emails": 0, "files": 0}
    per_email = customer_cost_per_email(factor)
    per_file = customer_cost_per_file(factor)
    return {
        "emails": int(customer_budget / per_email) if per_email > 0 else None,
        "files": int(customer_budget / per_file) if per_file > 0 else None,
    }


def usage_by_user(org_id: int, *, since: datetime | None = None) -> list[dict]:
    """Per-member cost breakdown for one org, sorted by spend descending.

    Identity is the team member when known (``user_id``) — their Q&A and any
    ingestion from a mailbox they own fold into one row. A mailbox nobody signs
    in as keeps its own row, labelled by address (``source_mailbox``, user_id
    NULL). ``since`` clips to usage on/after that instant (the selected horizon).
    Costs are raw internal values; callers apply to_customer_facing() if needed.
    """
    params: list[Any] = [org_id]
    where = "e.org_id = %s"
    if since is not None:
        where += " AND e.occurred_at >= %s"
        params.append(since)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                e.user_id,
                CASE WHEN e.user_id IS NULL THEN e.meta->>'source_mailbox' END AS source_mailbox,
                u.email,
                u.display_name,
                COUNT(*)                              AS calls,
                COALESCE(SUM(e.prompt_tokens), 0)     AS prompt_tokens,
                COALESCE(SUM(e.completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(e.total_cost), 0)        AS total_cost,
                -- Brain *egress* (user-facing inference: Q&A + Delivery) groups
                -- together; ingestion is everything else (comprehension, etc.).
                COALESCE(SUM(CASE WHEN e.request_kind IN ('qa', 'delivery', 'delivery_draft')
                               THEN e.total_cost ELSE 0 END), 0) AS qa_cost,
                COALESCE(SUM(CASE WHEN e.request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR e.request_kind IS NULL
                               THEN e.total_cost ELSE 0 END), 0) AS ingestion_cost,
                COALESCE(SUM(CASE WHEN e.request_kind IN ('qa', 'delivery', 'delivery_draft')
                               THEN e.prompt_tokens + e.completion_tokens ELSE 0 END), 0) AS qa_tokens,
                COALESCE(SUM(CASE WHEN e.request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR e.request_kind IS NULL
                               THEN e.prompt_tokens + e.completion_tokens ELSE 0 END), 0) AS ingestion_tokens
            FROM llm_usage_events e
            LEFT JOIN users u ON u.id = e.user_id
            WHERE {where}
            GROUP BY e.user_id,
                     (CASE WHEN e.user_id IS NULL THEN e.meta->>'source_mailbox' END),
                     u.email, u.display_name
            ORDER BY total_cost DESC;
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [
        {
            "user_id": r[0],
            "source_mailbox": r[1],
            "email": r[2],
            "display_name": r[3],
            "calls": r[4],
            "prompt_tokens": int(r[5]),
            "completion_tokens": int(r[6]),
            "total_cost": str(Decimal(r[7])),
            "qa_cost": str(Decimal(r[8])),
            "ingestion_cost": str(Decimal(r[9])),
            "qa_tokens": int(r[10]),
            "ingestion_tokens": int(r[11]),
        }
        for r in rows
    ]


def usage_by_org_and_user(*, since: datetime | None = None) -> list[dict]:
    """Platform-level per-(org, member) cost breakdown across all orgs.

    Same merged identity as ``usage_by_user`` (member when known, else the
    capturing mailbox by address). Sorted by org slug then spend descending.
    ``since`` clips to usage on/after that instant. Costs are raw internal
    values (not marked up) — intended for the platform owner only.
    """
    params: list[Any] = []
    where = ""
    if since is not None:
        where = "WHERE e.occurred_at >= %s"
        params.append(since)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                o.id                                  AS org_id,
                o.slug                                AS org_slug,
                o.name                                AS org_name,
                e.user_id,
                CASE WHEN e.user_id IS NULL THEN e.meta->>'source_mailbox' END AS source_mailbox,
                u.email,
                u.display_name,
                COUNT(*)                              AS calls,
                COALESCE(SUM(e.prompt_tokens), 0)     AS prompt_tokens,
                COALESCE(SUM(e.completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(e.total_cost), 0)        AS total_cost,
                -- Brain *egress* (user-facing inference: Q&A + Delivery) groups
                -- together; ingestion is everything else (comprehension, etc.).
                COALESCE(SUM(CASE WHEN e.request_kind IN ('qa', 'delivery', 'delivery_draft')
                               THEN e.total_cost ELSE 0 END), 0) AS qa_cost,
                COALESCE(SUM(CASE WHEN e.request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR e.request_kind IS NULL
                               THEN e.total_cost ELSE 0 END), 0) AS ingestion_cost,
                COALESCE(SUM(CASE WHEN e.request_kind IN ('qa', 'delivery', 'delivery_draft')
                               THEN e.prompt_tokens + e.completion_tokens ELSE 0 END), 0) AS qa_tokens,
                COALESCE(SUM(CASE WHEN e.request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR e.request_kind IS NULL
                               THEN e.prompt_tokens + e.completion_tokens ELSE 0 END), 0) AS ingestion_tokens
            FROM llm_usage_events e
            JOIN organizations o ON o.id = e.org_id
            LEFT JOIN users u ON u.id = e.user_id
            {where}
            GROUP BY o.id, o.slug, o.name, e.user_id,
                     (CASE WHEN e.user_id IS NULL THEN e.meta->>'source_mailbox' END),
                     u.email, u.display_name
            ORDER BY o.slug, total_cost DESC;
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [
        {
            "org_id": r[0],
            "org_slug": r[1],
            "org_name": r[2],
            "user_id": r[3],
            "source_mailbox": r[4],
            "email": r[5],
            "display_name": r[6],
            "calls": r[7],
            "prompt_tokens": int(r[8]),
            "completion_tokens": int(r[9]),
            "total_cost": str(Decimal(r[10])),
            "qa_cost": str(Decimal(r[11])),
            "ingestion_cost": str(Decimal(r[12])),
            "qa_tokens": int(r[13]),
            "ingestion_tokens": int(r[14]),
        }
        for r in rows
    ]


def usage_timeseries(org_id: int | None = None, *, days: int = 30) -> list[dict]:
    """Daily ingestion-vs-Q&A cost and tokens for the trailing ``days`` window.

    Gap-filled, oldest → newest, one row per calendar day:
        [{"period_start": "YYYY-MM-DD", "ingestion_cost", "qa_cost",
          "ingestion_tokens", "qa_tokens"}, ...]

    ``org_id`` None aggregates every org (platform owner view); otherwise scopes
    to that one workspace. Costs are RAW internal values (string Decimals); the
    API marks them up before they reach a customer. The frontend re-buckets days
    into weeks itself, so this only ever returns daily granularity.
    """
    since = _now() - timedelta(days=days)
    params: list[Any] = [since]
    where = "occurred_at >= %s"
    if org_id is not None:
        where += " AND org_id = %s"
        params.append(org_id)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT date_trunc('day', occurred_at)::date AS period,
                   -- 'qa' bucket = brain egress (Q&A + Delivery); ingestion = rest.
                   COALESCE(SUM(CASE WHEN request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR request_kind IS NULL
                                  THEN total_cost ELSE 0 END), 0) AS ingestion_cost,
                   COALESCE(SUM(CASE WHEN request_kind IN ('qa', 'delivery', 'delivery_draft')
                                  THEN total_cost ELSE 0 END), 0) AS qa_cost,
                   COALESCE(SUM(CASE WHEN request_kind NOT IN ('qa', 'delivery', 'delivery_draft') OR request_kind IS NULL
                                  THEN total_tokens ELSE 0 END), 0) AS ingestion_tokens,
                   COALESCE(SUM(CASE WHEN request_kind IN ('qa', 'delivery', 'delivery_draft')
                                  THEN total_tokens ELSE 0 END), 0) AS qa_tokens
            FROM llm_usage_events
            WHERE {where}
            GROUP BY 1 ORDER BY 1;
            """,
            tuple(params),
        )
        by_period = {r[0]: r for r in cur.fetchall()}

    series: list[dict] = []
    cursor = since.date()
    today = _now().date()
    while cursor <= today:
        r = by_period.get(cursor)
        series.append({
            "period_start": cursor.isoformat(),
            "ingestion_cost": str(Decimal(r[1])) if r else "0",
            "qa_cost": str(Decimal(r[2])) if r else "0",
            "ingestion_tokens": int(r[3]) if r else 0,
            "qa_tokens": int(r[4]) if r else 0,
        })
        cursor += timedelta(days=1)
    return series


def qa_usage_events(org_id: int) -> list[dict]:
    """Every ``request_kind='qa'`` usage event for ``org_id``, oldest first.

    Each row: ``{question_id (int|None), occurred_at (datetime), prompt_tokens,
    completion_tokens, total_cost (str), model}``. ``question_id`` comes from the
    event's ``meta`` (stamped at answer time via ``set_current_question_id``);
    it's None for events recorded before that stamping existed. The Ask
    observability endpoint attributes each event to a question — by stamped id
    when present, else by timestamp proximity — since the question text lives in
    the tenant DB and can't be SQL-joined to this control-plane ledger. Costs are
    RAW; the API boundary marks them up.
    """
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT (meta->>'question_id')::bigint AS qid, occurred_at,
                   COALESCE(prompt_tokens, 0), COALESCE(completion_tokens, 0),
                   COALESCE(total_cost, 0), model
            FROM llm_usage_events
            WHERE org_id = %s AND request_kind = 'qa'
            ORDER BY occurred_at ASC, id ASC;
            """,
            (org_id,),
        )
        return [
            {
                "question_id": int(r[0]) if r[0] is not None else None,
                "occurred_at": r[1],
                "prompt_tokens": int(r[2]),
                "completion_tokens": int(r[3]),
                "total_cost": str(Decimal(r[4])),
                "model": r[5],
            }
            for r in cur.fetchall()
        ]


def delivery_sync_events(
    org_id: int, *, claim_times: list[tuple] | None = None,
    limit: int = 50, offset: int = 0,
) -> dict:
    """This org's Delivery *sync* events (the DeliveryAgent agenda inference),
    newest first, one row per pool refresh.

    Each row carries the member it was computed for, the model, token fan-out,
    and RAW cost (the API boundary marks it up). Document-drafting cost is a
    separate kind (``delivery_draft``) and is NOT included here.

    ``claim_times`` (``[(email, datetime)]``, the tenant's delivery_todos
    computed_at values) reclaims historical events metered before org attribution
    existed (org_id NULL): a NULL-org delivery event whose timestamp matches one
    of these within a couple of minutes almost certainly produced that pool, so
    we surface it under this tenant, labelled with the matched member. New syncs
    carry org_id directly and need no reclaiming.
    """
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    _CLAIM_WINDOW = 180  # seconds between the metered call and the pool upsert

    def _epoch(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()

    with get_control_connection() as conn, conn.cursor() as cur:
        # Events already attributed to this org.
        cur.execute(
            """
            SELECT e.occurred_at, u.email, u.display_name,
                   e.prompt_tokens, e.completion_tokens, e.total_cost, e.model, e.currency
            FROM llm_usage_events e
            LEFT JOIN users u ON u.id = e.user_id
            WHERE e.org_id = %s AND e.request_kind = 'delivery'
            ORDER BY e.occurred_at DESC, e.id DESC;
            """,
            (org_id,),
        )
        merged = [
            {
                "occurred_at": r[0], "email": r[1], "display_name": r[2],
                "prompt_tokens": int(r[3] or 0), "completion_tokens": int(r[4] or 0),
                "cost": str(Decimal(r[5] or 0)), "model": r[6],
                "currency": r[7] or "USD", "llm_calls": 1,
            }
            for r in cur.fetchall()
        ]

        # Reclaim NULL-org (system-context) events by proximity to this tenant's
        # pool timestamps — recovers syncs run before attribution was wired.
        if claim_times:
            claims = sorted(
                ((e, _epoch(ts)) for e, ts in claim_times if ts is not None),
                key=lambda c: c[1],
            )
            cur.execute(
                """
                SELECT occurred_at, prompt_tokens, completion_tokens, total_cost,
                       model, currency
                FROM llm_usage_events
                WHERE org_id IS NULL AND request_kind = 'delivery'
                ORDER BY occurred_at DESC;
                """
            )
            for r in cur.fetchall():
                oe = _epoch(r[0])
                if oe is None:
                    continue
                match = min(claims, key=lambda c: abs(c[1] - oe), default=None)
                if match is None or abs(match[1] - oe) > _CLAIM_WINDOW:
                    continue
                merged.append({
                    "occurred_at": r[0], "email": match[0], "display_name": None,
                    "prompt_tokens": int(r[1] or 0), "completion_tokens": int(r[2] or 0),
                    "cost": str(Decimal(r[3] or 0)), "model": r[4],
                    "currency": r[5] or "USD", "llm_calls": 1,
                })

    merged.sort(key=lambda x: x["occurred_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    total = len(merged)
    page = merged[offset:offset + limit]
    for row in page:
        row["occurred_at"] = row["occurred_at"].isoformat() if row["occurred_at"] else None
    return {"rows": page, "total": total, "limit": limit, "offset": offset}


def _now() -> datetime:
    return datetime.now(timezone.utc)
