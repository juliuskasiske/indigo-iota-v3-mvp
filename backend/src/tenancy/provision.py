"""Provisioning: create and manage customer tenants (database-per-tenant).

The whole point of database-per-tenant is that onboarding a customer is a real,
repeatable operation rather than a pile of manual SQL. ``create_organization``:

  1. ensures the control-plane database exists and is up to date,
  2. records the organization,
  3. creates that customer's OWN brain database (``iota_tenant_<slug>``),
  4. migrates it to head with the tenant migration runner,
  5. registers it in the tenant_databases registry,
  6. seeds the first admin user + membership, and
  7. marks the org active and writes an audit entry.

Every step is idempotent, so re-running it on an existing customer is safe.

CLI:
    python -m src.tenancy.provision init-control
    python -m src.tenancy.provision create-org --name "Acme GmbH" --slug acme \\
        --admin-email admin@acme.de
    python -m src.tenancy.provision list
    python -m src.tenancy.provision drop --slug acme --drop-db   # dev cleanup
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from psycopg.types.json import Jsonb

from src.db.connection import (
    control_db_name,
    get_control_connection,
    get_server_connection,
    get_tenant_connection,
)
from src.db.migrate import apply_migrations, current_version

_CONTROL_SCHEMA: Path = Path(__file__).resolve().parents[1] / "db" / "control_schema.sql"

# Slugs become part of a Postgres database name, so keep them strict and safe:
# 2–40 chars, lowercase letters / digits / hyphens, no leading/trailing hyphen.
_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")


# --- naming + validation ----------------------------------------------------

def tenant_db_name(slug: str) -> str:
    """The database name for a customer slug (hyphens → underscores for SQL)."""
    return "iota_tenant_" + slug.replace("-", "_")


def _validate_slug(slug: str) -> None:
    if not _SLUG_RE.match(slug):
        raise ValueError(
            f"Invalid slug {slug!r}: use 2–40 chars, lowercase letters, digits and "
            "hyphens (no leading/trailing hyphen)."
        )


# --- low-level database operations ------------------------------------------

def ensure_database(name: str) -> bool:
    """CREATE DATABASE ``name`` if it doesn't already exist. Returns True if created.

    Uses the autocommit maintenance connection (CREATE DATABASE can't run inside
    a transaction). ``name`` is always validated/derived, never user SQL.
    """
    with get_server_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (name,))
        if cur.fetchone():
            return False
        cur.execute(f'CREATE DATABASE "{name}";')
        return True


def drop_database(name: str) -> None:
    """DROP DATABASE ``name`` if it exists (FORCE-closing other connections)."""
    with get_server_connection() as conn, conn.cursor() as cur:
        cur.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE);')


# --- control plane ----------------------------------------------------------

def init_control_plane() -> bool:
    """Ensure the control-plane database exists and its schema is applied.

    Idempotent. Returns True if the database itself was created this call.
    """
    created = ensure_database(control_db_name())
    sql = _CONTROL_SCHEMA.read_text(encoding="utf-8")
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    return created


def _audit(cur, org_id: int | None, actor: str, action: str, detail: dict) -> None:
    cur.execute(
        "INSERT INTO audit_log (org_id, actor, action, detail) VALUES (%s, %s, %s, %s);",
        (org_id, actor, action, Jsonb(detail)),
    )


# --- the main operation -----------------------------------------------------

def create_organization(
    name: str,
    slug: str,
    admin_email: str,
    region: str = "EU",
    auth_method: str = "entra",
) -> dict:
    """Provision a customer end-to-end. Idempotent. Returns a small summary.

    ``auth_method`` picks how members sign in: 'entra' (Microsoft SSO) or 'native'
    (email + password + TOTP, for IMAP customers with no Microsoft tenant).
    """
    _validate_slug(slug)
    if auth_method not in ("entra", "native"):
        raise ValueError("auth_method must be 'entra' or 'native'.")
    init_control_plane()  # make sure control DB + schema exist

    db_name = tenant_db_name(slug)

    # 1. upsert the organization (status starts as 'provisioning')
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO organizations (slug, name, data_region, status, auth_method)
                VALUES (%s, %s, %s, 'provisioning', %s)
                ON CONFLICT (slug)
                    DO UPDATE SET name = EXCLUDED.name,
                                  data_region = EXCLUDED.data_region,
                                  auth_method = EXCLUDED.auth_method
                RETURNING id;
                """,
                (slug, name, region, auth_method),
            )
            org_id = cur.fetchone()[0]
        conn.commit()

    # 2. create + migrate the tenant's own brain database
    db_created = ensure_database(db_name)
    with get_tenant_connection(db_name) as tconn:
        applied = apply_migrations(tconn)
        head = current_version(tconn)

    # 3. register the DB, seed the admin, activate the org — one control txn
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tenant_databases (org_id, db_name, schema_version, status)
                VALUES (%s, %s, %s, 'active')
                ON CONFLICT (db_name)
                    DO UPDATE SET schema_version = EXCLUDED.schema_version,
                                  status = 'active';
                """,
                (org_id, db_name, head),
            )
            cur.execute(
                """
                INSERT INTO users (email)
                VALUES (%s)
                ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                RETURNING id;
                """,
                (admin_email,),
            )
            user_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO memberships (org_id, user_id, role)
                VALUES (%s, %s, 'admin')
                ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin';
                """,
                (org_id, user_id),
            )
            cur.execute("UPDATE organizations SET status = 'active' WHERE id = %s;", (org_id,))
            _audit(
                cur,
                org_id,
                admin_email,
                "create_organization",
                {
                    "db_name": db_name,
                    "db_created": db_created,
                    "migrations_applied": applied,
                    "schema_version": head,
                },
            )
        conn.commit()

    return {
        "org_id": org_id,
        "slug": slug,
        "db_name": db_name,
        "db_created": db_created,
        "migrations_applied": applied,
        "schema_version": head,
        "admin_email": admin_email,
    }


