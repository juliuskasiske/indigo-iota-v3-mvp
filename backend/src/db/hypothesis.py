"""The hypothesis tree: the structured output of one swarm run.

Three tables (migration 0032), one row per thing the user can click:

  ``hypothesis_nodes``     the boxes — one ``objective`` root, ``branch`` nodes
                           that decompose it into MECE lever buckets, and
                           ``initiative`` leaves.
  ``hypothesis_evidence``  the facts a node stands on, with their source.
  ``initiative_cards``     the card behind a leaf: what is meant by it, how it
                           would be sized, what must be true, what to do next.

Why rows and not the event log: the tree used to be re-derived from
``agent_events`` on every read, which works for a flat list of hypotheses
rendered as text but not for a tree whose nodes each carry a rationale, their
own evidence and a five-field card. ``agent_events`` is untouched and still
backs the Activity feed.

Functions take an open *tenant* connection; the caller owns the transaction.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

KIND_OBJECTIVE = "objective"
KIND_BRANCH = "branch"
KIND_INITIATIVE = "initiative"

STATUS_INVESTIGATING = "investigating"
STATUS_SUPPORTED = "supported"
STATUS_NEEDS_EVIDENCE = "needs_evidence"
STATUS_DISCARDED = "discarded"


@dataclass
class Evidence:
    text: str
    source: str | None = None
    page_path: str | None = None
    kind: str = "fact"


@dataclass
class Card:
    """The five card fields, plus the sized value and how much we trust it."""

    context: str = ""
    sizing_approach: str = ""
    what_must_be_true: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    value_amount: Decimal | None = None
    value_currency: str = "EUR"
    value_type: str | None = None
    value_year: int | None = None
    value_basis: str = ""
    confidence: str | None = None
    feasible_by_end: bool | None = None


# --- writes -----------------------------------------------------------------

def add_node(
    conn: psycopg.Connection,
    *,
    run_id: int,
    kind: str,
    label: str,
    parent_id: int | None = None,
    rationale: str = "",
    status: str = STATUS_INVESTIGATING,
    sort_order: int = 0,
) -> int:
    """Insert one node and return its id."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO hypothesis_nodes "
            "(run_id, parent_id, kind, label, rationale, status, sort_order) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;",
            (run_id, parent_id, kind, label.strip(), rationale.strip(), status, sort_order),
        )
        node_id = cur.fetchone()[0]
    conn.commit()
    return node_id


def set_mece_note(conn: psycopg.Connection, node_id: int, note: str) -> None:
    """Record on a PARENT why the split below it is collectively exhaustive.

    It lives on the parent because exhaustiveness is a property of the whole
    split, not of any one child.
    """
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE hypothesis_nodes SET mece_note = %s, updated_at = now() WHERE id = %s;",
            (note.strip(), node_id),
        )
    conn.commit()


def set_status(conn: psycopg.Connection, node_id: int, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE hypothesis_nodes SET status = %s, updated_at = now() WHERE id = %s;",
            (status, node_id),
        )
    conn.commit()


def update_node(
    conn: psycopg.Connection,
    node_id: int,
    *,
    label: str | None = None,
    rationale: str | None = None,
) -> None:
    """Revise a node in place. Used when feedback reshapes it rather than kills it."""
    sets, values = [], []
    if label is not None:
        sets.append("label = %s")
        values.append(label.strip())
    if rationale is not None:
        sets.append("rationale = %s")
        values.append(rationale.strip())
    if not sets:
        return
    values.append(node_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE hypothesis_nodes SET {', '.join(sets)}, updated_at = now() WHERE id = %s;",
            values,
        )
    conn.commit()


# --- subtree operations -----------------------------------------------------

