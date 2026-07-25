"""Repository for the 'delivery_todos' table — the Delivery tab's per-user pool.

One current row per member email (upsert latest). The pool itself is the JSON the
DeliveryAgent returned. ``computed_at`` is the freshness gate the 3-hourly
scheduler job and the on-demand refresh both read.

Mirrors settings_store: every function takes an open tenant connection so the
caller owns the brain DB + transaction.
"""
from __future__ import annotations

from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from src.ingestion.comprehend.canonicalize import normalize_email


def get_pool(conn: psycopg.Connection, email: str) -> dict | None:
    """The member's stored pool, or None if never computed.

    Returns {todos: list, suggestions: list, computed_at: datetime}. Email is
    normalized so the key matches however the pool was stored.
    """
    norm = normalize_email(email)
    if not norm:
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT todos, suggestions, computed_at FROM delivery_todos "
            "WHERE user_email = %s;",
            (norm,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {"todos": row[0] or [], "suggestions": row[1] or [], "computed_at": row[2]}


def upsert_pool(
    conn: psycopg.Connection, email: str, todos: list, suggestions: list,
) -> datetime:
    """Replace the member's pool with ``todos`` + ``suggestions``, stamping
    computed_at = now(). Returns the computed_at timestamp written."""
    norm = normalize_email(email)
    if not norm:
        raise ValueError("a non-empty email is required to store a delivery pool.")
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO delivery_todos (user_email, todos, suggestions, computed_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_email) DO UPDATE
               SET todos       = EXCLUDED.todos,
                   suggestions = EXCLUDED.suggestions,
                   computed_at = EXCLUDED.computed_at,
                   updated_at  = EXCLUDED.updated_at;
            """,
            (norm, Jsonb(todos), Jsonb(suggestions), now, now),
        )
    conn.commit()
    return now


def get_dismissed(conn: psycopg.Connection, email: str) -> list[str]:
    """Normalized keys (lowercased titles) the user has already acted on, so the
    pool computation can exclude them. Empty list if none / no row."""
    norm = normalize_email(email)
    if not norm:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT dismissed FROM delivery_todos WHERE user_email = %s;", (norm,)
        )
        row = cur.fetchone()
    return list(row[0]) if row and row[0] else []


def add_dismissed(conn: psycopg.Connection, email: str, key: str) -> None:
    """Record that the user acted on the item with this key (idempotent). Creates
    the row if absent so a dismissal before any pool exists still sticks."""
    norm = normalize_email(email)
    key = (key or "").strip().lower()
    if not norm or not key:
        return
    current = set(get_dismissed(conn, norm))
    if key in current:
        return
    current.add(key)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO delivery_todos (user_email, dismissed)
            VALUES (%s, %s)
            ON CONFLICT (user_email) DO UPDATE SET dismissed = EXCLUDED.dismissed;
            """,
            (norm, Jsonb(sorted(current))),
        )
    conn.commit()


def pool_age_seconds(conn: psycopg.Connection, email: str) -> float | None:
    """Seconds since the member's pool was last computed, or None if never.
    Drives the 3-hour scheduler gate and the refresh rate-limit."""
    pool = get_pool(conn, email)
    if pool is None or pool.get("computed_at") is None:
        return None
    return (datetime.now(timezone.utc) - pool["computed_at"]).total_seconds()


def pool_times(conn: psycopg.Connection) -> list[tuple]:
    """``(user_email, computed_at)`` for every member's pool in this tenant.

    Lets the Delivery observability endpoint reclaim historical delivery usage
    events that were metered before org attribution was wired (org_id NULL): an
    event whose timestamp matches one of these pool computed_at values almost
    certainly produced that pool. Only the latest compute per member survives
    (the row is upserted), so older repeat syncs aren't individually recoverable."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT user_email, computed_at FROM delivery_todos "
            "WHERE computed_at IS NOT NULL;"
        )
        return [(r[0], r[1]) for r in cur.fetchall()]
