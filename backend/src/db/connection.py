# db/connection.py
"""
The connection layer: the one place that knows how to reach a database.

We run **database-per-tenant**, so there are several distinct targets:

  * the **control plane** DB (shared): organizations, users, roles, the
    tenant→database registry, audit log. Reached via ``get_control_connection``.
  * a **tenant brain** DB (one per customer): that customer's knowledge graph.
    Reached via ``get_tenant_connection(db_name)``.
  * the **maintenance** DB (``postgres``): only used to ``CREATE``/``DROP``
    DATABASE during provisioning. Reached via ``get_server_connection`` (which is
    autocommit, because CREATE DATABASE can't run inside a transaction).

All three live on the same Postgres server in the simple setup, so their URLs
are derived from one base by swapping the database name. To pin a tenant to its
own server later, store a full DSN in ``tenant_databases.dsn`` and pass it here.

``get_connection()`` (no args) is kept for backward compatibility: it targets
``DATABASE_URL``, the single local dev / demo database that reinit and the
dashboard use.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit

import psycopg
from dotenv import load_dotenv

# Load .env once, when this module is first imported, so the DB URLs are
# available. Doing it here means no other db file has to worry about it.
load_dotenv()


# --- URL helpers ------------------------------------------------------------

def _swap_database(url: str, dbname: str) -> str:
    """Return ``url`` with its database (path) component replaced by ``dbname``."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + dbname, parts.query, parts.fragment))


def database_name(url: str) -> str:
    """The database name embedded in a Postgres URL."""
    return urlsplit(url).path.lstrip("/")


def control_url() -> str:
    """URL of the shared control-plane database.

    Prefers ``CONTROL_DATABASE_URL``; otherwise derives it from ``DATABASE_URL``
    by pointing at a database named ``iota_control`` on the same server.
    """
    url = os.environ.get("CONTROL_DATABASE_URL")
    if url:
        return url
    base = os.environ.get("DATABASE_URL")
    if not base:
        raise RuntimeError(
            "Set CONTROL_DATABASE_URL (or at least DATABASE_URL) in the environment."
        )
    return _swap_database(base, "iota_control")


def control_db_name() -> str:
    return database_name(control_url())


def server_url() -> str:
    """URL of the maintenance database (``postgres``) on the control server.

    Used only to create/drop tenant databases.
    """
    return _swap_database(control_url(), "postgres")


def tenant_url(db_name: str) -> str:
    """URL of a tenant brain database living on the control server."""
    return _swap_database(control_url(), db_name)


# --- Connections ------------------------------------------------------------

def get_connection() -> psycopg.Connection:
    """Open a connection to ``DATABASE_URL`` (the local dev / demo database).

    Kept for backward compatibility — reinit, the dashboard, and the existing
    db modules call this. New multi-tenant code should use the explicit
    control/tenant helpers below.

    The caller closes it; the idiomatic way is a ``with`` block.
    """
    return psycopg.connect(os.environ["DATABASE_URL"])


def get_control_connection() -> psycopg.Connection:
    """Open a connection to the shared control-plane database."""
    return psycopg.connect(control_url())


def get_tenant_connection(db_name: str) -> psycopg.Connection:
    """Open a connection to a specific customer's brain database."""
    return psycopg.connect(tenant_url(db_name))


def get_server_connection() -> psycopg.Connection:
    """Open an autocommit connection to the maintenance DB for CREATE/DROP DATABASE."""
    return psycopg.connect(server_url(), autocommit=True)