def list_organizations() -> list[tuple]:
    """Return (slug, name, status, region, db_name, schema_version) per org."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.slug, o.name, o.status, o.data_region,
                   td.db_name, td.schema_version
            FROM organizations o
            LEFT JOIN tenant_databases td ON td.org_id = o.id
            ORDER BY o.created_at;
            """
        )
        return cur.fetchall()


def migrate_all_tenants() -> list[dict]:
    """Bring every existing tenant brain DB up to schema head. Idempotent.

    New tenant migrations only run automatically when a tenant is *provisioned*;
    an already-provisioned customer would otherwise stay on the old schema until
    someone hand-migrated each database. This closes that gap: run it on every
    API boot (see infra/prod/entrypoint.sh) so adding a ``NNNN_*.sql`` migration
    upgrades all live tenants the next time the service restarts.

    A failure on one tenant is logged and does NOT stop the others — one broken
    database must never block every other customer's API from starting. Returns
    a per-tenant result list (slug, db_name, applied versions or error).
    """
    results: list[dict] = []
    for slug, _name, status, _region, db_name, _schema in list_organizations():
        if not db_name:
            continue  # org still provisioning — no tenant DB yet
        try:
            with get_tenant_connection(db_name) as tconn:
                applied = apply_migrations(tconn)
                head = current_version(tconn)
            # Keep the registry's recorded schema version honest.
            with get_control_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE tenant_databases SET schema_version = %s "
                        "WHERE db_name = %s;",
                        (head, db_name),
                    )
                conn.commit()
            if applied:
                print(
                    f"[provision] {slug}: applied {len(applied)} migration(s) "
                    f"-> {head} ({', '.join(applied)})"
                )
            else:
                print(f"[provision] {slug}: already at head ({head}).")
            results.append({"slug": slug, "db_name": db_name, "applied": applied})
        except Exception as exc:  # one bad tenant must not block the rest
            print(
                f"[provision] ERROR migrating {slug} ({db_name}): {exc}",
                file=sys.stderr,
            )
            results.append({"slug": slug, "db_name": db_name, "error": str(exc)})
    return results


