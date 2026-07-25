"""Personal access tokens for the remote MCP server (Phase 1 auth).

An MCP token is a long-lived bearer credential that lets an external MCP client
(Claude, ChatGPT) read ONE workspace's brain on behalf of ONE member. It is the
stepping stone before the full OAuth flow: an admin mints one, pastes it into a
generic MCP client, and every tool call is then authenticated + tenant-scoped +
metered exactly as the OAuth access token will be in Phase 2.

Security model (mirrors auth_tokens / the invite + reset links):
  * The raw token is shown ONCE at creation and never stored. Only its SHA-256
    hash lives in ``mcp_tokens``, so a control-DB dump reveals no usable token.
  * The raw token is ``iota_mcp_<43 url-safe chars>`` (32 bytes of entropy).
  * Verification hashes the presented bearer and looks it up; a token is valid
    only while it is un-revoked and un-expired.

All rows live in the CONTROL database (cross-tenant), keyed by (user_id, org_id).
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Optional, TypedDict

from src.db.connection import get_control_connection

TOKEN_PREFIX = "iota_mcp_"

# The capabilities a token may carry. The MCP is now strictly READ-ONLY: the
# calling model (Claude/ChatGPT) reasons over the raw context the tools return,
# so the brain never spends its own LLM credits for a connector.
SCOPE_READ = "brain:read"   # search, entities, graph — no LLM spend
# Retired: the credit-costing MCP `ask` tool was removed, so 'brain:ask' is no
# longer grantable. Kept defined so any pre-existing token that still carries it
# loads cleanly (the scope is simply inert — no tool consumes it).
SCOPE_ASK = "brain:ask"
ALL_SCOPES = (SCOPE_READ,)
DEFAULT_SCOPES = (SCOPE_READ,)


class Principal(TypedDict):
    """Who/what an accepted bearer maps to."""

    token_id: int
    user_id: int
    org_id: int
    scopes: list[str]


def _hash(raw: str) -> str:
    """SHA-256 hex of the raw token (what we persist + look up by)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _clean_scopes(scopes: Optional[list[str]]) -> list[str]:
    """Keep only recognised scopes, preserving order, defaulting when empty."""
    if not scopes:
        return list(DEFAULT_SCOPES)
    out = [s for s in scopes if s in ALL_SCOPES]
    return out or list(DEFAULT_SCOPES)


def mint(
    *,
    user_id: int,
    org_id: int,
    scopes: Optional[list[str]] = None,
    label: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> tuple[str, dict]:
    """Create a token bound to (user_id, org_id). Returns (raw_token, record).

    The raw token is returned ONLY here — it cannot be recovered later. ``record``
    is the safe, hash-free metadata row for display.
    """
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token_hash = _hash(raw)
    scopes = _clean_scopes(scopes)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mcp_tokens (token_hash, org_id, user_id, scopes, label, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, scopes, label, created_at, expires_at;
            """,
            (token_hash, org_id, user_id, scopes, label, expires_at),
        )
        row = cur.fetchone()
        conn.commit()
    record = {
        "id": row[0],
        "org_id": org_id,
        "user_id": user_id,
        "scopes": list(row[1]),
        "label": row[2],
        "created_at": row[3].isoformat() if row[3] else None,
        "expires_at": row[4].isoformat() if row[4] else None,
        "last_used_at": None,
        "revoked": False,
    }
    return raw, record


def verify(raw: Optional[str]) -> Optional[Principal]:
    """Map a presented bearer to its Principal, or None if not acceptable.

    Accepted = the hash matches a row that is neither revoked nor expired. Best
    effort bumps ``last_used_at`` so an admin can see a token is live.
    """
    if not raw or not raw.startswith(TOKEN_PREFIX):
        return None
    token_hash = _hash(raw)
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, org_id, scopes
            FROM mcp_tokens
            WHERE token_hash = %s
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > NOW());
            """,
            (token_hash,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cur.execute(
            "UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = %s;", (row[0],)
        )
        conn.commit()
    return Principal(
        token_id=row[0], user_id=row[1], org_id=row[2], scopes=list(row[3])
    )


def list_for_org(org_id: int) -> list[dict]:
    """All tokens for an org (no hashes), newest first, for the admin UI."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, scopes, label, created_at, last_used_at,
                   expires_at, revoked_at
            FROM mcp_tokens
            WHERE org_id = %s
            ORDER BY id DESC;
            """,
            (org_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id": r[0],
            "user_id": r[1],
            "scopes": list(r[2]),
            "label": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
            "last_used_at": r[5].isoformat() if r[5] else None,
            "expires_at": r[6].isoformat() if r[6] else None,
            "revoked": r[7] is not None,
        }
        for r in rows
    ]


def revoke(token_id: int, org_id: int) -> bool:
    """Revoke a token, scoped to the caller's org so one org can't revoke
    another's. Returns True if a row was revoked (idempotent: re-revoking a
    revoked token still returns True as long as it belongs to the org)."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mcp_tokens
            SET revoked_at = COALESCE(revoked_at, NOW())
            WHERE id = %s AND org_id = %s
            RETURNING id;
            """,
            (token_id, org_id),
        )
        hit = cur.fetchone() is not None
        conn.commit()
    return hit
