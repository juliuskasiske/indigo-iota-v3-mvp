"""Applies the tenant (brain) schema to the database named by DATABASE_URL.

Thin compatibility wrapper: reinit and scripts/ call this as ``apply_schema``.
The schema itself now lives as ordered SQL migrations under
``migrations/tenant/`` and is applied by the migration runner, so the local dev
database and every provisioned customer database are built from the exact same
source and cannot drift.
"""
from __future__ import annotations

from src.db.connection import get_connection
from src.db.migrate import apply_migrations, current_version


def main() -> None:
    with get_connection() as conn:
        applied = apply_migrations(conn)
        head = current_version(conn)
    if applied:
        print(f"Schema applied — migrations: {', '.join(applied)} (head: {head}).")
    else:
        print(f"Schema up to date (head: {head}).")


if __name__ == "__main__":
    main()