def descendants(conn: psycopg.Connection, node_id: int) -> list[int]:
    """Every node beneath ``node_id``, at any depth. Excludes the node itself."""
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH RECURSIVE sub AS (
                SELECT id FROM hypothesis_nodes WHERE parent_id = %s
                UNION ALL
                SELECT n.id FROM hypothesis_nodes n JOIN sub ON n.parent_id = sub.id
            )
            SELECT id FROM sub;
            """,
            (node_id,),
        )
        return [r[0] for r in cur.fetchall()]


def discard_subtree(conn: psycopg.Connection, node_id: int, reason: str) -> list[int]:
    """Mark a node and everything under it discarded. Returns the affected ids.

    Deliberately not a delete: a rejected branch and the reason it was rejected
    are the most useful context the agents have when proposing a replacement,
    and the reviewer should be able to see what they already threw out.
    """
    ids = [node_id] + descendants(conn, node_id)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE hypothesis_nodes SET status = %s, updated_at = now() "
            "WHERE id = ANY(%s);",
            (STATUS_DISCARDED, ids),
        )
        # The reason belongs to the node the reviewer actually judged, not to
        # each child that fell with it.
        cur.execute(
            "UPDATE hypothesis_nodes SET discard_reason = %s WHERE id = %s;",
            (reason.strip(), node_id),
        )
    conn.commit()
    return ids


def delete_children(conn: psycopg.Connection, node_id: int) -> int:
    """Remove a node's whole subtree outright. Returns how many went.

    Used when FEEDBACK reshapes a node: its children are superseded rather than
    rejected, so keeping them as discarded tombstones would just bury the tree.
    The ON DELETE CASCADE on parent_id takes the deeper levels with them.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM hypothesis_nodes WHERE parent_id = %s;", (node_id,))
        removed = cur.rowcount
    conn.commit()
    return removed


def next_sort_order(conn: psycopg.Connection, parent_id: int | None) -> int:
    """One past the last sibling, so a replacement lands at the end of the row."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT coalesce(max(sort_order), -1) + 1 FROM hypothesis_nodes "
            "WHERE parent_id IS NOT DISTINCT FROM %s;",
            (parent_id,),
        )
        return cur.fetchone()[0]


def get_node(conn: psycopg.Connection, node_id: int) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, run_id, parent_id, kind, label, rationale, mece_note, status, "
            "       sort_order, discard_reason "
            "FROM hypothesis_nodes WHERE id = %s;",
            (node_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    keys = ("id", "run_id", "parent_id", "kind", "label", "rationale", "mece_note",
            "status", "sort_order", "discard_reason")
    return dict(zip(keys, row))


def siblings(conn: psycopg.Connection, node_id: int) -> list[dict]:
    """The node's surviving siblings — what a replacement must not overlap with."""
    node = get_node(conn, node_id)
    if not node:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, label, rationale FROM hypothesis_nodes "
            "WHERE parent_id IS NOT DISTINCT FROM %s AND id <> %s AND status <> %s "
            "ORDER BY sort_order, id;",
            (node["parent_id"], node_id, STATUS_DISCARDED),
        )
        return [{"id": r[0], "label": r[1], "rationale": r[2]} for r in cur.fetchall()]


# --- interventions ----------------------------------------------------------

KIND_DISCARD = "discard"
KIND_FEEDBACK = "feedback"


def add_intervention(
    conn: psycopg.Connection,
    *,
    run_id: int,
    node_id: int,
    kind: str,
    comment: str,
    actor: str = "",
) -> int:
    with conn.cursor() as cur:
        # Snapshot what the comment is about. The node may be deleted later —
        # feedback on an ancestor rebuilds a whole subtree — and the record has
        # to keep reading after that.
        cur.execute("SELECT label, kind FROM hypothesis_nodes WHERE id = %s;", (node_id,))
        row = cur.fetchone() or ("", "")
        cur.execute(
            "INSERT INTO node_interventions "
            "(run_id, node_id, kind, comment, actor, node_label, node_kind) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id;",
            (run_id, node_id, kind, comment.strip(), actor, row[0], row[1]),
        )
        iid = cur.fetchone()[0]
    conn.commit()
    return iid


