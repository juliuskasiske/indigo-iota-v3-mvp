"""The OIDC authorization-code-with-PKCE flow against EntraID.

Deliberately small and dependency-light: ``httpx`` for HTTP and ``pyjwt`` (with
``cryptography``) for ID-token signature validation via the tenant's JWKS. No
Authlib/MSAL.

App model (see src/onboarding): ONE multi-tenant "Login" app, registered in our
own tenant and reused for every customer — not a separate registration per
customer. Each customer's admin consents to it once. At sign-in we point at the
customer's OWN tenant authority (not ``/common``) so only their directory can
log in and the ID-token issuer is pinned to that single tenant:

    https://login.microsoftonline.com/{tenant_id}/v2.0

So a customer's SSO row (sso_connections) carries that customer's tenant_id
alongside the SAME shared Login-app client_id used for everyone. The Login app's
client SECRET is not stored per customer at all — it is one shared value supplied
at runtime via the SSO_CLIENT_SECRET env var (a secrets manager in prod), so a
database dump can never leak it and it rotates in one place.

Flow:
    1. build_authorization_url() -> redirect the user to Microsoft
    2. (user signs in; Microsoft redirects back with ?code & ?state)
    3. exchange_code() -> swap the code for tokens (proving PKCE verifier)
    4. validate_id_token() -> verify signature/issuer/audience/expiry + nonce
"""
from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
import jwt

AUTHORITY = "https://login.microsoftonline.com"
SCOPE = "openid profile email"
_HTTP_TIMEOUT = 10.0


@dataclass
class OidcConfig:
    tenant_id: str
    client_id: str
    client_secret: str | None
    redirect_uri: str


# --- discovery (cached per tenant) ------------------------------------------

_discovery_cache: dict[str, dict] = {}
_jwks_cache: dict[str, jwt.PyJWKClient] = {}


def discovery_url(tenant_id: str) -> str:
    return f"{AUTHORITY}/{tenant_id}/v2.0/.well-known/openid-configuration"


def discover(tenant_id: str) -> dict:
    """Fetch (and cache) the tenant's OIDC metadata document."""
    meta = _discovery_cache.get(tenant_id)
    if meta is None:
        resp = httpx.get(discovery_url(tenant_id), timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        meta = resp.json()
        _discovery_cache[tenant_id] = meta
    return meta


def _jwks_client(jwks_uri: str) -> jwt.PyJWKClient:
    client = _jwks_cache.get(jwks_uri)
    if client is None:
        client = jwt.PyJWKClient(jwks_uri)
        _jwks_cache[jwks_uri] = client
    return client


# --- PKCE + CSRF helpers ----------------------------------------------------

def make_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE S256."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def new_state() -> str:
    return secrets.token_urlsafe(32)


def new_nonce() -> str:
    return secrets.token_urlsafe(32)


# --- the flow ---------------------------------------------------------------

def build_admin_consent_url(
    tenant_id: str, client_id: str, redirect_uri: str, *, state: str | None = None
) -> str:
    """The URL a customer's Entra admin clicks to grant tenant-wide consent.

    Hitting the ``/adminconsent`` endpoint grants admin consent for *all* the
    permissions configured on the app registration — both the delegated SSO
    scopes (Login app) and the application permission Mail.Read (Connector app).
    After the admin approves, Microsoft redirects to ``redirect_uri`` with
    ``?admin_consent=True&tenant={dir_id}&state={state}``.

    This is how a multi-tenant app gets provisioned into the customer's tenant
    without us ever holding their admin credentials: we send a link, they click.
    """
    params: dict[str, str] = {"client_id": client_id, "redirect_uri": redirect_uri}
    if state:
        params["state"] = state
    return f"{AUTHORITY}/{tenant_id}/adminconsent?" + urlencode(params)


def build_authorization_url(
    cfg: OidcConfig, *, state: str, nonce: str, code_challenge: str
) -> str:
    meta = discover(cfg.tenant_id)
    params = {
        "client_id": cfg.client_id,
        "response_type": "code",
        "redirect_uri": cfg.redirect_uri,
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return meta["authorization_endpoint"] + "?" + urlencode(params)


def exchange_code(cfg: OidcConfig, *, code: str, code_verifier: str) -> dict:
    meta = discover(cfg.tenant_id)
    data = {
        "client_id": cfg.client_id,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "code_verifier": code_verifier,
        "scope": SCOPE,
    }
    if cfg.client_secret:
        data["client_secret"] = cfg.client_secret
    resp = httpx.post(meta["token_endpoint"], data=data, timeout=_HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def validate_id_token(cfg: OidcConfig, *, id_token: str, nonce: str) -> dict:
    """Validate the ID token fully and return its claims.

    Raises on any failure (bad signature, wrong issuer/audience, expiry, or a
    nonce that doesn't match the one we sent).
    """
    meta = discover(cfg.tenant_id)
    signing_key = _jwks_client(meta["jwks_uri"]).get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=cfg.client_id,
        issuer=meta["issuer"],
        options={"require": ["exp", "iat", "aud", "iss"]},
    )
    if claims.get("nonce") != nonce:
        raise ValueError("OIDC nonce mismatch — possible replay.")
    return claims
