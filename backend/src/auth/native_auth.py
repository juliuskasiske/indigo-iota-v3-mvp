"""Native (email + password + TOTP) authentication, backed by the control plane.

This is the sign-in path for organizations with ``auth_method = 'native'`` — IMAP
customers who have no Microsoft tenant. ("native" as opposed to federated SSO;
the name avoids colliding with "local" in the infra/deployment sense.) It
complements ``service.py`` (the SSO path) and writes to the same control-plane
tables.

The onboarding never emails a password. Instead:

  1. an admin invites a member by email (``service.add_member`` + ``issue_invite``);
  2. the member follows a single-use link and SETS their own password
     (``set_password``), which also marks their inbox verified;
  3. they MUST enrol an authenticator app — ``begin_enrollment`` →
     ``confirm_enrollment`` — and only then is the invite token consumed and the
     account usable;
  4. every later sign-in is password (``verify_password``, with lockout) followed
     by a TOTP code (``verify_totp`` / a one-time backup code).

Tokens are stored only as hashes; the raw token lives only in the emailed URL.
The TOTP seed is encrypted at rest (secret_box). Passwords and backup codes are
argon2id hashes. A control-plane dump alone yields no usable credential.
"""
from __future__ import annotations

from dataclasses import dataclass

from src.auth import passwords, totp
from src.db.connection import get_control_connection

INVITE_TTL_HOURS = 48
RESET_TTL_HOURS = 1

# Password lockout: after this many consecutive failures the account is locked
# for the cooldown window. Defeats online brute force without locking a user out
# permanently. A correct password (or the window elapsing) clears the counter.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


# --- small result types -----------------------------------------------------

@dataclass
class Identity:
    user_id: int
    org_id: int
    org_slug: str
    role: str
    email: str


@dataclass
class LoginResult:
    status: str               # 'ok' | 'invalid' | 'locked' | 'mfa_incomplete'
    identity: Identity | None = None
    retry_after_seconds: int | None = None   # set when status == 'locked'


# --- org / membership lookups (native only) ---------------------------------

def org_uses_native(slug: str) -> bool:
    """True iff the org exists and uses native (password) auth."""
    return auth_method_for_org(slug) == "native"


def auth_method_for_org(slug: str) -> str:
    """The sign-in method the login page should present for ``slug``.

    Returns 'native' or 'entra'. Deliberately defaults to 'entra' for an unknown
    slug so this (unauthenticated) endpoint can't be used to enumerate which
    workspaces exist — an unknown slug looks exactly like a Microsoft one.
    """
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT auth_method FROM organizations WHERE slug = %s;", (slug,)
        )
        row = cur.fetchone()
    return "native" if (row and row[0] == "native") else "entra"


def identity_for_user(user_id: int) -> Identity | None:
    """Resolve the membership to sign a freshly-onboarded user into. A native user
    belongs to exactly one org in the pilot; if they somehow have several, prefer
    a native-auth org (the one an invite would have targeted), newest first."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.slug, u.id, u.email, m.role
            FROM memberships m
            JOIN organizations o ON o.id = m.org_id
            JOIN users u ON u.id = m.user_id
            WHERE u.id = %s
            ORDER BY (o.auth_method = 'native') DESC, m.created_at DESC
            LIMIT 1;
            """,
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return Identity(user_id=row[2], org_id=row[0], org_slug=row[1], role=row[4], email=row[3])


def _member(cur, slug: str, email: str):
    """(org_id, org_slug, user_id, email, role) for a member, else None."""
    cur.execute(
        """
        SELECT o.id, o.slug, u.id, u.email, m.role
        FROM organizations o
        JOIN memberships m ON m.org_id = o.id
        JOIN users u ON u.id = m.user_id
        WHERE o.slug = %s AND lower(u.email) = lower(%s);
        """,
        (slug, email),
    )
    return cur.fetchone()


# --- single-use link tokens (invite / reset) --------------------------------

