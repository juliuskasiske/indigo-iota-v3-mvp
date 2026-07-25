"""Control-plane audit log: a durable record of sensitive admin + security events.

One tiny writer, shared across the control plane (provisioning, auth, billing),
so every sensitive action lands in the same ``audit_log`` table with a consistent
shape: who did it (``actor``), what happened (``action``), and a free-form JSON
``detail``. There is no magic capture — ``detail`` is always a hand-built dict at
the call site.

``org_id`` is a SOFT link (the column is ``ON DELETE SET NULL``): when an org is
erased the column nulls out, so anything that must outlive the org — its slug,
above all — has to live inside ``detail``, not just in ``org_id``.

Best-effort by design: an audit-write failure must never wedge the action it is
recording (a login, a blocked call), so ``record_event`` swallows DB errors. The
one exception is erasure, which writes its audit row inside the same transaction
as the delete (see src/tenancy/provision.py) precisely so it is all-or-nothing.
"""
from __future__ import annotations

from psycopg.types.json import Jsonb

from src.db.connection import get_control_connection


def record_event(
    action: str,
    *,
    org_id: int | None = None,
    actor: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append one row to the control-plane ``audit_log`` (own txn). Never raises."""
    try:
        with get_control_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO audit_log (org_id, actor, action, detail) "
                    "VALUES (%s, %s, %s, %s);",
                    (org_id, actor, action, Jsonb(detail or {})),
                )
            conn.commit()
    except Exception as exc:  # auditing must not break the action it records
        print(f"[audit] failed to record {action!r}: {exc!r}")