def drop_organization(slug: str, drop_db: bool = False, actor: str = "cli") -> None:
    """Remove an org from the control plane. With ``drop_db``, also DROP its database.

    Cascades to memberships and the registry row. Intended for dev cleanup and
    for the Art. 17 'right to erasure' path (drop_db=True wipes everything).

    Writes an ``erase_organization`` audit row in the SAME transaction as the
    delete, so erasure is never silent: either both land or neither does. The
    org's slug/id/db_name go in ``detail`` because the audit row's ``org_id``
    column nulls out the instant this delete cascades (ON DELETE SET NULL).
    """
    db_name = tenant_db_name(slug)
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM organizations WHERE slug = %s;", (slug,))
            row = cur.fetchone()
            if row is not None:
                org_id = row[0]
                _audit(
                    cur,
                    org_id,
                    actor,
                    "erase_organization",
                    {
                        "slug": slug,
                        "org_id": org_id,
                        "db_name": db_name,
                        "drop_db": drop_db,
                    },
                )
                cur.execute("DELETE FROM organizations WHERE id = %s;", (org_id,))
        conn.commit()
    if row is None:
        print(f"[provision] no organization with slug {slug!r}.")
    if drop_db:
        drop_database(db_name)
        print(f"[provision] dropped database {db_name}.")


# Personal, org-scoped control-plane tables wiped on erasure. The org row is
# KEPT (tombstoned) so nothing cascades — each is deleted explicitly, in FK-safe
# order (children before anything they point at). llm_usage_events / credit_entries
# / audit_log are deliberately absent: they are the financial ledger and survive.
_ORG_PERSONAL_TABLES: tuple[str, ...] = (
    "oauth_tokens",
    "oauth_auth_codes",
    "mcp_tokens",
    "sso_connections",
    "tenant_databases",
    "memberships",
)


def erase_organization(slug: str, *, actor: str = "cli") -> dict:
    """GDPR Art. 17 erasure of a whole workspace. Idempotent and resumable.

    Drops the tenant database OUTRIGHT (every email, entity and embedding the
    customer ever had) and wipes all personal data from the control plane, while
    keeping the organization row as a financial *tombstone* (status='deleted').
    That tombstone is the whole point of the differentiation: because the org row
    survives, llm_usage_events / credit_entries / audit_log keep their org_id and
    stay attributable for accounting — only the personal data is erased.

    Order matters and is failure-safe:
      1. flip status to 'deleting' (the scheduler skips any non-active org, so
         sync stops touching the tenant DB before we drop it),
      2. DROP DATABASE ... WITH (FORCE) — outside any txn, FORCE-closing the
         scheduler's lingering connections,
      3. one control-plane txn: delete every org-scoped personal row, erase any
         member left with no other membership (a global user) plus their
         credentials/TOTP/tokens via cascade, tombstone the org, and write the
         erasure audit row — all-or-nothing.

    Re-running after a mid-way failure is safe: step 2 is IF EXISTS, step 3's
    deletes are idempotent, and a tombstoned org simply gets re-tombstoned.
    """
    db_name = tenant_db_name(slug)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations WHERE slug = %s;", (slug,))
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"No organization with slug {slug!r}.")
    org_id = row[0]

    # 1. Stop the scheduler from touching this tenant before we drop its DB.
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE organizations SET status = 'deleting' WHERE id = %s;", (org_id,)
            )
        conn.commit()

    # 2. Drop the tenant database in full (irreversible). FORCE closes any
    #    connection the sync worker still holds open.
    drop_database(db_name)

    # 3. Wipe control-plane personal data + tombstone the org — one transaction.
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM memberships WHERE org_id = %s;", (org_id,))
            member_ids = [r[0] for r in cur.fetchall()]

            for table in _ORG_PERSONAL_TABLES:
                cur.execute(f"DELETE FROM {table} WHERE org_id = %s;", (org_id,))

            # users are GLOBAL (shared across workspaces): only erase a member who
            # now belongs to no org at all. Deleting the user cascades to their
            # local_credentials / auth_tokens / totp_secrets / totp_backup_codes.
            users_deleted: list[int] = []
            for uid in member_ids:
                cur.execute(
                    "SELECT 1 FROM memberships WHERE user_id = %s LIMIT 1;", (uid,)
                )
                if cur.fetchone() is None:
                    cur.execute("DELETE FROM users WHERE id = %s;", (uid,))
                    users_deleted.append(uid)

            cur.execute(
                "UPDATE organizations SET status = 'deleted' WHERE id = %s;", (org_id,)
            )
            _audit(
                cur,
                org_id,
                actor,
                "erase_organization",
                {
                    "slug": slug,
                    "org_id": org_id,
                    "db_name": db_name,
                    "members_removed": len(member_ids),
                    "users_deleted": users_deleted,
                },
            )
        conn.commit()

    print(
        f"[provision] erased workspace {slug!r}: dropped {db_name}, removed "
        f"{len(member_ids)} membership(s), deleted {len(users_deleted)} orphaned user(s)."
    )
    return {
        "slug": slug,
        "org_id": org_id,
        "db_name": db_name,
        "members_removed": len(member_ids),
        "users_deleted": len(users_deleted),
    }


