"""Symmetric encryption for secrets we must store at rest and read back.

Some credentials can't be hashed: an IMAP app password has to be replayed in
plaintext to log in, so a one-way hash is useless. Instead we encrypt them with
Fernet (AES-128-CBC + HMAC-SHA256 authentication) using a key held OUTSIDE the
database — env ``IOTA_SECRET_KEY``, sourced from a secrets manager in prod. If the
tenant DB leaks, the stored ciphertext is inert without that key.

Usage:
    from src import secret_box
    token = secret_box.encrypt("app-password")   # store this in the DB
    secret = secret_box.decrypt(token)           # use at connect time

Generate a key once (and put it in .env / the secrets manager):
    python -c "from src import secret_box; print(secret_box.generate_key())"
"""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

ENV_KEY = "IOTA_SECRET_KEY"


class SecretConfigError(RuntimeError):
    """The encryption key is missing/invalid, or a token can't be decrypted."""


def _box() -> Fernet:
    raw = (os.environ.get(ENV_KEY) or "").strip()
    if not raw:
        raise SecretConfigError(
            f"{ENV_KEY} is not set — cannot encrypt or decrypt stored secrets. "
            f"Generate one with: python -c \"from src import secret_box; "
            f"print(secret_box.generate_key())\""
        )
    try:
        return Fernet(raw.encode("utf-8"))
    except (ValueError, TypeError) as exc:  # not a valid 32-byte urlsafe-b64 key
        raise SecretConfigError(
            f"{ENV_KEY} is not a valid Fernet key (expected a urlsafe-base64 "
            f"32-byte key from Fernet.generate_key())."
        ) from exc


def encrypt(plaintext: str) -> str:
    """Encrypt ``plaintext`` to a Fernet token (ASCII text safe to store in TEXT)."""
    return _box().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Recover the plaintext from a Fernet token produced by ``encrypt``."""
    try:
        return _box().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:  # wrong key, tampered, or not a Fernet token
        raise SecretConfigError(
            "stored secret could not be decrypted — wrong IOTA_SECRET_KEY, or the "
            "value was not produced by secret_box.encrypt()."
        ) from exc


def generate_key() -> str:
    """A fresh Fernet key as text. Run once; store in env / a secrets manager."""
    return Fernet.generate_key().decode("ascii")