def settle_intervention(
    conn: psycopg.Connection,
    intervention_id: int,
    *,
    status: str,
    replacement_node_id: int | None = None,
    error: str = "",
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE node_interventions SET status = %s, replacement_node_id = %s, "
            "       error = %s, applied_at = now() WHERE id = %s;",
            (status, replacement_node_id, error[:500], intervention_id),
        )
    conn.commit()


def interventions_for_run(conn: psycopg.Connection, run_id: int) -> dict[int, list[dict]]:
    """Every act of steering on this run, keyed by the node it was aimed at."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT node_id, id, kind, comment, actor, status, error, "
            "       replacement_node_id, extract(epoch FROM created_at) "
            "FROM node_interventions WHERE run_id = %s ORDER BY id;",
            (run_id,),
        )
        out: dict[int, list[dict]] = {}
        for r in cur.fetchall():
            out.setdefault(r[0], []).append(
                {
                    "id": r[1], "kind": r[2], "comment": r[3], "actor": r[4],
                    "status": r[5], "error": r[6], "replacement_node_id": r[7],
                    "created_at": r[8],
                }
            )
    return out


def review_history(conn: psycopg.Connection, run_id: int) -> list[dict]:
    """Every act of steering on this run in order, including ones whose node has
    since been rebuilt away. This is the record of why the tree looks like it
    does, so it outlives the boxes it was about."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, node_id, node_label, node_kind, kind, comment, status, "
            "       extract(epoch FROM created_at) "
            "FROM node_interventions WHERE run_id = %s ORDER BY id;",
            (run_id,),
        )
        return [
            {"id": r[0], "node_id": r[1], "node_label": r[2], "node_kind": r[3],
             "kind": r[4], "comment": r[5], "status": r[6], "created_at": r[7]}
            for r in cur.fetchall()
        ]


def pending_interventions(conn: psycopg.Connection, run_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM node_interventions WHERE run_id = %s AND status = 'pending';",
            (run_id,),
        )
        return cur.fetchone()[0]


def add_evidence(conn: psycopg.Connection, node_id: int, items: list[Evidence]) -> None:
    """Attach facts to a node. No-op on an empty list."""
    if not items:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO hypothesis_evidence (node_id, text, source, page_path, kind) "
            "VALUES (%s, %s, %s, %s, %s);",
            [(node_id, e.text, e.source, e.page_path, e.kind) for e in items],
        )
    conn.commit()


def upsert_card(conn: psycopg.Connection, node_id: int, **fields) -> None:
    """Create or patch an initiative's card.

    Called several times per initiative as the agents work — Planning fills the
    what-must-be-true and next-steps, the Sizer fills the value, the Judge fills
    the confidence — so the canvas fills in progressively while the run streams.
    Only the keys passed are written; everything else keeps its stored value.
    """
    allowed = {
        "context", "sizing_approach", "what_must_be_true", "next_steps",
        "value_amount", "value_currency", "value_type", "value_year",
        "value_basis", "confidence", "feasible_by_end",
    }
    patch = {k: v for k, v in fields.items() if k in allowed and v is not None}

    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO initiative_cards (node_id) VALUES (%s) ON CONFLICT DO NOTHING;",
            (node_id,),
        )
        if patch:
            sets, values = [], []
            for key, value in patch.items():
                sets.append(f"{key} = %s")
                values.append(
                    Jsonb(value) if key in ("what_must_be_true", "next_steps") else value
                )
            values.append(node_id)
            cur.execute(
                f"UPDATE initiative_cards SET {', '.join(sets)}, updated_at = now() "
                f"WHERE node_id = %s;",
                values,
            )
    conn.commit()


# --- reads ------------------------------------------------------------------

def latest_run_id(conn: psycopg.Connection) -> int | None:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM swarm_runs ORDER BY id DESC LIMIT 1;")
        row = cur.fetchone()
    return row[0] if row else None