# --- CLI --------------------------------------------------------------------

def _cmd_init_control(_args) -> None:
    created = init_control_plane()
    where = control_db_name()
    print(
        f"[provision] control plane ready on database '{where}' "
        f"({'created' if created else 'already existed'})."
    )


def _cmd_create_org(args) -> None:
    result = create_organization(
        name=args.name, slug=args.slug, admin_email=args.admin_email,
        region=args.region, auth_method=args.auth_method,
    )
    print("[provision] organization provisioned:")
    for k, v in result.items():
        print(f"    {k:18} {v}")


def _cmd_list(_args) -> None:
    rows = list_organizations()
    if not rows:
        print("[provision] no organizations yet.")
        return
    print(f"{'slug':16} {'status':13} {'region':8} {'db_name':28} {'schema':28} name")
    for slug, name, status, region, db_name, schema_version in rows:
        print(
            f"{slug:16} {status:13} {region:8} "
            f"{(db_name or '-'):28} {(schema_version or '-'):28} {name}"
        )


def _cmd_invite(args) -> None:
    """Mint (and send) an invite link for a native-auth member — used to bootstrap
    the first admin of a freshly-provisioned 'native' org, or to re-send an
    invite. The member must already exist (provisioning seeds the first admin)."""
    import os as _os

    from src import mailer
    from src.auth import native_auth, service

    if not native_auth.org_uses_native(args.slug):
        raise SystemExit(
            f"Org {args.slug!r} does not use native auth (auth_method != 'native'). "
            "Provision it with --auth-method native, or use set-sso for Microsoft."
        )
    row = service.lookup_member_by_email(args.slug, args.email)
    if not row:
        raise SystemExit(
            f"{args.email!r} is not a member of {args.slug!r}. Add them first "
            "(the admin UI invite, or re-provision seeds the first admin)."
        )
    user_id = row[2]
    raw = native_auth.issue_invite(user_id)
    base = (_os.environ.get("IOTA_PUBLIC_BASE_URL")
            or _os.environ.get("APP_BASE_URL", "http://localhost:3000")).rstrip("/")
    link = f"{base}/accept-invite?token={raw}"
    text = (
        f"You've been invited to Indigo Iota.\n\nSet your password and finish setup:\n{link}\n\n"
        f"This link expires in {native_auth.INVITE_TTL_HOURS} hours."
    )
    mailer.send_email(args.email, "Your Indigo Iota invitation", text)
    sent = "emailed" if mailer.is_configured() else "logged (SMTP not configured)"
    print(f"[provision] invite for {args.email!r} in {args.slug!r} {sent}.")
    print(f"[provision] accept link: {link}")


def _cmd_set_sso(args) -> None:
    from src.auth.service import set_sso_connection

    org_id = set_sso_connection(
        args.slug,
        tenant_id=args.tenant_id,
        client_id=args.client_id,
        redirect_uri=args.redirect_uri,
        enabled=not args.disabled,
    )
    print(
        f"[provision] EntraID SSO configured for org {args.slug!r} (id {org_id}); "
        f"enabled={not args.disabled}."
    )


