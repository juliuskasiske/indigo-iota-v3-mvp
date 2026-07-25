"""Unit tests for the slug -> database-name mapping.

Each customer gets their own database named from their slug. This is the rule
that keeps two customers from ever colliding on one database, so it's worth
pinning: the prefix is fixed, hyphens become underscores (Postgres-safe), and
two different slugs always produce two different database names.

Pure function — no database, no network.
"""
from src.tenancy.provision import tenant_db_name


def test_simple_slug():
    assert tenant_db_name("acme") == "iota_tenant_acme"


def test_hyphens_become_underscores():
    assert tenant_db_name("eager-beaver") == "iota_tenant_eager_beaver"
    assert tenant_db_name("a-b-c") == "iota_tenant_a_b_c"


def test_distinct_slugs_map_to_distinct_db_names():
    names = {tenant_db_name(s) for s in ("acme", "eager-beaver", "globex", "initech")}
    assert len(names) == 4


def test_every_name_carries_the_tenant_prefix():
    for slug in ("acme", "eager-beaver", "x1"):
        assert tenant_db_name(slug).startswith("iota_tenant_")
