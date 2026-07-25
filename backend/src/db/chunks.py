"""Repository for the 'chunks' table — embeddings + keywords. All chunk
SQL lives here. The hybrid search query is in this file too."""
from __future__ import annotations
from contextlib import nullcontext
from typing import List, Optional

import psycopg

from src.db.connection import get_connection
from src.ingestion.index.embeddings import to_pg_vector


def insert_chunks(conn: psycopg.Connection, chunks: List[dict]) -> None:
    """Bulk insert into the brain ``conn`` owns. Each chunk dict needs:
       page_path, entity_id, section, date, text, embedding (list[float])."""
    if not chunks:
        return
    with conn.cursor() as cur:
        for c in chunks:
            cur.execute(
                "INSERT INTO chunks "
                "  (page_path, entity_id, section, date, text, embedding, keywords) "
                "VALUES "
                "  (%s, %s, %s, %s, %s, %s::vector, to_tsvector('english', %s));",
                (
                    c["page_path"],
                    c["entity_id"],
                    c["section"],
                    c.get("date"),
                    c["text"],
                    to_pg_vector(c["embedding"]),
                    c["text"],
                ),
            )
    conn.commit()


def delete_chunks_for_page(conn: psycopg.Connection, page_path: str) -> None:
    """Drop every chunk sourced from this page. Called before re-syncing."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM chunks WHERE page_path = %s;", (page_path,))
    conn.commit()


def hybrid_search(
    query_text: str,
    query_embedding: List[float],
    limit: int = 10,
    candidate_pool: int = 30,
    conn: Optional[psycopg.Connection] = None,
) -> List[dict]:
    """Hybrid search: union of vector-top-N and keyword-top-N, scored
    as a weighted combination.

    Result dicts include `entity` info (type, name, page_path) joined
    from entities so the UI can render entity context without a second hop.

    Pass ``conn`` to search a specific tenant's brain (the multi-tenant API
    does this); omit it to use the default brain DB (dashboard / demo).
    """
    q_vec = to_pg_vector(query_embedding)
    cm = nullcontext(conn) if conn is not None else get_connection()
    with cm as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH vector_search AS (
              SELECT id, 1.0 - (embedding <=> %s::vector) AS vec_sim
              FROM chunks
              WHERE embedding IS NOT NULL
              ORDER BY embedding <=> %s::vector
              LIMIT %s
            ),
            keyword_search AS (
              SELECT id, ts_rank(keywords, plainto_tsquery('english', %s)) AS kw_rank
              FROM chunks
              WHERE keywords @@ plainto_tsquery('english', %s)
              ORDER BY kw_rank DESC
              LIMIT %s
            )
            SELECT
              c.id, c.page_path, c.entity_id, c.section, c.date, c.text,
              COALESCE(v.vec_sim,  0.0) AS vec_score,
              COALESCE(k.kw_rank,  0.0) AS kw_score,
              n.type, n.name, n.page_path
            FROM chunks c
            LEFT JOIN vector_search  v ON v.id = c.id
            LEFT JOIN keyword_search k ON k.id = c.id
            LEFT JOIN entities       n ON n.id = c.entity_id
            WHERE v.id IS NOT NULL OR k.id IS NOT NULL
            ORDER BY
              (COALESCE(v.vec_sim, 0.0) * 0.7
               + COALESCE(k.kw_rank, 0.0) * 0.3) DESC
            LIMIT %s;
            """,
            (q_vec, q_vec, candidate_pool,
             query_text, query_text, candidate_pool,
             limit),
        )
        rows = cur.fetchall()

    return [
        {
            "id": r[0],
            "page_path": r[1],
            "entity_id": r[2],
            "section": r[3],
            "date": r[4],
            "text": r[5],
            "vec_score": float(r[6]) if r[6] is not None else 0.0,
            "kw_score": float(r[7]) if r[7] is not None else 0.0,
            "entity": (
                {"type": r[8], "name": r[9], "page_path": r[10]}
                if r[8] is not None else None
            ),
        }
        for r in rows
    ]


def count_chunks() -> int:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM chunks;")
        return cur.fetchone()[0]


def get_chunks_for_page(page_path: str) -> List[dict]:
    """Debugging helper: every chunk for a given page."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, section, date, text FROM chunks "
            "WHERE page_path = %s ORDER BY id;",
            (page_path,),
        )
        return [
            {"id": r[0], "section": r[1], "date": r[2], "text": r[3]}
            for r in cur.fetchall()
        ]
