"""OAuth 2.1 Authorization Server for the remote MCP endpoint (Phase 2).

Indigo Iota is its own OAuth AS for the ``/mcp`` resource so Claude / ChatGPT
can do the one-click connector flow (Dynamic Client Registration + authorization
code + PKCE). The MCP SDK supplies the protocol machinery — discovery metadata,
/authorize, /token, /register, /revoke, PKCE + redirect validation — and calls
this provider for persistence and for the one custom step: authenticating the
human and letting them pick which workspace to grant.

We do NOT re-implement login here. ``authorize()`` hands the browser to our own
consent page (``/mcp/consent``), which reuses the existing ``iota_session`` to
identify the person, shows their workspaces, and on approval mints a one-time
authorization code bound to (user, chosen org, scopes). ``/token`` then swaps
that code for an access + refresh token — both carrying the SAME (user_id,
org_id) as a Phase 1 personal access token, so the tools treat them identically.

Secrets at rest: client secrets are encrypted (secret_box); codes and tokens are
stored only as SHA-256 hashes. Access + refresh tokens for one grant share a
``grant_id`` so revoking either kills the pair.
"""
from __future__ import annotations

import functools
import hashlib
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import anyio
import jwt
from psycopg.types.json import Jsonb

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from src import secret_box
from src.auth import mcp_tokens
from src.db.connection import get_control_connection

# --- token shapes / lifetimes ----------------------------------------------

ACCESS_PREFIX = "iota_at_"
REFRESH_PREFIX = "iota_rt_"
ACCESS_TTL = 3600                 # 1 hour
REFRESH_TTL = 30 * 24 * 3600      # 30 days
CODE_TTL = 300                    # 5 minutes
PENDING_TTL = 600                 # 10 minutes (signed consent hand-off)

_ALG = "HS256"


class IotaAccessToken(AccessToken):
    """An accepted bearer enriched with the identity the SDK doesn't model."""

    user_id: int
    org_id: int


class IotaAuthorizationCode(AuthorizationCode):
    """An issued code carrying the member + workspace chosen at consent, so the
    token exchange knows who/what to mint for (the SDK's base model doesn't)."""

    user_id: int
    org_id: int


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _secret() -> str:
    s = os.environ.get("SESSION_SECRET")
    if not s:
        raise RuntimeError("SESSION_SECRET is required to sign the OAuth consent hand-off.")
    return s


# ---------------------------------------------------------------------------
# Pending-authorization hand-off (stateless, signed)
# ---------------------------------------------------------------------------
# authorize() can't render UI, so it stamps the validated request into a short
# JWT and redirects to the consent page; the consent page reads it back. This
# avoids a server-side table for in-flight authorizations.

def sign_pending(*, client_id: str, redirect_uri: str, redirect_uri_provided_explicitly: bool,
                 code_challenge: str, scopes: list[str], state: str | None,
                 resource: str | None) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "cid": client_id,
            "ru": redirect_uri,
            "rue": redirect_uri_provided_explicitly,
            "cc": code_challenge,
            "sc": scopes,
            "st": state,
            "res": resource,
            "iat": now,
            "exp": now + PENDING_TTL,
        },
        _secret(),
        algorithm=_ALG,
    )


