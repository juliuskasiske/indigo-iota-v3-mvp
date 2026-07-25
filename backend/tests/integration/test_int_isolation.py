"""Integration test: tenant data is isolated through the REAL API.

The single most important promise of a multi-tenant system: one customer can
never see another's data. This proves it end-to-end — two real tenant
databases, a real signed-in session for each (via dev-login, standing in for
Microsoft), and the real ``/api/admin/usage`` endpoint — and asserts each admin
sees ONLY their own org's entity counts.

If row-routing ever regressed (e.g. a shared connection or a leaked db_name),
the counts would cross and this test would fail.
"""
from __future__ import annotations

from conftest import seed_entities


def _login(client, slug: str):
    resp = client.post("/auth/dev-login", json={"slug": slug, "email": f"admin@{slug}.test"})
    assert resp.status_code == 200, resp.text
    return resp


def test_each_admin_sees_only_their_own_orgs_entities(make_org, app_client):
    a = make_org("tenant-a")
    b = make_org("tenant-b")

    # Seed clearly different amounts straight into each brain database.
    seed_entities(a["db_name"], 3)
    seed_entities(b["db_name"], 1)

    # Two independent sessions (separate cookie jars = separate logins).
    client_a = app_client()
    client_b = app_client()
    _login(client_a, a["slug"])
    _login(client_b, b["slug"])

    usage_a = client_a.get("/api/admin/usage")
    usage_b = client_b.get("/api/admin/usage")
    assert usage_a.status_code == 200, usage_a.text
    assert usage_b.status_code == 200, usage_b.text

    body_a = usage_a.json()
    body_b = usage_b.json()

    # Each admin sees exactly their own org's count — no cross-tenant bleed.
    assert body_a["org"] == a["slug"]
    assert body_a["entities_mapped"] == 3
    assert body_b["org"] == b["slug"]
    assert body_b["entities_mapped"] == 1


def test_usage_requires_a_session(app_client):
    # No cookie, no data: the endpoint is gated by current_user (401).
    resp = app_client().get("/api/admin/usage")
    assert resp.status_code == 401
