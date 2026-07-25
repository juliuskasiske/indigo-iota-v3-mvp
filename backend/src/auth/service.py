"""Control-plane lookups that back the auth flow.

Maps an authenticated Microsoft identity to *our* notion of who they are: which
organization, which role. All reads/writes go to the control-plane database.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from psycopg.types.json import Jsonb

from src.auth.oidc import OidcConfig
from src.db.connection import get_control_connection


@dataclass
class OrgContext:
    org_id: int
    slug: str
    name: str
    status: str


def get_sso_config(slug: str) -> tuple[OidcConfig, OrgContext] | None:
    """Return (OidcConfig, OrgContext) for an org's enabled SSO, else None."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.slug, o.name, o.status,
                   s.tenant_id, s.client_id, s.redirect_uri, s.enabled
            FROM organizations o
            JOIN sso_connections s ON s.org_id = o.id
            WHERE o.slug = %s;
            """,
            (slug,),
        )
        row = cur.fetchone()
    if not row or not row[7]:  # no row, or SSO disabled
        return None
    org = OrgContext(org_id=row[0], slug=row[1], name=row[2], status=row[3])
    # The Login app's client secret is a single shared value, supplied at runtime
    # via SSO_CLIENT_SECRET (secrets manager in prod) — never stored per tenant.
    cfg = OidcConfig(
        tenant_id=row[4],
        client_id=row[5],
        client_secret=os.environ.get("SSO_CLIENT_SECRET") or None,
        redirect_uri=row[6],
    )
    return cfg, org


def upsert_user_from_claims(claims: dict, tenant_id: str) -> int:
    """Find-or-create the user for these ID-token claims; return user id.

    Matches first on the Entra object id (``oid``), then falls back to email —
    which is how a pre-seeded admin (created by email at provisioning) gets
    linked to their Microsoft identity on first login.
    """
    oid = claims.get("oid")
    email = (claims.get("email") or claims.get("preferred_username") or "").lower()
    name = claims.get("name")

    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE entra_oid = %s;", (oid,))
            row = cur.fetchone()
            if row:
                user_id = row[0]
                cur.execute(
                    "UPDATE users SET display_name = COALESCE(%s, display_name), "
                    "entra_tenant_id = %s WHERE id = %s;",
                    (name, tenant_id, user_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO users (email, display_name, entra_oid, entra_tenant_id)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (email) DO UPDATE SET
                        entra_oid = EXCLUDED.entra_oid,
                        entra_tenant_id = EXCLUDED.entra_tenant_id,
                        display_name = COALESCE(EXCLUDED.display_name, users.display_name)
                    RETURNING id;
                    """,
                    (email, name, oid, tenant_id),
                )
                user_id = cur.fetchone()[0]
        conn.commit()
    return user_id


def resolve_role(user_id: int, org_id: int) -> str | None:
    """The user's role in the org, or None if they are not a member (= deny)."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT role FROM memberships WHERE user_id = %s AND org_id = %s;",
            (user_id, org_id),
        )
        row = cur.fetchone()
        return row[0] if row else None


def lookup_member_by_email(slug: str, email: str) -> tuple | None:
    """(org_id, org_slug, user_id, email, role) for a member — used by dev-login."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.slug, u.id, u.email, m.role
            FROM organizations o
            JOIN memberships m ON m.org_id = o.id
            JOIN users u ON u.id = m.user_id
            WHERE o.slug = %s AND lower(u.email) = lower(%s);
            """,
            (slug, email),
        )
        return cur.fetchone()


def org_id_for_slug(slug: str) -> int | None:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations WHERE slug = %s;", (slug,))
        row = cur.fetchone()
        return row[0] if row else None


def organizations_overview() -> list[dict]:
    """Every tenant with the bits the Control Tower needs at a glance:
    status, region, db, schema version, SSO state, and member count.
    """
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.slug, o.name, o.status, o.data_region,
                   td.db_name, td.schema_version,
                   s.tenant_id, COALESCE(s.enabled, FALSE) AS sso_enabled,
                   (s.org_id IS NOT NULL) AS sso_configured,
                   (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
                   o.auth_method, o.markup_factor
            FROM organizations o
            LEFT JOIN tenant_databases td ON td.org_id = o.id
            LEFT JOIN sso_connections s ON s.org_id = o.id
            WHERE o.status <> 'deleted'   -- hide erased tombstones from the roster
            ORDER BY o.created_at;
            """
        )
        return [
            {
                "slug": r[0],
                "name": r[1],
                "status": r[2],
                "region": r[3],
                "db_name": r[4],
                "schema_version": r[5],
                "sso_tenant_id": r[6],
                "sso_enabled": bool(r[7]),
                "sso_configured": bool(r[8]),
                "members": r[9],
                "auth_method": r[10],
                # Per-workspace customer markup override; None = global default.
                "markup_factor": float(r[11]) if r[11] is not None else None,
            }
            for r in cur.fetchall()
        ]