def _cmd_migrate_tenants(_args) -> None:
    results = migrate_all_tenants()
    if not results:
        print("[provision] no tenant databases to migrate.")
        return
    failed = [r for r in results if "error" in r]
    print(
        f"[provision] migrated {len(results) - len(failed)}/{len(results)} "
        f"tenant database(s) to head."
    )
    if failed:
        # Surface a non-zero exit so a human notices, but only AFTER every
        # tenant has been attempted (the boot path swallows this; see entrypoint).
        sys.exit(1)


def _cmd_drop(args) -> None:
    drop_organization(args.slug, drop_db=args.drop_db)
    print(f"[provision] removed organization {args.slug!r} from the control plane.")


def _cmd_erase(args) -> None:
    erase_organization(args.slug, actor="cli")


def main() -> None:
    parser = argparse.ArgumentParser(description="Indigo Iota tenant provisioning.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init-control", help="Create/upgrade the control-plane DB.")
    p_init.set_defaults(func=_cmd_init_control)

    p_create = sub.add_parser("create-org", help="Provision a new customer tenant.")
    p_create.add_argument("--name", required=True, help="Display name, e.g. 'Acme GmbH'.")
    p_create.add_argument("--slug", required=True, help="URL-safe key, e.g. 'acme'.")
    p_create.add_argument("--admin-email", required=True, help="First admin's email.")
    p_create.add_argument("--region", default="EU", help="Data region label (default: EU).")
    p_create.add_argument(
        "--auth-method", default="entra", choices=["entra", "native"],
        help="How members sign in: 'entra' (Microsoft SSO) or 'native' "
             "(email+password+TOTP, for IMAP customers). Default: entra.",
    )
    p_create.set_defaults(func=_cmd_create_org)

    p_list = sub.add_parser("list", help="List organizations and their tenant DBs.")
    p_list.set_defaults(func=_cmd_list)

    p_migrate = sub.add_parser(
        "migrate-tenants",
        help="Bring every existing tenant brain DB up to schema head (idempotent).",
    )
    p_migrate.set_defaults(func=_cmd_migrate_tenants)

    p_invite = sub.add_parser(
        "invite", help="Mint/send a native-auth invite link (bootstrap first admin)."
    )
    p_invite.add_argument("--slug", required=True)
    p_invite.add_argument("--email", required=True, help="An existing member's email.")
    p_invite.set_defaults(func=_cmd_invite)

    p_sso = sub.add_parser("set-sso", help="Configure an org's EntraID SSO.")
    p_sso.add_argument("--slug", required=True)
    p_sso.add_argument("--tenant-id", required=True, help="Entra directory (tenant) id.")
    p_sso.add_argument("--client-id", required=True, help="App registration client id.")
    # The Login app's client secret is the shared SSO_CLIENT_SECRET env var, not
    # a per-tenant flag — see src/db/control_schema.sql.
    p_sso.add_argument(
        "--redirect-uri", required=True,
        help="Must match the app registration, e.g. https://api.indigo-iota.com/auth/callback",
    )
    p_sso.add_argument("--disabled", action="store_true", help="Store but disable SSO.")
    p_sso.set_defaults(func=_cmd_set_sso)

    p_drop = sub.add_parser("drop", help="Remove an org (optionally drop its database).")
    p_drop.add_argument("--slug", required=True)
    p_drop.add_argument(
        "--drop-db",
        action="store_true",
        help="Also DROP the tenant database (irreversible — erasure).",
    )
    p_drop.set_defaults(func=_cmd_drop)

    p_erase = sub.add_parser(
        "erase",
        help="GDPR erasure: drop the tenant DB + wipe personal control-plane data, "
        "keeping the org as a financial tombstone (status='deleted').",
    )
    p_erase.add_argument("--slug", required=True)
    p_erase.set_defaults(func=_cmd_erase)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
