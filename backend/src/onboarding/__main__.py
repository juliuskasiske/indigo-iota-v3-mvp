"""Onboarding CLI: consent URLs, SSO wiring, and an end-to-end SSO check.

Typical flow for a new customer (slug already provisioned via
``python -m src.tenancy.provision create-org``):

    # 1. Generate the two admin-consent links to send to the customer's admin.
    python -m src.onboarding consent-urls --tenant-id <dir-id> \\
        --login-client-id <login-app-id> --connector-client-id <connector-app-id>

    # 2. After they consent, wire their tenant into our control plane.
    python -m src.onboarding set-sso --slug acme --tenant-id <dir-id> \\
        --client-id <login-app-id>

    # 3. Prove SSO is reachable + configured, and print the login URL to test.
    python -m src.onboarding verify --slug acme

The Login app's client SECRET is not passed here: it is one shared value read at
runtime from the SSO_CLIENT_SECRET env var (a secrets manager in prod), never
stored per tenant. Likewise the connector's app-only credentials (GRAPH_TENANT_ID
/ GRAPH_CLIENT_ID + certificate) live in the deployment environment, not the
control DB — they're read by GraphConfig.from_env at ingest time.
"""
from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlsplit

import httpx

from src.auth import oidc, service


def _app_base_url() -> str:
    return os.environ.get("APP_BASE_URL", "http://localhost:8080").rstrip("/")


def _default_redirect() -> str:
    """The SSO redirect URI; must be registered on the Login app verbatim."""
    return _app_base_url() + "/auth/callback"


def _default_consent_redirect() -> str:
    """Where Microsoft returns after admin consent. Must be a registered URI;
    the app root serves the static site (a clean 200 landing)."""
    return _app_base_url() + "/"


def _cmd_consent_urls(args: argparse.Namespace) -> int:
    redirect = args.redirect_uri or _default_consent_redirect()
    print("Send these to the customer's Entra (Global/Privileged Role) admin.")
    print("Each link grants tenant-wide admin consent for one app.\n")
    print("1) LOGIN app (delegated SSO: openid, profile, email):")
    print("   " + oidc.build_admin_consent_url(
        args.tenant_id, args.login_client_id, redirect, state="login"))
    print()
    print("2) CONNECTOR app (application Mail.Read, then scoped by policy):")
    print("   " + oidc.build_admin_consent_url(
        args.tenant_id, args.connector_client_id, redirect, state="connector"))
    print()
    print("After consent, run scripts/application-access-policy.ps1 to restrict")
    print("Mail.Read to the in-scope mailbox(es).")
    return 0


def _cmd_set_sso(args: argparse.Namespace) -> int:
    redirect = args.redirect_uri or _default_redirect()
    org_id = service.set_sso_connection(
        args.slug,
        tenant_id=args.tenant_id,
        client_id=args.client_id,
        redirect_uri=redirect,
        enabled=not args.disabled,
    )
    print(f"[onboarding] SSO wired for org '{args.slug}' (org_id={org_id}).")
    print(f"[onboarding]   tenant_id   = {args.tenant_id}")
    print(f"[onboarding]   client_id   = {args.client_id}")
    print(f"[onboarding]   redirect_uri= {redirect}")
    print(f"[onboarding]   enabled     = {not args.disabled}")
    print("[onboarding] Ensure this redirect_uri is registered on the Login app.")
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    sso = service.get_sso_config(args.slug)
    if not sso:
        print(f"[verify] FAIL: no enabled SSO connection for org '{args.slug}'. "
              f"Run set-sso first.", file=sys.stderr)
        return 1
    cfg, org = sso
    print(f"[verify] org '{org.slug}' (status={org.status})")
    print(f"[verify]   tenant_id    = {cfg.tenant_id}")
    print(f"[verify]   client_id    = {cfg.client_id}")
    print(f"[verify]   redirect_uri = {cfg.redirect_uri}")

    # Prove the tenant's OIDC metadata is reachable + the tenant id resolves.
    try:
        meta = oidc.discover(cfg.tenant_id)
    except httpx.HTTPError as exc:
        print(f"[verify] FAIL: cannot reach OIDC discovery for tenant "
              f"{cfg.tenant_id}: {exc}", file=sys.stderr)
        return 1
    print(f"[verify]   issuer       = {meta.get('issuer')}")
    print(f"[verify]   authz_endpt  = {meta.get('authorization_endpoint')}")

    # The redirect_uri host should match where the app is actually served.
    app_host = urlsplit(_app_base_url()).netloc
    redir_host = urlsplit(cfg.redirect_uri).netloc
    if app_host and redir_host and app_host != redir_host:
        print(f"[verify]   WARNING: redirect_uri host ({redir_host}) != "
              f"APP_BASE_URL host ({app_host}).")

    print("[verify] OK — discovery reachable. Test the full flow by opening:")
    print(f"    {_app_base_url()}/auth/{org.slug}/login")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m src.onboarding",
                                description="Customer SSO + connector onboarding.")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("consent-urls", help="Print the two admin-consent URLs.")
    c.add_argument("--tenant-id", required=True, help="Customer Entra directory (tenant) id.")
    c.add_argument("--login-client-id", required=True, help="Login app (client) id.")
    c.add_argument("--connector-client-id", required=True, help="Connector app (client) id.")
    c.add_argument("--redirect-uri", default=None,
                   help="Consent return URL (default: APP_BASE_URL/).")
    c.set_defaults(func=_cmd_consent_urls)

    s = sub.add_parser("set-sso", help="Wire an org's Entra SSO connection.")
    s.add_argument("--slug", required=True)
    s.add_argument("--tenant-id", required=True)
    s.add_argument("--client-id", required=True, help="Login app (client) id.")
    # No --client-secret: the Login app secret is the shared SSO_CLIENT_SECRET
    # env var (secrets manager in prod), never stored per tenant.
    s.add_argument("--redirect-uri", default=None,
                   help="SSO redirect (default: APP_BASE_URL/auth/callback).")
    s.add_argument("--disabled", action="store_true", help="Store but leave SSO disabled.")
    s.set_defaults(func=_cmd_set_sso)

    v = sub.add_parser("verify", help="Check an org's SSO config end-to-end.")
    v.add_argument("--slug", required=True)
    v.set_defaults(func=_cmd_verify)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
