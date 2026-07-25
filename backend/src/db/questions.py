"""Repository for the 'questions' table — Search-tab history.

Each row is one (question, answer, sources) triple. We store sources as
JSONB verbatim so replaying a past question is free of the LLM + retrieval
cost: the Search tab just renders what was saved.
"""
from __future__ import annotations
import json
from contextlib import nullcontext
from typing import List, Optional

import psycopg

from src.db.connection import get_connection


def save_question(
    question: str,
    answer: str,
    sources: list,
    conn: Optional[psycopg.Connection] = None,
) -> int:
    """Persist a Q&A and return the new row id.

    Pass ``conn`` to write into a specific tenant's brain; omit it to use the
    default brain DB (dashboard / demo).
    """
    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO questions (question, answer, sources) "
                "VALUES (%s, %s, %s::jsonb) RETURNING id;",
                (question, answer, json.dumps(sources or [])),
            )
            new_id: int = cur.fetchone()[0]
            _save_question_entities(cur, new_id, sources or [])
        conn.commit()
    return new_id


def create_question(question: str, conn: psycopg.Connection) -> int:
    """Insert a question with a placeholder answer and return its id.

    Used by the API to mint the question id BEFORE the LLM synthesis runs, so the
    id can be stamped onto the synthesis usage event (see
    ``metering.set_current_question_id``) and the Ask observability table can join
    cost back to the question. ``finalize_question`` fills in the answer + sources
    once the synthesis returns. Caller owns the transaction/commit.
    """
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO questions (question, answer, sources) "
            "VALUES (%s, '', '[]'::jsonb) RETURNING id;",
            (question,),
        )
        return int(cur.fetchone()[0])


def finalize_question(
    question_id: int, answer: str, sources: list, conn: psycopg.Connection
) -> None:
    """Fill in a pre-created question's answer + sources (and its read-side
    entity provenance). Pairs with ``create_question``. Caller owns the commit."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE questions SET answer = %s, sources = %s::jsonb WHERE id = %s;",
            (answer, json.dumps(sources or []), question_id),
        )
        _save_question_entities(cur, question_id, sources or [])


def list_questions_page(
    conn: psycopg.Connection, *, limit: int = 50, offset: int = 0
) -> dict:
    """A paged slice of the question history (newest first) for the Ask egress
    observability table. Returns ``{rows: [{id, question, created_at}], total}``.
    Token/cost is joined on separately from the control-plane usage ledger."""
    limit = max(1, min(200, limit))
    offset = max(0, offset)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM questions;")
        total = int(cur.fetchone()[0])
        cur.execute(
            "SELECT id, question, created_at FROM questions "
            "ORDER BY id DESC LIMIT %s OFFSET %s;",
            (limit, offset),
        )
        rows = [
            {
                "id": r[0],
                "question": r[1],
                "created_at": r[2].isoformat() if r[2] else None,
            }
            for r in cur.fetchall()
        ]
    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


def all_question_times(conn: psycopg.Connection) -> list[tuple]:
    """``(id, created_at)`` for every question, oldest first. Lets the Ask
    observability endpoint attribute pre-stamping Q&A usage events to their
    question by timestamp proximity (the event's cost is in the control DB and
    can't be SQL-joined to this tenant table)."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, created_at FROM questions ORDER BY created_at ASC, id ASC;")
        return [(int(r[0]), r[1]) for r in cur.fetchall()]


def _save_question_entities(
    cur: psycopg.Cursor, question_id: int, sources: list
) -> None:
    """Record which entities this question surfaced, and how (read-side
    provenance for question_entities). Each source carries an ``entity_id`` and
    a ``method`` ('vector' | 'graph_neighbor'); ``rank`` is its position in the
    merged source list (1 = top). An entity can appear in several sources — we
    keep its best (earliest) rank, since the PK is (question_id, entity_id)."""
    seen: set[int] = set()
    rows: list[tuple[int, int, str, int]] = []
    for rank, s in enumerate(sources, start=1):
        entity_id = s.get("entity_id")
        method = s.get("method")
        if not entity_id or method not in ("vector", "graph_neighbor"):
            continue
        if entity_id in seen:
            continue
        seen.add(entity_id)
        rows.append((question_id, entity_id, method, rank))
    if rows:
        cur.executemany(
            "INSERT INTO question_entities (question_id, entity_id, method, rank) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (question_id, entity_id) DO NOTHING;",
            rows,
        )


def list_questions(
    limit: int = 100, conn: Optional[psycopg.Connection] = None
) -> List[dict]:
    """Return recent questions (most recent first) for the sidebar.

    Pass ``conn`` to read a specific tenant's brain (the multi-tenant API does
    this); omit it to use the default brain DB (dashboard / demo).
    """
    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, question, created_at FROM questions "
            "ORDER BY id DESC LIMIT %s;",
            (limit,),
        )
        return [
            {
                "id": r[0],
                "question": r[1],
                "created_at": r[2].isoformat() if r[2] else None,
            }
            for r in cur.fetchall()
        ]


def get_question(
    question_id: int, conn: Optional[psycopg.Connection] = None
) -> Optional[dict]:
    """Full row (question + answer + sources) by id, or None.

    Pass ``conn`` to read a specific tenant's brain; omit it for the default.
    """
    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, question, answer, sources, created_at "
            "FROM questions WHERE id = %s;",
            (question_id,),
        )
        r = cur.fetchone()
    if r is None:
        return None
    return {
        "id": r[0],
        "question": r[1],
        "answer": r[2],
        "sources": r[3] or [],
        "created_at": r[4].isoformat() if r[4] else None,
    }


def delete_question(question_id: int) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM questions WHERE id = %s;", (question_id,))
        conn.commit()
