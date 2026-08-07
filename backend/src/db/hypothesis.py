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
            "SELECT id, parent_id, kind, label, rationale, mece_note, status, sort_order "
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
            "evidence": evidence.get(nid, []),
            "card": cards.get(nid),
        }
        for (nid, parent_id, kind, label, rationale, mece_note, status, sort_order)
        in node_rows
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