def read_tree(conn: psycopg.Connection, run_id: int) -> list[dict]:
    """Every node of one run as a FLAT list, each with its evidence and card.

    Flat rather than nested on purpose: the canvas needs a flat list to lay out
    anyway, and a flat array stays stable to diff while a run is still streaming
    new nodes in.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, parent_id, kind, label, rationale, mece_note, status, sort_order, "
            "       discard_reason "
            "FROM hypothesis_nodes WHERE run_id = %s "
            "ORDER BY id;",
            (run_id,),
        )
        node_rows = cur.fetchall()
        if not node_rows:
            return []

        ids = [r[0] for r in node_rows]

        cur.execute(
            "SELECT node_id, text, source, page_path, kind FROM hypothesis_evidence "
            "WHERE node_id = ANY(%s) ORDER BY id;",
            (ids,),
        )
        evidence: dict[int, list[dict]] = {}
        for node_id, text, source, page_path, kind in cur.fetchall():
            evidence.setdefault(node_id, []).append(
                {"text": text, "source": source, "page_path": page_path, "kind": kind}
            )

        cur.execute(
            "SELECT node_id, context, sizing_approach, what_must_be_true, next_steps, "
            "       value_amount, value_currency, value_type, value_year, value_basis, "
            "       confidence, feasible_by_end "
            "FROM initiative_cards WHERE node_id = ANY(%s);",
            (ids,),
        )
        cards: dict[int, dict] = {}
        for row in cur.fetchall():
            cards[row[0]] = {
                "context": row[1] or "",
                "sizing_approach": row[2] or "",
                "what_must_be_true": row[3] or [],
                "next_steps": row[4] or [],
                "value_amount": float(row[5]) if row[5] is not None else None,
                "value_currency": row[6] or "EUR",
                "value_type": row[7],
                "value_year": row[8],
                "value_basis": row[9] or "",
                "confidence": row[10],
                "feasible_by_end": row[11],
            }

    steering = interventions_for_run(conn, run_id)

    return [
        {
            "id": nid,
            "parent_id": parent_id,
            "kind": kind,
            "label": label,
            "rationale": rationale or "",
            "mece_note": mece_note or "",
            "status": status,
            "sort_order": sort_order,
            "discard_reason": discard_reason or "",
            "evidence": evidence.get(nid, []),
            "card": cards.get(nid),
            "interventions": steering.get(nid, []),
        }
        for (nid, parent_id, kind, label, rationale, mece_note, status, sort_order,
             discard_reason) in node_rows
    ]


def coverage(nodes: list[dict], *, impact_type: str = "recurring") -> dict:
    """How much of the program's target the sized initiatives account for.

    Two rules that keep the number honest:

      * Discarded initiatives are excluded. A number the Judge threw out is not
        money anyone should be adding up.
      * Only initiatives matching the program's ``impact_type`` count toward the
        total. Adding a one-time gain into a recurring run-rate goal is a real
        modelling error, so one-time value is reported on its own line instead.
    """
    total = 0.0
    one_time = 0.0
    counted = 0
    sized = 0
    by_status: dict[str, float] = {}

    for n in nodes:
        if n["kind"] != KIND_INITIATIVE or n["status"] == STATUS_DISCARDED:
            continue
        counted += 1
        card = n.get("card") or {}
        amount = card.get("value_amount")
        if not amount:
            continue
        sized += 1
        amount = float(amount)
        # An initiative with no stated type is assumed to follow the program.
        if (card.get("value_type") or impact_type) == impact_type:
            total += amount
            by_status[n["status"]] = by_status.get(n["status"], 0.0) + amount
        else:
            one_time += amount

    return {
        "sized_total": total,
        "one_time_total": one_time,
        "initiatives": counted,
        "initiatives_sized": sized,
        "by_status": by_status,
    }
