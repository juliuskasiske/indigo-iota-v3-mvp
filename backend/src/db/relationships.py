"""Repository for the 'relationships' table. All relationship SQL lives here.

Every function takes an explicit ``conn`` (a brain connection the caller owns):
the caller decides which tenant brain it writes to.
"""
from __future__ import annotations
import psycopg


def add_relationship(
    conn: psycopg.Connection,
    subject: int,
    predicate: str,
    object_: int,
    source_page: str | None = None,
) -> int:
    """
    Insert a new relationship (a subject-predicate-object triple), return its id.

    Idempotent on the triple: if (subject, predicate, object) already
    exists in the table, the existing row's id is returned and no new
    row is inserted. The original source_page is preserved (later
    re-attestations don't overwrite it).

    subject / object_ are entity ids. ('object_' has a trailing underscore
    because 'object' is a reserved word in Python.)
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM relationships "
            "WHERE subject = %s AND predicate = %s AND object = %s "
            "LIMIT 1;",
            (subject, predicate, object_),
        )
        existing = cur.fetchone()
        if existing is not None:
            return existing[0]
        cur.execute(
            "INSERT INTO relationships (subject, predicate, object, source_page) "
            "VALUES (%s, %s, %s, %s) RETURNING id;",
            (subject, predicate, object_, source_page),
        )
        new_id: int = cur.fetchone()[0]
    conn.commit()
    return new_id


def get_relationships(conn: psycopg.Connection, entity_id: int) -> list[dict]:
    """Return all relationships where the given entity is the subject."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, subject, predicate, object, source_page "
            "FROM relationships WHERE subject = %s;",
            (entity_id,),
        )
        rows = cur.fetchall()
    # Convert each tuple row into a labelled dict.
    return [
        {
            "id": r[0],
            "subject": r[1],
            "predicate": r[2],
            "object": r[3],
            "source_page": r[4],
        }
        for r in rows
    ]
