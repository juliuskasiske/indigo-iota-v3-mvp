"""Repository for the 'brain_pages' table — the durable home of brain page JSON.

A brain page is the source of truth; the entities/relationships/chunks tables
are a derived index rebuilt from it. The page used to be a JSON file on disk,
which doesn't survive a container redeploy and isn't shared between the api and
sync services. It now lives in a row, keyed by the same relative ``page_path``
string the entities/chunks tables reference (e.g. 'persons/felix-kasiske.json').

Every function takes an explicit ``conn`` (a brain connection the caller owns):
the caller decides which tenant brain it reads from or writes to.
"""
from __future__ import annotations
import json

import psycopg


def save_page(
    conn: psycopg.Connection,
    page_path: str,
    entity_type: str,
    data: dict,
) -> None:
    """Upsert one brain page. Idempotent on ``page_path`` — re-saving replaces
    the stored JSON (the page is rewritten in full on each comprehend)."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO brain_pages (page_path, entity_type, data) "
            "VALUES (%s, %s, %s::jsonb) "
            "ON CONFLICT (page_path) DO UPDATE "
            "SET data = EXCLUDED.data, "
            "    entity_type = EXCLUDED.entity_type, "
            "    updated_at = now();",
            (page_path, entity_type, json.dumps(data)),
        )
    conn.commit()


def delete_page(conn: psycopg.Connection, page_path: str) -> bool:
    """Delete the brain page at ``page_path``. Returns True if a row was removed.

    Only removes the page JSON itself — the derived index (entities / chunks /
    relationships) is the caller's responsibility (see starter_entities.
    delete_seeded_entity, which clears those first). Caller owns the transaction.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM brain_pages WHERE page_path = %s;", (page_path,))
        removed = cur.rowcount > 0
    conn.commit()
    return removed


def load_page(conn: psycopg.Connection, page_path: str) -> dict | None:
    """Return the stored page JSON for ``page_path``, or None if absent."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT data FROM brain_pages WHERE page_path = %s;", (page_path,)
        )
        row = cur.fetchone()
    return row[0] if row is not None else None


def page_exists(conn: psycopg.Connection, page_path: str) -> bool:
    """True if a page is stored at ``page_path``."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM brain_pages WHERE page_path = %s LIMIT 1;",
            (page_path,),
        )
        return cur.fetchone() is not None


def list_pages(
    conn: psycopg.Connection, entity_type: str | None = None
) -> list[dict]:
    """Return [{page_path, entity_type, data}, ...], optionally filtered by type."""
    with conn.cursor() as cur:
        if entity_type is not None:
            cur.execute(
                "SELECT page_path, entity_type, data FROM brain_pages "
                "WHERE entity_type = %s ORDER BY page_path;",
                (entity_type,),
            )
        else:
            cur.execute(
                "SELECT page_path, entity_type, data FROM brain_pages "
                "ORDER BY page_path;"
            )
        return [
            {"page_path": r[0], "entity_type": r[1], "data": r[2]}
            for r in cur.fetchall()
        ]


def list_seeded_pages(conn: psycopg.Connection) -> list[dict]:
    """Return only the hand-placed starter (anchor) pages, newest first.

    A starter page carries ``data->>'seeded' = 'true'`` — set when an admin
    pre-creates the entity in the Admin Center so later comprehended mentions
    canonicalize onto it. Pages the comprehend pipeline builds from email don't
    carry that flag, so they're excluded here.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT page_path, entity_type, data FROM brain_pages "
            "WHERE data->>'seeded' = 'true' "
            "ORDER BY updated_at DESC, page_path;"
        )
        return [
            {"page_path": r[0], "entity_type": r[1], "data": r[2]}
            for r in cur.fetchall()
        ]


def get_principal(conn: psycopg.Connection) -> dict | None:
    """The workspace's 'center of gravity' page — the one flagged
    ``data->>'is_principal' = 'true'`` — or None if none is set."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT page_path, entity_type, data FROM brain_pages "
            "WHERE data->>'is_principal' = 'true' LIMIT 1;"
        )
        r = cur.fetchone()
    if r is None:
        return None
    return {"page_path": r[0], "entity_type": r[1], "data": r[2]}


def clear_principal(conn: psycopg.Connection) -> None:
    """Drop the is_principal flag from whatever page currently holds it.

    A workspace has exactly one center of gravity, so designating a new
    principal must first clear the old one. Caller owns the transaction."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE brain_pages SET data = data - 'is_principal' "
            "WHERE data->>'is_principal' IS NOT NULL;"
        )
