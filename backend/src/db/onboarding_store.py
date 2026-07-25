"""Per-tenant onboarding-completion store.

The Admin Center runs a once-per-tenant onboarding WIZARD (set the initial
credit limit, connect sources, approve the triage scope, define the brain, run
the first backfill) and then switches to a steady-state DASHBOARD where every
one of those settings stays freely editable.

This module is the backing for that switch: a single ``tenant_onboarding`` row
(see migrations/tenant/0015_tenant_onboarding.sql) records whether the wizard
has been finished, and by whom/when. While unset the Admin Center renders the
wizard; once an admin clicks Finish it renders the dashboard. ``reopen`` clears
the stamp to deliberately re-run the wizard.

The functions take an open tenant connection so the caller controls which brain
DB is targeted (database-per-tenant) and the transaction boundary.
"""
from __future__ import annotations

import psycopg


def _ensure_row(conn: psycopg.Connection) -> None:
    """Make sure the singleton row exists (migration seeds it, but be safe)."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO tenant_onboarding (id) VALUES (TRUE) "
            "ON CONFLICT (id) DO NOTHING;"
        )
    conn.commit()


def get_status(conn: psycopg.Connection) -> dict:
    """This tenant's onboarding state: whether finished, and by whom/when."""
    _ensure_row(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT onboarded_at, onboarded_by FROM tenant_onboarding WHERE id = TRUE;"
        )
        row = cur.fetchone()
    onboarded_at, onboarded_by = (row or (None, None))
    return {
        "onboarded": onboarded_at is not None,
        "onboarded_at": onboarded_at.isoformat() if onboarded_at else None,
        "onboarded_by": onboarded_by,
    }


def is_onboarded(conn: psycopg.Connection) -> bool:
    """True once an admin has finished the onboarding wizard for this tenant."""
    return get_status(conn)["onboarded"]


def mark_onboarded(conn: psycopg.Connection, *, actor: str = "admin") -> dict:
    """Stamp the wizard as finished. Idempotent — re-finishing keeps the first
    stamp so the original completion time is preserved. Returns the new state."""
    _ensure_row(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE tenant_onboarding
               SET onboarded_at = COALESCE(onboarded_at, now()),
                   onboarded_by = COALESCE(onboarded_by, %s)
             WHERE id = TRUE;
            """,
            (actor,),
        )
    conn.commit()
    return get_status(conn)


def reopen(conn: psycopg.Connection) -> dict:
    """Clear the completion stamp so the wizard runs again. Returns new state."""
    _ensure_row(conn)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tenant_onboarding "
            "SET onboarded_at = NULL, onboarded_by = NULL WHERE id = TRUE;"
        )
    conn.commit()
    return get_status(conn)
