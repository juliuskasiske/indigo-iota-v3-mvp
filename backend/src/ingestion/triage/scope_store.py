"""Per-tenant scope-definition store (the admin-editable backing for classify).

Each customer's brain database holds its own scope definitions in two tables
(see migrations/tenant/0002_scope_definitions.sql):

    triage_buckets    one row per bucket — action + description + anchors
    triage_settings   single row — the Layer-2 security margin

The customer admin edits the natural-language ``description``, the example
``anchors`` and the ``margin`` from the Admin Center. The POLICY (which bucket
is included) is fixed in code (``classify.BUCKET_ACTIONS``) and is NOT editable
here, so an admin can never turn "redzone" into an include.

Defaults are seeded from ``backend/classification.yaml`` on first read, so the
canonical starter text lives in one place and admins see it ready to edit.

The functions take an open tenant connection so the caller controls which
brain DB is targeted (database-per-tenant) and the transaction boundary.
"""
from __future__ import annotations

from typing import List

import psycopg
from psycopg.types.json import Jsonb

from src.ingestion.triage import classify


def default_definitions() -> dict:
    """The seed definitions (from classification.yaml), normalized to our shape."""
    raw = classify.read_definitions()
    margin = raw.get("margin", 0.03)
    buckets = raw.get("buckets") or {}
    out = {"margin": margin, "buckets": {}}
    for name in classify.REQUIRED_BUCKETS:
        spec = buckets.get(name) or {}
        out["buckets"][name] = {
            "action": classify.BUCKET_ACTIONS[name],
            "description": (spec.get("description") or "").strip(),
            "anchors": [
                a.strip()
                for a in (spec.get("anchors") or [])
                if isinstance(a, str) and a.strip()
            ],
        }
    return out


def _is_empty(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM triage_buckets;")
        return cur.fetchone()[0] == 0


def seed_if_empty(conn: psycopg.Connection, actor: str = "system") -> bool:
    """Populate the tables from classification.yaml if they're empty. Idempotent.

    Returns True if it seeded this call.
    """
    if not _is_empty(conn):
        return False
    defs = default_definitions()
    with conn.cursor() as cur:
        for name in classify.REQUIRED_BUCKETS:
            spec = defs["buckets"][name]
            cur.execute(
                """
                INSERT INTO triage_buckets (bucket, action, description, anchors, updated_by)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (bucket) DO NOTHING;
                """,
                (name, spec["action"], spec["description"], Jsonb(spec["anchors"]), actor),
            )
        cur.execute(
            """
            INSERT INTO triage_settings (id, margin, updated_by)
            VALUES (TRUE, %s, %s)
            ON CONFLICT (id) DO NOTHING;
            """,
            (defs["margin"], actor),
        )
    conn.commit()
    return True


def get_definitions(conn: psycopg.Connection) -> dict:
    """Read this tenant's scope definitions (seeding defaults first if empty).

    Returns the same dict shape ``classify.classify`` consumes:
        {"margin": float, "buckets": {name: {action, description, anchors}}}
    plus per-bucket ``updated_at`` / ``updated_by`` metadata for the UI.
    """
    seed_if_empty(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT bucket, action, description, anchors, updated_at, updated_by "
            "FROM triage_buckets;"
        )
        rows = cur.fetchall()
        cur.execute("SELECT margin FROM triage_settings WHERE id = TRUE;")
        mrow = cur.fetchone()

    margin = float(mrow[0]) if mrow else 0.03
    buckets: dict = {}
    for bucket, action, description, anchors, updated_at, updated_by in rows:
        buckets[bucket] = {
            "action": action,
            "description": description or "",
            "anchors": list(anchors or []),
            "updated_at": updated_at.isoformat() if updated_at else None,
            "updated_by": updated_by,
        }
    return {"margin": margin, "buckets": buckets}


def update_bucket(
    conn: psycopg.Connection,
    bucket: str,
    *,
    description: str | None = None,
    anchors: List[str] | None = None,
    actor: str = "admin",
) -> None:
    """Update one bucket's editable fields (description and/or anchors).

    The bucket's ``action`` is policy and is never changed here.
    """
    if bucket not in classify.REQUIRED_BUCKETS:
        raise ValueError(
            f"unknown bucket {bucket!r}; expected one of {classify.REQUIRED_BUCKETS}."
        )
    if description is None and anchors is None:
        return
    seed_if_empty(conn)

    sets = []
    params: list = []
    if description is not None:
        sets.append("description = %s")
        params.append(description.strip())
    if anchors is not None:
        cleaned = [a.strip() for a in anchors if isinstance(a, str) and a.strip()]
        sets.append("anchors = %s")
        params.append(Jsonb(cleaned))
    sets.append("updated_at = now()")
    sets.append("updated_by = %s")
    params.append(actor)
    params.append(bucket)

    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE triage_buckets SET {', '.join(sets)} WHERE bucket = %s;",
            params,
        )
    conn.commit()


def get_approval(conn: psycopg.Connection) -> dict:
    """This tenant's scope sign-off: whether it's approved, and by whom/when.

    Capture stays paused until an admin approves the scope (see migration 0014).
    Seeds defaults first so a brand-new tenant reads back ``approved=False``
    rather than erroring on a missing row.
    """
    seed_if_empty(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT approved_at, approved_by FROM triage_settings WHERE id = TRUE;"
        )
        row = cur.fetchone()
    approved_at, approved_by = (row or (None, None))
    return {
        "approved": approved_at is not None,
        "approved_at": approved_at.isoformat() if approved_at else None,
        "approved_by": approved_by,
    }


def is_approved(conn: psycopg.Connection) -> bool:
    """True once an admin has signed off on this tenant's scope policy."""
    return get_approval(conn)["approved"]


def approve(conn: psycopg.Connection, *, actor: str = "admin") -> dict:
    """Record an admin's sign-off on the current scope policy.

    Re-approving just restamps the time/actor. Returns the new approval state.
    """
    seed_if_empty(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO triage_settings (id, approved_at, approved_by)
            VALUES (TRUE, now(), %s)
            ON CONFLICT (id)
                DO UPDATE SET approved_at = now(), approved_by = EXCLUDED.approved_by;
            """,
            (actor,),
        )
    conn.commit()
    return get_approval(conn)


def set_margin(
    conn: psycopg.Connection, margin: float, *, actor: str = "admin"
) -> None:
    """Update the Layer-2 security margin for this tenant."""
    if not (0.0 <= float(margin) <= 1.0):
        raise ValueError("margin must be between 0.0 and 1.0.")
    seed_if_empty(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO triage_settings (id, margin, updated_by)
            VALUES (TRUE, %s, %s)
            ON CONFLICT (id)
                DO UPDATE SET margin = EXCLUDED.margin,
                              updated_by = EXCLUDED.updated_by,
                              updated_at = now();
            """,
            (float(margin), actor),
        )
    conn.commit()
