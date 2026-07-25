"""A tiny, dependency-free SQL migration runner.

Why not Alembic? This codebase is raw psycopg3 with no ORM, and our schema
lives as plain SQL. Alembic would pull in SQLAlchemy purely for version
tracking, and with no models we'd hand-write raw-SQL migrations anyway. So we
keep it lean: ordered ``NNNN_name.sql`` files in a directory, applied in order,
each recorded once in a ``schema_migrations`` table.

This is exactly what database-per-tenant needs — point the runner at any tenant
database and it brings *that* database up to head, independently of every other
tenant. The same runner builds the local dev database and every customer's
brain database from the identical set of files, so they can never drift.

To evolve the schema: add a new file (e.g. ``0002_add_thing.sql``). Never edit
an already-applied file.
"""
from __future__ import annotations

from pathlib import Path

import psycopg

# backend/migrations/tenant  (this file is backend/src/db/migrate.py)
TENANT_MIGRATIONS_DIR: Path = Path(__file__).resolve().parents[2] / "migrations" / "tenant"

_TRACKING_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);
"""


def _migration_files(migrations_dir: Path) -> list[Path]:
    """All ``*.sql`` files in the directory, sorted by name (so 0001 < 0002)."""
    return sorted(p for p in migrations_dir.glob("*.sql") if p.is_file())


def _applied_versions(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT version FROM schema_migrations;")
        return {row[0] for row in cur.fetchall()}


def apply_migrations(
    conn: psycopg.Connection,
    migrations_dir: Path = TENANT_MIGRATIONS_DIR,
) -> list[str]:
    """Apply every pending migration to ``conn``'s database, in order.

    Each migration runs in its own transaction together with the bookkeeping
    insert, so a failure leaves the database at a clean, known version. Returns
    the list of versions that were applied this call (empty if already at head).
    """
    files = _migration_files(migrations_dir)
    with conn.cursor() as cur:
        cur.execute(_TRACKING_DDL)
    conn.commit()

    done = _applied_versions(conn)
    applied: list[str] = []
    for path in files:
        version = path.stem  # e.g. '0001_initial_brain_schema'
        if version in done:
            continue
        sql = path.read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s);", (version,)
            )
        conn.commit()
        applied.append(version)
    return applied


def current_version(conn: psycopg.Connection) -> str | None:
    """The highest migration version applied to ``conn``'s database, or None."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
        )
        row = cur.fetchone()
        return row[0] if row else None