def read_pending(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return None


# CSRF defence for the consent approval: the GET that renders the consent form
# (where the user is authenticated) embeds a token binding this exact session +
# pending request; the POST must present it. Combined with the SameSite=Lax
# session cookie this makes a forged "Allow" impossible — an attacker can't read
# the form to obtain the token, and can't reuse one issued for another session.

def sign_consent(*, user_id: int, rid: str) -> str:
    now = int(time.time())
    # Use "uid" rather than the reserved "sub" claim — PyJWT requires "sub" to be
    # a string and we key on the integer user id.
    return jwt.encode(
        {"uid": user_id, "rid": _hash(rid), "iat": now, "exp": now + PENDING_TTL},
        _secret(),
        algorithm=_ALG,
    )


def verify_consent(token: str | None, *, user_id: int, rid: str) -> bool:
    if not token:
        return False
    try:
        d = jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return False
    return d.get("uid") == user_id and d.get("rid") == _hash(rid)


# ---------------------------------------------------------------------------
# Client store (Dynamic Client Registration)
# ---------------------------------------------------------------------------

def save_client(info: OAuthClientInformationFull) -> None:
    data = info.model_dump(mode="json")
    secret_plain = data.pop("client_secret", None)
    secret_enc = secret_box.encrypt(secret_plain) if secret_plain else None
    redirect_uris = [str(u) for u in (info.redirect_uris or [])]
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO oauth_clients
              (client_id, client_secret_encrypted, redirect_uris, client_name,
               scope, grant_types, token_endpoint_auth_method, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (client_id) DO UPDATE SET
              client_secret_encrypted = EXCLUDED.client_secret_encrypted,
              redirect_uris = EXCLUDED.redirect_uris,
              client_name = EXCLUDED.client_name,
              scope = EXCLUDED.scope,
              grant_types = EXCLUDED.grant_types,
              token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
              metadata = EXCLUDED.metadata;
            """,
            (
                info.client_id,
                secret_enc,
                redirect_uris,
                info.client_name,
                info.scope,
                list(info.grant_types or ["authorization_code", "refresh_token"]),
                info.token_endpoint_auth_method or "client_secret_post",
                Jsonb(data),
            ),
        )
        conn.commit()


def get_client(client_id: str) -> OAuthClientInformationFull | None:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT metadata, client_secret_encrypted FROM oauth_clients WHERE client_id = %s;",
            (client_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    data, secret_enc = row[0], row[1]
    if secret_enc:
        try:
            data["client_secret"] = secret_box.decrypt(secret_enc)
        except Exception:
            data["client_secret"] = None
    return OAuthClientInformationFull.model_validate(data)


# ---------------------------------------------------------------------------
# Authorization codes
# ---------------------------------------------------------------------------

def save_auth_code(
    code_raw: str, *, client_id: str, user_id: int, org_id: int, scopes: list[str],
    code_challenge: str, redirect_uri: str, redirect_uri_provided_explicitly: bool,
    resource: str | None,
) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=CODE_TTL)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO oauth_auth_codes
              (code, client_id, user_id, org_id, scopes, code_challenge,
               redirect_uri, redirect_uri_provided_explicitly, resource, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
            """,
            (_hash(code_raw), client_id, user_id, org_id, scopes, code_challenge,
             redirect_uri, redirect_uri_provided_explicitly, resource, expires_at),
        )
        conn.commit()


def load_auth_code(client_id: str, code_raw: str) -> IotaAuthorizationCode | None:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT user_id, org_id, scopes, code_challenge, redirect_uri,
                   redirect_uri_provided_explicitly, resource, expires_at
            FROM oauth_auth_codes
            WHERE code = %s AND client_id = %s
              AND consumed_at IS NULL AND expires_at > NOW();
            """,
            (_hash(code_raw), client_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return IotaAuthorizationCode(
        code=code_raw,
        scopes=list(row[2]),
        expires_at=row[7].timestamp(),
        client_id=client_id,
        code_challenge=row[3],
        redirect_uri=row[4],
        redirect_uri_provided_explicitly=row[5],
        resource=row[6],
        user_id=row[0],
        org_id=row[1],
    )


def consume_auth_code(code_raw: str) -> bool:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE oauth_auth_codes SET consumed_at = NOW() "
            "WHERE code = %s AND consumed_at IS NULL RETURNING code;",
            (_hash(code_raw),),
        )
        hit = cur.fetchone() is not None
        conn.commit()
    return hit


# ---------------------------------------------------------------------------
# Access + refresh tokens
# ---------------------------------------------------------------------------

def mint_grant(*, client_id: str, user_id: int, org_id: int, scopes: list[str]) -> OAuthToken:
    """Issue a fresh access+refresh pair under one grant_id."""
    grant_id = uuid.uuid4().hex
    access_raw = ACCESS_PREFIX + secrets.token_urlsafe(32)
    refresh_raw = REFRESH_PREFIX + secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO oauth_tokens
              (token_hash, kind, grant_id, client_id, user_id, org_id, scopes, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
            """,
            [
                (_hash(access_raw), "access", grant_id, client_id, user_id, org_id,
                 scopes, now + timedelta(seconds=ACCESS_TTL)),
                (_hash(refresh_raw), "refresh", grant_id, client_id, user_id, org_id,
                 scopes, now + timedelta(seconds=REFRESH_TTL)),
            ],
        )
        conn.commit()
    return OAuthToken(
        access_token=access_raw,
        token_type="Bearer",
        expires_in=ACCESS_TTL,
        scope=" ".join(scopes),
        refresh_token=refresh_raw,
    )


