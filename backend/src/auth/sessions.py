"""Signed cookies: the login session, and the short-lived login transaction.

Two cookies, both signed (HS256) with SESSION_SECRET so they can't be forged:

  * the **session cookie** (``iota_session``) — issued after a successful login,
    carries user_id + org + role. Self-contained, so there is no session store
    to run for the pilot.
  * the **transaction cookie** (``iota_oauth_tx``) — lives only between the
    redirect to Microsoft and the callback, carrying the OIDC ``state``,
    ``nonce`` and PKCE ``code_verifier`` so the callback can be verified.

The session lasts 30 days (re-issued on each login); the transaction cookie
is short-lived.
"""
from __future__ import annotations

import os
import time

import jwt

COOKIE_NAME = "iota_session"
TX_COOKIE_NAME = "iota_oauth_tx"
_ALG = "HS256"

SESSION_TTL = 30 * 24 * 60 * 60   # 30 days
TX_TTL = 10 * 60            # 10 minutes


def _secret() -> str:
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise RuntimeError(
            "SESSION_SECRET is not set — it is required to sign session cookies. "
            "Generate one (e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`) "
            "and put it in backend/.env."
        )
    return secret


# --- session cookie ---------------------------------------------------------

def issue_session(
    *, user_id: int, org_id: int, org_slug: str, role: str, email: str | None,
    ttl: int = SESSION_TTL,
) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "org_id": org_id,
        "org": org_slug,
        "role": role,
        "email": email,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _secret(), algorithm=_ALG)


def read_session(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return None


def auth_failure_reason(token: str | None) -> str:
    """TEMP DIAGNOSTIC: name why a session token is not accepted, so a 401 can
    be traced to its root cause (no cookie vs expired vs forged/wrong-secret).
    """
    if not token:
        return "no-cookie"
    try:
        jwt.decode(token, _secret(), algorithms=[_ALG])
        return "ok"
    except jwt.ExpiredSignatureError:
        return "expired"
    except jwt.InvalidSignatureError:
        return "bad-signature (secret mismatch)"
    except jwt.PyJWTError as exc:
        return f"invalid-token: {type(exc).__name__}"


# --- login-transaction cookie ----------------------------------------------

def issue_tx(
    *, state: str, nonce: str, code_verifier: str, org_slug: str, next_url: str,
    ttl: int = TX_TTL,
) -> str:
    now = int(time.time())
    payload = {
        "state": state,
        "nonce": nonce,
        "cv": code_verifier,
        "org": org_slug,
        "next": next_url,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _secret(), algorithm=_ALG)


def read_tx(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return None
