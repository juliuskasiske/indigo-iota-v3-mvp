"""Integration test: provisioning produces a real, usable workspace.

This stands up the REAL provisioning path against a throwaway control DB
(see conftest's ``isolated_control_plane``). It proves that creating an
organization actually:

  * creates and migrates a fresh tenant database,
  * registers it as 'active' in the control plane,
  * leaves the brain tables present and empty (ready for ingestion), and
  * gives each org its OWN database, so dropping one never touches another.

Nothing is mocked here — it talks to the same Postgres the app uses.
"""
from __future__ import annotations

from conftest import db_exists

from src.tenancy import provision


def _tenant_tables(db_name: str) -> dict:
    """Row counts for every brain table, proving they exist and are empty."""
    from src.db.connection import get_tenant_connection

    counts = {}
    tables = ("captured_events", "entities", "relationships", "triage_exclusions", "questions")
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        for t in tables:
            cur.execute(f"SELECT count(*) FROM {t};")
            counts[t] = cur.fetchone()[0]
    return counts


def test_provision_creates_a_migrated_active_workspace(make_org):
    res = make_org("acme")

    # The database was freshly created and migrated to a real schema version.
    assert res["db_created"] is True
    assert res["schema_version"]  # non-empty migration head
    assert db_exists(res["db_name"])

    # The org is registered and live in the control plane.
    rows = {row[0]: row for row in provision.list_organizations()}
    assert res["slug"] in rows
    assert rows[res["slug"]][2] == "active"  # status column

    # Every brain table exists and starts empty — a usable, blank workspace.
    counts = _tenant_tables(res["db_name"])
    assert counts == {
        "captured_events": 0,
        "entities": 0,
        "relationships": 0,
        "triage_exclusions": 0,
        "questions": 0,
    }


def test_two_orgs_get_distinct_databases_and_drop_is_isolated(make_org):
    a = make_org("alpha")
    b = make_org("beta")

    assert a["db_name"] != b["db_name"]
    assert db_exists(a["db_name"])
    assert db_exists(b["db_name"])

    # Dropping one org erases its database and leaves the other intact.
    provision.drop_organization(a["slug"], drop_db=True)
    assert not db_exists(a["db_name"])
    assert db_exists(b["db_name"])

    slugs = {row[0] for row in provision.list_organizations()}
    assert a["slug"] not in slugs
    assert b["slug"] in slugs
