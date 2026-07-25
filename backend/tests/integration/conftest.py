"""Shared fixtures for integration tests.

Integration tests stand up the REAL stack — real Postgres, real provisioning,
the real FastAPI app — and only fake the two things that live outside our box
(Microsoft and the LLM). To keep them from ever touching demo data, the whole
control plane is redirected to a throwaway database (``iota_control_test``) for
the test session and dropped afterwards. Tenant databases created during a test
live on the same Postgres server and are dropped in teardown.

These tests need the local Postgres reachable (run them inside the api
container, which can reach the ``db`` host).
"""
from __future__ import annotations

import os
import secrets

import pytest

TEST_CONTROL_DB = "iota_control_test"

# Every test org's slug starts with this. Real customer slugs never do, so the
# fixtures can drop and recreate tenant databases by slug WITHOUT ever colliding
# with real data. This matters because tenant databases all live on the one
# shared Postgres server — only the *control* plane is redirected to a throwaway
# DB, not the per-tenant brain databases. The hard asserts below turn this
# convention into a guarantee: a destructive call can never touch a db whose
# slug isn't ours. (Learned the hard way: a bare "acme" slug once dropped the
# real iota_tenant_acme database.)
TEST_SLUG_PREFIX = "zz-inttest"


@pytest.fixture(scope="session", autouse=True)
def isolated_control_plane():
    """Point the entire stack at a throwaway control DB for the session.

    connection.py reads the DB URL from the environment on every call, so
    setting it here reroutes provisioning, auth, and the API alike — without
    touching the real iota_control database.
    """
    from src.db import connection

    orig_control = os.environ.get("CONTROL_DATABASE_URL")
    base = orig_control or os.environ["DATABASE_URL"]
    os.environ["CONTROL_DATABASE_URL"] = connection._swap_database(base, TEST_CONTROL_DB)
    # Auth needs a signing secret; dev-login must be reachable for the API tests.
    os.environ.setdefault("SESSION_SECRET", secrets.token_urlsafe(32))
    os.environ["IOTA_DEV_LOGIN"] = "1"

    from src.tenancy import provision

    provision.drop_database(TEST_CONTROL_DB)  # start from a clean slate
    provision.init_control_plane()
    try:
        yield
    finally:
        try:
            for row in provision.list_organizations():
                # Defence in depth: only ever drop databases we created.
                if row[0].startswith(TEST_SLUG_PREFIX):
                    provision.drop_database(provision.tenant_db_name(row[0]))
        except Exception:
            pass
        provision.drop_database(TEST_CONTROL_DB)
        if orig_control is None:
            os.environ.pop("CONTROL_DATABASE_URL", None)
        else:
            os.environ["CONTROL_DATABASE_URL"] = orig_control


@pytest.fixture
def make_org():
    """Provision a throwaway customer; drop it (and its database) after the test."""
    from src.tenancy import provision

    created: list[str] = []

    def _make(label: str, name: str | None = None, admin_email: str | None = None) -> dict:
        # The caller passes a short label ("acme"); we namespace it so the real
        # slug can never collide with a customer org. Tests should read the real
        # slug back from the returned dict (res["slug"]) for logins/assertions.
        slug = f"{TEST_SLUG_PREFIX}-{label}"
        assert slug.startswith(TEST_SLUG_PREFIX)  # never drop a non-test db
        # Clean slate so db_created is deterministic even after a crashed run.
        provision.drop_database(provision.tenant_db_name(slug))
        res = provision.create_organization(
            name or label.title(), slug, admin_email or f"admin@{slug}.test"
        )
        created.append(slug)
        return res

    yield _make

    for slug in created:
        if not slug.startswith(TEST_SLUG_PREFIX):
            continue  # paranoia: refuse to drop anything that isn't ours
        try:
            provision.drop_organization(slug, drop_db=True)
        except Exception:
            pass


@pytest.fixture
def app_client():
    """Factory for fresh TestClients (each gets its own cookie jar = its own login)."""
    from fastapi.testclient import TestClient

    from src.api.app import app

    def _new() -> "TestClient":
        return TestClient(app)

    return _new


def seed_entities(db_name: str, n: int) -> None:
    """Insert ``n`` person entities directly into a tenant's brain database."""
    from src.db.connection import get_tenant_connection

    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        for i in range(n):
            cur.execute(
                "INSERT INTO entities (type, name) VALUES ('person', %s);",
                (f"person-{i}",),
            )
        conn.commit()


def db_exists(name: str) -> bool:
    from src.db.connection import get_server_connection

    with get_server_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (name,))
        return cur.fetchone() is not None
