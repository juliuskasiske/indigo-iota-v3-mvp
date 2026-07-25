"""Per-tenant comprehend "Diligence" settings (the admin/operator-tunable knobs).

One singleton row per tenant brain (comprehend_settings, migration 0024), holding
the two dimensions that govern comprehension cost:

  - relationship_diligence — how exhaustively the pairwise RelationshipAgent
    evaluates entity pairs ('anchored' | 'capped' | 'exhaustive').
  - context_agents — which per-email downstream agents receive the third-party
    1-hop brain-page context (a name->bool map), plus context_max_neighbors.

Mirrors triage/scope_store.py: functions take an open tenant connection so the
caller owns the brain DB + transaction. Reads always return a fully-populated
dict (the row is seeded by the migration), with any missing context_agents keys
defaulted off — so adding a new downstream agent defaults to "no context".
"""
from __future__ import annotations

import psycopg
from psycopg.types.json import Jsonb

# Pairing exhaustiveness for step 6 (see pipeline._build_pairs).
DILIGENCE_MODES: tuple[str, ...] = ("anchored", "capped", "exhaustive")
DEFAULT_DILIGENCE = "anchored"

# The per-email downstream agents that CAN receive third-party 1-hop context.
# (The third-party agent is excluded: the context is keyed on the third party it
# resolves, so it can't consume it.) All default off — context pull is opt-in.
CONTEXT_AGENTS: tuple[str, ...] = (
    "identifier",
    "relationship",
    "attribute",
    "timeline",
    "description",
)
DEFAULT_MAX_NEIGHBORS = 10


def _default_context_agents() -> dict[str, bool]:
    return {a: False for a in CONTEXT_AGENTS}


def get_settings(conn: psycopg.Connection) -> dict:
    """Read this tenant's comprehend settings, fully normalized.

    Returns {relationship_diligence, context_agents (every known agent present),
    context_max_neighbors}. Safe if the row is somehow absent (returns defaults).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT relationship_diligence, context_agents, context_max_neighbors, "
            "       drive_comprehend_enabled "
            "FROM comprehend_settings WHERE id = TRUE;"
        )
        row = cur.fetchone()

    if row is None:
        return {
            "relationship_diligence": DEFAULT_DILIGENCE,
            "context_agents": _default_context_agents(),
            "context_max_neighbors": DEFAULT_MAX_NEIGHBORS,
            "drive_comprehend_enabled": False,
        }

    diligence, stored_agents, max_neighbors, drive_comprehend = row
    agents = _default_context_agents()
    for key, val in (stored_agents or {}).items():
        if key in agents:
            agents[key] = bool(val)
    return {
        "relationship_diligence": diligence if diligence in DILIGENCE_MODES else DEFAULT_DILIGENCE,
        "context_agents": agents,
        "context_max_neighbors": int(max_neighbors) if max_neighbors else DEFAULT_MAX_NEIGHBORS,
        "drive_comprehend_enabled": bool(drive_comprehend),
    }


def update_settings(
    conn: psycopg.Connection,
    *,
    relationship_diligence: str | None = None,
    context_agents: dict | None = None,
    context_max_neighbors: int | None = None,
    drive_comprehend_enabled: bool | None = None,
    actor: str = "admin",
) -> dict:
    """Patch any subset of the settings (only non-None args are applied). Validates
    the diligence mode and clamps max_neighbors. Returns the new settings."""
    if relationship_diligence is not None and relationship_diligence not in DILIGENCE_MODES:
        raise ValueError(
            f"relationship_diligence must be one of {DILIGENCE_MODES}, "
            f"got {relationship_diligence!r}."
        )
    current = get_settings(conn)
    new_diligence = relationship_diligence or current["relationship_diligence"]
    new_agents = dict(current["context_agents"])
    if context_agents is not None:
        for key, val in context_agents.items():
            if key in new_agents:
                new_agents[key] = bool(val)
    new_max = current["context_max_neighbors"]
    if context_max_neighbors is not None:
        new_max = max(0, min(50, int(context_max_neighbors)))
    new_drive = current["drive_comprehend_enabled"]
    if drive_comprehend_enabled is not None:
        new_drive = bool(drive_comprehend_enabled)

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE comprehend_settings
               SET relationship_diligence  = %s,
                   context_agents          = %s,
                   context_max_neighbors   = %s,
                   drive_comprehend_enabled = %s,
                   updated_at              = now(),
                   updated_by              = %s
             WHERE id = TRUE;
            """,
            (new_diligence, Jsonb(new_agents), new_max, new_drive, actor),
        )
    conn.commit()
    return get_settings(conn)
