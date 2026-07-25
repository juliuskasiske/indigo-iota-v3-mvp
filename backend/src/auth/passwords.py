"""Password hashing and single-use token helpers for local (non-SSO) auth.

Two different jobs, two different primitives:

* **Passwords and backup codes** are verified, never recovered, so they are
  hashed one-way with **argon2id** (memory-hard; resists GPU brute force). We
  store only the hash; even a full DB dump can't reveal the password.
* **Emailed link tokens** (invite / reset) must be looked up when the user
  follows the link, so we keep the raw token only inside the URL and store its
  **SHA-256 hash**. Lookup is by hash (a UNIQUE index), so a leaked DB yields
  hashes that can't be replayed as links.

Nothing here reads or writes the database — callers own persistence.
"""
from __future__ import annotations

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# argon2id with the library's current defaults (time_cost=3, 64 MiB, parallel=4).
# Tune here if we ever need to trade latency for hardness.
_hasher = PasswordHasher()

# Argon2 must not be fed unbounded input (a giant "password" is a cheap DoS).
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 200


class WeakPasswordError(ValueError):
    """The chosen password fails policy. Message is safe to show the user."""


# --- passwords + backup codes (one-way) -------------------------------------

def hash_password(plaintext: str) -> str:
    """Return an argon2id hash string (algorithm + params + salt are embedded)."""
    return _hasher.hash(plaintext)


def verify_password(stored_hash: str, plaintext: str) -> bool:
    """True iff ``plaintext`` matches ``stored_hash``. Never raises on mismatch."""
    try:
        return _hasher.verify(stored_hash, plaintext)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    """True if the hash was made with older/weaker params and should be upgraded
    on the next successful login (when we still hold the plaintext)."""
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return False


def validate_password(plaintext: str, *, email: str | None = None) -> None:
    """Enforce password policy. Raise WeakPasswordError (user-safe message) if it
    fails; return None if it passes.

    Deliberately simple and predictable: a length floor (the single biggest win
    for resistance to guessing) plus a couple of obvious-footgun checks. No
    composition rules ("must contain a symbol") — they push users toward weaker,
    more guessable passwords without adding real entropy.
    """
    if not isinstance(plaintext, str):
        raise WeakPasswordError("Password is required.")
    if len(plaintext) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(plaintext) > MAX_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
        )
    if len(set(plaintext)) < 5:
        raise WeakPasswordError("Password is too repetitive — use more variety.")
    if email and plaintext.strip().lower() == email.strip().lower():
        raise WeakPasswordError("Password must not be your email address.")


# --- emailed link tokens (invite / reset) -----------------------------------

def new_token() -> str:
    """A fresh high-entropy URL-safe token. This is the secret in the link; only
    its hash (see ``hash_token``) is ever stored."""
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    """SHA-256 hex of a link token. Tokens are long and random, so a fast hash is
    appropriate (no brute-force surface like a human-chosen password has) and
    lets us look the token up by an indexed, deterministic column."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