def verify_access_token(raw: str | None) -> IotaAccessToken | None:
    """Validate an OAuth access token (used by the unified bearer verifier)."""
    if not raw or not raw.startswith(ACCESS_PREFIX):
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT client_id, user_id, org_id, scopes, expires_at
            FROM oauth_tokens
            WHERE token_hash = %s AND kind = 'access'
              AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
            """,
            (_hash(raw),),
        )
        row = cur.fetchone()
    if not row:
        return None
    return IotaAccessToken(
        token=raw,
        client_id=row[0],
        scopes=list(row[3]),
        expires_at=int(row[4].timestamp()) if row[4] else None,
        resource=None,
        user_id=row[1],
        org_id=row[2],
    )


def load_refresh(client_id: str, raw: str) -> RefreshToken | None:
    if not raw or not raw.startswith(REFRESH_PREFIX):
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT scopes, expires_at FROM oauth_tokens
            WHERE token_hash = %s AND kind = 'refresh' AND client_id = %s
              AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
            """,
            (_hash(raw), client_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    return RefreshToken(
        token=raw,
        client_id=client_id,
        scopes=list(row[0]),
        expires_at=int(row[1].timestamp()) if row[1] else None,
    )


def _grant_for_token(raw: str) -> tuple[str, int, int] | None:
    """(grant_id, user_id, org_id) for a raw access/refresh token, or None."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT grant_id, user_id, org_id FROM oauth_tokens WHERE token_hash = %s;",
            (_hash(raw),),
        )
        row = cur.fetchone()
    return (row[0], row[1], row[2]) if row else None


def revoke_grant(grant_id: str) -> None:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE oauth_tokens SET revoked_at = COALESCE(revoked_at, NOW()) "
            "WHERE grant_id = %s;",
            (grant_id,),
        )
        conn.commit()


def rotate_refresh(client_id: str, raw_refresh: str, scopes: list[str]) -> OAuthToken:
    """Revoke the old grant and mint a new access+refresh pair (rotation)."""
    info = _grant_for_token(raw_refresh)
    if not info:
        raise TokenError("invalid_grant", "Unknown refresh token.")
    grant_id, user_id, org_id = info
    revoke_grant(grant_id)
    return mint_grant(client_id=client_id, user_id=user_id, org_id=org_id, scopes=scopes)


# ---------------------------------------------------------------------------
# The provider the SDK calls
# ---------------------------------------------------------------------------

def _consent_base() -> str:
    # Same origin resolution as mcp_server.public_origin (kept inline to avoid a
    # circular import): explicit override, else the app's APP_BASE_URL (the live
    # domain in prod), else local default.
    issuer = (
        os.environ.get("MCP_ISSUER_URL")
        or os.environ.get("APP_BASE_URL")
        or "http://localhost:8080"
    ).rstrip("/")
    return os.environ.get("MCP_CONSENT_URL", f"{issuer}/mcp/consent")


_run = anyio.to_thread.run_sync


class IotaOAuthProvider(OAuthAuthorizationServerProvider):
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return await _run(get_client, client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        await _run(save_client, client_info)

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        # Can't render UI here — stamp the validated request and bounce the
        # browser to our consent page, which reuses iota_session to identify the
        # human and lets them pick a workspace.
        rid = await _run(
            functools.partial(
                sign_pending,
                client_id=client.client_id,
                redirect_uri=str(params.redirect_uri),
                redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                code_challenge=params.code_challenge,
                scopes=params.scopes or [],
                state=params.state,
                resource=params.resource,
            )
        )
        sep = "&" if "?" in _consent_base() else "?"
        return f"{_consent_base()}{sep}rid={rid}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> IotaAuthorizationCode | None:
        return await _run(load_auth_code, client.client_id, authorization_code)

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: IotaAuthorizationCode
    ) -> OAuthToken:
        # SDK already checked PKCE, redirect match and expiry. Consume the code
        # (one-time) and mint the grant for the member + workspace it carries.
        consumed = await _run(consume_auth_code, authorization_code.code)
        if not consumed:
            raise TokenError("invalid_grant", "Authorization code already used or expired.")
        return await _run(
            functools.partial(
                mint_grant,
                client_id=client.client_id,
                user_id=authorization_code.user_id,
                org_id=authorization_code.org_id,
                scopes=list(authorization_code.scopes),
            )
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return await _run(load_refresh, client.client_id, refresh_token)

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        # Narrow scopes if the client asked for a subset; never widen.
        granted = list(scopes) if scopes else list(refresh_token.scopes)
        granted = [s for s in granted if s in refresh_token.scopes]
        return await _run(
            functools.partial(rotate_refresh, client.client_id, refresh_token.token, granted)
        )

    async def load_access_token(self, token: str) -> IotaAccessToken | None:
        # This is the single bearer verifier for /mcp (the SDK derives it from
        # the provider). Accept EITHER a Phase 1 personal access token OR a
        # Phase 2 OAuth access token, so both flows are first-class.
        pat = await _run(mcp_tokens.verify, token)
        if pat:
            return IotaAccessToken(
                token=token,
                client_id=f"user:{pat['user_id']}",
                scopes=pat["scopes"],
                expires_at=None,
                resource=None,
                user_id=pat["user_id"],
                org_id=pat["org_id"],
            )
        return await _run(verify_access_token, token)

    async def revoke_token(self, token) -> None:
        info = await _run(_grant_for_token, token.token)
        if info:
            await _run(revoke_grant, info[0])