def add_member(slug: str, email: str, role: str, actor: str = "owner") -> dict:
    """Grant a person access to an org by email. Find-or-create the user, then
    upsert their membership. Returns a small summary.

    This is the missing 'invite' path: without a membership row, SSO/dev-login
    denies the user (resolve_role -> None). Lets the platform owner add admins
    and members beyond the one seeded at provisioning.
    """
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("Email is required.")
    if role not in ("admin", "consultant", "viewer"):
        raise ValueError(
            f"Role must be 'admin', 'consultant', or 'viewer', got {role!r}."
        )
    org_id = org_id_for_slug(slug)
    if org_id is None:
        raise ValueError(f"No organization with slug {slug!r}.")
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email)
                VALUES (%s)
                ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                RETURNING id;
                """,
                (email,),
            )
            user_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO memberships (org_id, user_id, role)
                VALUES (%s, %s, %s)
                ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;
                """,
                (org_id, user_id, role),
            )
            cur.execute(
                "INSERT INTO audit_log (org_id, actor, action, detail) "
                "VALUES (%s, %s, %s, %s);",
                (org_id, actor, "add_member", Jsonb({"email": email, "role": role})),
            )
        conn.commit()
    return {"email": email, "role": role, "user_id": user_id}


def list_members(slug: str) -> list[dict]:
    """Every member of an org: (email, role, has_logged_in)."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.email, m.role, (u.entra_oid IS NOT NULL) AS linked, u.id
            FROM organizations o
            JOIN memberships m ON m.org_id = o.id
            JOIN users u ON u.id = m.user_id
            WHERE o.slug = %s
            ORDER BY m.role, u.email;
            """,
            (slug,),
        )
        return [
            {"email": r[0], "role": r[1], "linked": bool(r[2]), "user_id": r[3]}
            for r in cur.fetchall()
        ]


def set_sso_connection(
    slug: str,
    *,
    tenant_id: str,
    client_id: str,
    redirect_uri: str,
    enabled: bool = True,
) -> int:
    """Create/replace an org's Entra SSO config. Returns the org id.

    Stores only the per-customer facts (tenant_id, the public Login app client_id,
    redirect_uri, enabled). The Login app's client secret is never stored here —
    it is a shared runtime value (SSO_CLIENT_SECRET); see get_sso_config.
    """
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM organizations WHERE slug = %s;", (slug,))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"No organization with slug {slug!r}. Provision it first.")
            org_id = row[0]
            cur.execute(
                """
                INSERT INTO sso_connections
                    (org_id, provider, tenant_id, client_id, redirect_uri, enabled, updated_at)
                VALUES (%s, 'entra', %s, %s, %s, %s, NOW())
                ON CONFLICT (org_id) DO UPDATE SET
                    tenant_id = EXCLUDED.tenant_id,
                    client_id = EXCLUDED.client_id,
                    redirect_uri = EXCLUDED.redirect_uri,
                    enabled = EXCLUDED.enabled,
                    updated_at = NOW();
                """,
                (org_id, tenant_id, client_id, redirect_uri, enabled),
            )
            cur.execute(
                "INSERT INTO audit_log (org_id, actor, action, detail) VALUES (%s, %s, %s, %s);",
                (
                    org_id,
                    "cli",
                    "set_sso",
                    Jsonb(
                        {
                            "tenant_id": tenant_id,
                            "client_id": client_id,
                            "redirect_uri": redirect_uri,
                            "enabled": enabled,
                        }
                    ),
                ),
            )
        conn.commit()
    return org_id
