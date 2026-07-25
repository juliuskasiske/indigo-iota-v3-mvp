"""Authenticator-app (TOTP) MFA helpers for local accounts.

TOTP (RFC 6238) is the open standard behind Google Authenticator, 1Password,
Authy, etc.: the server and the app share a random base32 seed, and both derive
the same rolling 6-digit code from the current 30-second time step. We:

  * generate the seed (``new_secret``),
  * hand it to the app as an ``otpauth://`` URI rendered to a QR (``qr_data_uri``),
  * verify the 6-digit code at enrolment and at every login (``verify_code``),
  * and issue one-time **backup codes** for a lost device.

The seed is the long-lived secret; callers encrypt it at rest with secret_box
(``encrypt_secret`` / ``decrypt_secret``). Backup codes are shown to the user
once and stored only as argon2 hashes (see ``passwords``).
"""
from __future__ import annotations

import base64
import io
import secrets

import pyotp
import qrcode

from src import secret_box
from src.auth import passwords

ISSUER = "Indigo Iota"

# Accept a code from the adjacent 30s window on each side: tolerates small clock
# skew and a user typing as the code rolls over, without meaningfully widening
# the guess space.
_VALID_WINDOW = 1

# Backup codes: avoid look-alike characters (0/O, 1/l/I) so they're easy to read
# and type off paper. 10 codes of 10 chars ≈ 50 bits each — plenty for a
# rate-limited, single-use, hashed recovery code.
_BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_BACKUP_CODE_LEN = 10
_BACKUP_CODE_COUNT = 10


# --- the shared seed --------------------------------------------------------

def new_secret() -> str:
    """A fresh random base32 TOTP seed (what the authenticator app stores)."""
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_email: str) -> str:
    """The ``otpauth://`` URI an authenticator app imports. Encodes the seed plus
    a human label ("Indigo Iota: alice@acme.de") so the user can tell accounts
    apart in their app."""
    return pyotp.TOTP(secret).provisioning_uri(
        name=account_email, issuer_name=ISSUER
    )


def qr_data_uri(otpauth_uri: str) -> str:
    """Render an otpauth URI to a PNG ``data:`` URI for an ``<img>`` tag, so the
    frontend needs no QR library — just shows the image we return."""
    img = qrcode.make(otpauth_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def verify_code(secret: str, code: str) -> bool:
    """True iff ``code`` is a currently-valid 6-digit code for ``secret``
    (tolerating ±1 time step). Ignores spaces the user may have typed."""
    cleaned = (code or "").strip().replace(" ", "")
    if not cleaned.isdigit():
        return False
    return pyotp.TOTP(secret).verify(cleaned, valid_window=_VALID_WINDOW)


# --- seed-at-rest (encrypt with secret_box / IOTA_SECRET_KEY) ---------------

def encrypt_secret(secret: str) -> str:
    """Fernet-encrypt the base32 seed for storage in totp_secrets."""
    return secret_box.encrypt(secret)


def decrypt_secret(token: str) -> str:
    """Recover the base32 seed stored by ``encrypt_secret``."""
    return secret_box.decrypt(token)


# --- backup codes (one-time recovery) ---------------------------------------

def generate_backup_codes(count: int = _BACKUP_CODE_COUNT) -> list[str]:
    """Return ``count`` fresh human-readable backup codes (shown to the user
    once). Hash each with ``passwords.hash_password`` before storing."""
    return [
        "".join(secrets.choice(_BACKUP_ALPHABET) for _ in range(_BACKUP_CODE_LEN))
        for _ in range(count)
    ]


def normalize_backup_code(code: str) -> str:
    """Canonicalize a typed backup code (lowercase, drop spaces/dashes) so it
    matches the form we hashed at issue time."""
    return (code or "").strip().lower().replace(" ", "").replace("-", "")


def hash_backup_code(code: str) -> str:
    """Argon2 hash of a normalized backup code, for storage."""
    return passwords.hash_password(normalize_backup_code(code))


def verify_backup_code(stored_hash: str, code: str) -> bool:
    """True iff a typed backup code matches a stored hash."""
    return passwords.verify_password(stored_hash, normalize_backup_code(code))
