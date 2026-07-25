"""Repository for the 'entities' table. All entity SQL lives in this file.

Every function takes an explicit ``conn`` (a brain connection the caller owns).
There is no implicit default: the caller decides which tenant brain it writes
to, so comprehended data can never silently land in the wrong database.
"""
from __future__ import annotations
import psycopg


def add_entity(
    conn: psycopg.Connection,
    entity_type: str,
    name: str,
    page_path: str | None = None,
) -> int:
    """
    Insert a new entity, return its generated id.

    entity_type: 'person' | 'company' | 'project'
    """
    with conn.cursor() as cur:
        # %s are safe placeholders — values passed separately, never
        # pasted into the string. RETURNING id gives back the new id.
        cur.execute(
            "INSERT INTO entities (type, name, page_path) "
            "VALUES (%s, %s, %s) RETURNING id;",
            (entity_type, name, page_path),
        )
        new_id: int = cur.fetchone()[0]
    conn.commit()
    return new_id


def find_entity(conn: psycopg.Connection, name: str, entity_type: str) -> int | None:
    """Find an entity by exact (name, type). Returns its id, or None if not found.

    Type is required so e.g. a 'Felix' person doesn't collide with a
    hypothetical 'Felix' project.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM entities WHERE name = %s AND type = %s;",
            (name, entity_type),
        )
        row = cur.fetchone()
    return row[0] if row else None


def update_entity_page_path(
    conn: psycopg.Connection, entity_id: int, page_path: str
) -> None:
    """Set or overwrite the page_path on an existing entity.

    Used when an entity was first created without a page (because it was
    referenced from another entity's frontmatter) and that entity's own
    brain page now exists.
    """
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE entities SET page_path = %s WHERE id = %s;",
            (page_path, entity_id),
        )
    conn.commit()


def get_entity(conn: psycopg.Connection, entity_id: int) -> dict | None:
    """Fetch a full entity by id. Returns a dict, or None if not found."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, type, name, page_path FROM entities WHERE id = %s;",
            (entity_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    # Turn the raw tuple into a labelled dict — easier for callers to use.
    return {"id": row[0], "type": row[1], "name": row[2], "page_path": row[3]}


def get_neighbors(
    conn: psycopg.Connection, entity_id: int, limit: int = 10
) -> list[dict]:
    """1-hop graph neighbours of ``entity_id``, in BOTH directions (the entity as
    subject or object). Returns [{id, type, name, page_path}] (distinct), capped
    at ``limit``. Used to assemble read-only brain-page context for comprehension.
    """
    if limit <= 0:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT n.id, n.type, n.name, n.page_path
            FROM relationships e
            JOIN entities n
              ON n.id = CASE WHEN e.subject = %s THEN e.object ELSE e.subject END
            WHERE e.subject = %s OR e.object = %s
            LIMIT %s;
            """,
            (entity_id, entity_id, entity_id, int(limit)),
        )
        rows = cur.fetchall()
    return [{"id": r[0], "type": r[1], "name": r[2], "page_path": r[3]} for r in rows]


def resolve_entity(
    conn: psycopg.Connection,
    entity_type: str,
    name: str,
    page_path: str | None = None,
) -> int:
    """
    Find an entity by (name, type), or create it if missing. Always returns an id.
    This is the entity-resolution function the indexing code calls.
    """
    existing = find_entity(conn, name, entity_type)
    if existing is not None:
        return existing
    return add_entity(conn, entity_type, name, page_path)