def _issue_token(user_id: int, purpose: str, ttl_hours: int) -> str:
    """Create a single-use token of ``purpose`` for ``user_id``; return the RAW
    token (store only its hash). Caller emails the raw token inside a link."""
    raw = passwords.new_token()
    token_hash = passwords.hash_token(raw)
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
                VALUES (%s, %s, %s, NOW() + make_interval(hours => %s));
                """,
                (user_id, purpose, token_hash, ttl_hours),
            )
        conn.commit()
    return raw


def issue_invite(user_id: int) -> str:
    return _issue_token(user_id, "invite", INVITE_TTL_HOURS)


def issue_reset(user_id: int) -> str:
    return _issue_token(user_id, "reset", RESET_TTL_HOURS)


def peek_token(raw_token: str, purpose: str) -> tuple[int, str] | None:
    """Validate a token WITHOUT spending it. Returns (user_id, email) if it is a
    live, unconsumed, unexpired token of ``purpose``, else None. Used to render
    the accept/reset page before the user submits."""
    token_hash = passwords.hash_token(raw_token or "")
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.user_id, u.email
            FROM auth_tokens t JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = %s AND t.purpose = %s
              AND t.consumed_at IS NULL AND t.expires_at > NOW();
            """,
            (token_hash, purpose),
        )
        return cur.fetchone()


def consume_token(raw_token: str, purpose: str) -> int | None:
    """Atomically spend a token. Returns user_id if it was live (and is now
    marked consumed), else None. The UPDATE...WHERE consumed_at IS NULL makes
    double-spend impossible even under concurrent requests."""
    token_hash = passwords.hash_token(raw_token or "")
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_tokens SET consumed_at = NOW()
                WHERE token_hash = %s AND purpose = %s
                  AND consumed_at IS NULL AND expires_at > NOW()
                RETURNING user_id;
                """,
                (token_hash, purpose),
            )
            row = cur.fetchone()
        conn.commit()
    return row[0] if row else None


# --- passwords ---------------------------------------------------------------

def has_password(user_id: int) -> bool:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM local_credentials WHERE user_id = %s;", (user_id,))
        return cur.fetchone() is not None


def set_password(user_id: int, plaintext: str, *, email: str | None = None) -> None:
    """Hash and store a new password (argon2id), resetting any lockout. Raises
    passwords.WeakPasswordError if the password fails policy."""
    passwords.validate_password(plaintext, email=email)
    pw_hash = passwords.hash_password(plaintext)
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO local_credentials (user_id, password_hash)
                VALUES (%s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    password_set_at = NOW(),
                    failed_attempts = 0,
                    locked_until = NULL,
                    updated_at = NOW();
                """,
                (user_id, pw_hash),
            )
            # Setting a password via an emailed link proves inbox control.
            cur.execute(
                "UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) "
                "WHERE id = %s;",
                (user_id,),
            )
        conn.commit()


def verify_login(slug: str, email: str, password: str) -> LoginResult:
    """Check email + password for a local org, enforcing lockout. Does NOT issue
    a session — the caller still has to clear the TOTP step. Always returns a
    coarse status (never reveals whether the email exists)."""
    if not org_uses_native(slug):
        return LoginResult("invalid")
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            row = _member(cur, slug, email)
            if not row:
                return LoginResult("invalid")
            org_id, org_slug, user_id, real_email, role = row

            cur.execute(
                """
                SELECT password_hash, failed_attempts,
                       locked_until, (locked_until > NOW()) AS locked,
                       CEIL(EXTRACT(EPOCH FROM (locked_until - NOW())))::int AS retry_s
                FROM local_credentials WHERE user_id = %s;
                """,
                (user_id,),
            )
            cred = cur.fetchone()
            if not cred:
                return LoginResult("invalid")   # no local password set
            pw_hash, failed, _locked_until, locked, retry_s = cred

            if locked:
                return LoginResult("locked", retry_after_seconds=max(retry_s or 0, 1))

            if not passwords.verify_password(pw_hash, password):
                failed = (failed or 0) + 1
                if failed >= MAX_FAILED_ATTEMPTS:
                    cur.execute(
                        "UPDATE local_credentials SET failed_attempts = %s, "
                        "locked_until = NOW() + make_interval(mins => %s), updated_at = NOW() "
                        "WHERE user_id = %s;",
                        (failed, LOCKOUT_MINUTES, user_id),
                    )
                else:
                    cur.execute(
                        "UPDATE local_credentials SET failed_attempts = %s, updated_at = NOW() "
                        "WHERE user_id = %s;",
                        (failed, user_id),
                    )
                conn.commit()
                return LoginResult("invalid")

            # success: clear the failure counter, optionally upgrade the hash
            new_hash = (
                passwords.hash_password(password)
                if passwords.needs_rehash(pw_hash) else None
            )
            if new_hash:
                cur.execute(
                    "UPDATE local_credentials SET password_hash = %s, failed_attempts = 0, "
                    "locked_until = NULL, updated_at = NOW() WHERE user_id = %s;",
                    (new_hash, user_id),
                )
            else:
                cur.execute(
                    "UPDATE local_credentials SET failed_attempts = 0, locked_until = NULL, "
                    "updated_at = NOW() WHERE user_id = %s;",
                    (user_id,),
                )
            conn.commit()

    ident = Identity(user_id, org_id, org_slug, role, real_email)
    if not is_totp_active(user_id):
        # Password is right but the authenticator was never finished — the
        # account can't be used until enrolment completes (MFA is mandatory).
        return LoginResult("mfa_incomplete", identity=ident)
    return LoginResult("ok", identity=ident)


