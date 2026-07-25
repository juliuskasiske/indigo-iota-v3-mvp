"""The short-lived 'MFA pending' cookie that bridges the two login steps.

Local sign-in is two requests: (1) email+password, then (2) a TOTP code. Between
them we must remember *who* passed step 1 without trusting the client to assert
it. So step 1 issues this signed, 5-minute ``iota_mfa`` cookie carrying the
verified identity and a ``kind: "mfa_pending"`` marker; step 2 reads it, checks
the code, and only then mints the real session cookie.

It is signed with the same SESSION_SECRET as the session cookie (HS256), but is
deliberately a SEPARATE token type — a session cookie can never be replayed as
an MFA-pending token, or vice versa, because the ``kind`` claim is checked.

(Kept out of sessions.py on purpose: that module currently carries an
uncommitted auth diagnostic, and this code needs to ship independently.)
"""
from __future__ import annotations

import os
import time

import jwt

MFA_COOKIE_NAME = "iota_mfa"
MFA_TTL = 5 * 60          # 5 minutes to enter the code
_ALG = "HS256"
_KIND = "mfa_pending"


def _secret() -> str:
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        raise RuntimeError(
            "SESSION_SECRET is not set — it is required to sign the MFA cookie."
        )
    return secret


def issue_mfa_challenge(
    *, user_id: int, org_id: int, org_slug: str, role: str, email: str | None,
    ttl: int = MFA_TTL,
) -> str:
    now = int(time.time())
    payload = {
        "kind": _KIND,
        "sub": str(user_id),
        "org_id": org_id,
        "org": org_slug,
        "role": role,
        "email": email,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _secret(), algorithm=_ALG)


def read_mfa_challenge(token: str | None) -> dict | None:
    """Decode the MFA cookie, returning its claims only if it is a valid,
    unexpired token of the right kind — else None."""
    if not token:
        return None
    try:
        data = jwt.decode(token, _secret(), algorithms=[_ALG])
    except jwt.PyJWTError:
        return None
    if data.get("kind") != _KIND:
        return None
    return data