# --- TOTP enrolment + verification ------------------------------------------

def is_totp_active(user_id: int) -> bool:
    """True once the user has confirmed an authenticator app."""
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM totp_secrets WHERE user_id = %s AND confirmed_at IS NOT NULL;",
            (user_id,),
        )
        return cur.fetchone() is not None


def begin_enrollment(user_id: int, email: str) -> dict:
    """Start (or restart) authenticator enrolment. Stores a fresh, UNCONFIRMED
    seed + new backup-code hashes, and returns what the UI must show ONCE: the
    otpauth URI, a QR image, and the plaintext backup codes. Refuses to clobber
    an already-confirmed enrolment (use a dedicated reset for that)."""
    if is_totp_active(user_id):
        raise ValueError("Authenticator is already set up for this account.")
    secret = totp.new_secret()
    uri = totp.provisioning_uri(secret, email)
    backup_codes = totp.generate_backup_codes()
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO totp_secrets (user_id, secret_encrypted, confirmed_at)
                VALUES (%s, %s, NULL)
                ON CONFLICT (user_id) DO UPDATE SET
                    secret_encrypted = EXCLUDED.secret_encrypted,
                    confirmed_at = NULL, created_at = NOW();
                """,
                (user_id, totp.encrypt_secret(secret)),
            )
            # Replace any stale codes from an abandoned earlier attempt.
            cur.execute("DELETE FROM totp_backup_codes WHERE user_id = %s;", (user_id,))
            for code in backup_codes:
                cur.execute(
                    "INSERT INTO totp_backup_codes (user_id, code_hash) VALUES (%s, %s);",
                    (user_id, totp.hash_backup_code(code)),
                )
        conn.commit()
    return {
        "otpauth_uri": uri,
        "qr_data_uri": totp.qr_data_uri(uri),
        "backup_codes": backup_codes,
    }


def confirm_enrollment(user_id: int, code: str) -> bool:
    """Finish enrolment by checking a live code against the pending seed. On
    success marks the seed confirmed (MFA now active) and returns True."""
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT secret_encrypted FROM totp_secrets "
                "WHERE user_id = %s AND confirmed_at IS NULL;",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                return False
            secret = totp.decrypt_secret(row[0])
            if not totp.verify_code(secret, code):
                return False
            cur.execute(
                "UPDATE totp_secrets SET confirmed_at = NOW() WHERE user_id = %s;",
                (user_id,),
            )
        conn.commit()
    return True


def verify_totp(user_id: int, code: str) -> bool:
    """Second login factor: accept a current authenticator code OR a single
    unused backup code (which is then spent). Requires a confirmed enrolment."""
    with get_control_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT secret_encrypted FROM totp_secrets "
                "WHERE user_id = %s AND confirmed_at IS NOT NULL;",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                return False
            secret = totp.decrypt_secret(row[0])
            if totp.verify_code(secret, code):
                return True
            # Fall back to backup codes: find an unused one that matches, spend it.
            cur.execute(
                "SELECT id, code_hash FROM totp_backup_codes "
                "WHERE user_id = %s AND used_at IS NULL;",
                (user_id,),
            )
            for code_id, code_hash in cur.fetchall():
                if totp.verify_backup_code(code_hash, code):
                    cur.execute(
                        "UPDATE totp_backup_codes SET used_at = NOW() "
                        "WHERE id = %s AND used_at IS NULL;",
                        (code_id,),
                    )
                    conn.commit()
                    return True
    return False


def unused_backup_code_count(user_id: int) -> int:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM totp_backup_codes WHERE user_id = %s AND used_at IS NULL;",
            (user_id,),
        )
        return cur.fetchone()[0]


# --- reset helpers -----------------------------------------------------------

def user_for_reset(slug: str, email: str) -> tuple[int, str] | None:
    """(user_id, email) for a local member, or None. Used by the reset-request
    endpoint, which must behave identically whether or not the email exists."""
    if not org_uses_native(slug):
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        row = _member(cur, slug, email)
        if not row:
            return None
        return row[2], row[3]
