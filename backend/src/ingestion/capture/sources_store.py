"""Per-tenant capture-source store (which mailboxes this tenant pulls mail from).

Each customer's brain database holds its own list of mail sources in one table
(see migrations/tenant/0011_capture_sources.sql, 0013_source_is_mailbox.sql,
0017_imap_capture_sources.sql). The customer admin manages it from the Admin
Center; the periodic sync (src/ingestion/scheduler.py) and the manual backfill
read the enabled rows to know what to pull.

A source is a MAILBOX with a provider. A Graph source is an Exchange mailbox read
with the tenant's app credentials; an IMAP source is a generic mailbox read with
a per-source host + username + app password (the password is encrypted at rest
via secret_box, never stored in the clear). For an IMAP source the ``mailbox``
identity IS the IMAP username, so the rest of the machinery (cursor keying, run
labels, dedupe) is unchanged.

The admin does not pick folders: the sync pulls from ALL of a mailbox's folders
(minus junk/deleted/drafts), re-discovering the folder list on every run (see
graph_client.list_sync_folders / imap_client.list_sync_folders), so folders a
user adds or deletes are always reflected without admin action.

The functions take an open tenant connection so the caller controls which brain
DB is targeted (database-per-tenant) and the transaction boundary.
"""
from __future__ import annotations

from typing import List

import psycopg

# Columns we expose for display/listing. Deliberately EXCLUDES
# imap_secret_encrypted — the encrypted app password never leaves the store
# except through get_imap_config (which decrypts it for an actual connection).
_DISPLAY_COLS = (
    "id, mailbox, enabled, provider, imap_host, imap_port, imap_username, "
    "imap_use_ssl, created_at, created_by, "
    "gdrive_folder_id, gdrive_folder_name, gdrive_drive_id"
)


def _display_row(r: tuple) -> dict:
    return {
        "id": r[0],
        "mailbox": r[1],
        "enabled": r[2],
        "provider": r[3],
        "imap_host": r[4],
        "imap_port": r[5],
        "imap_username": r[6],
        "imap_use_ssl": r[7],
        "created_at": r[8].isoformat() if r[8] else None,
        "created_by": r[9],
        "gdrive_folder_id": r[10],
        "gdrive_folder_name": r[11],
        "gdrive_drive_id": r[12],
    }


def list_sources(conn: psycopg.Connection) -> List[dict]:
    """All configured sources for this tenant — enabled and disabled.

    Includes the provider and (for IMAP) host/username/port so the Admin Center
    can show how each source connects. Never returns the encrypted secret.
    """
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_DISPLAY_COLS} FROM capture_sources ORDER BY mailbox;"
        )
        rows = cur.fetchall()
    return [_display_row(r) for r in rows]


def source_stats(conn: psycopg.Connection) -> dict:
    """Per-mailbox capture stats, keyed by mailbox (lowercased to match
    capture_sources.mailbox): how many emails are captured, the oldest captured
    email's date, and the most recent capture time.

    Counts EVERY captured event for the mailbox — live sync and manual backfill
    are not separable here (capture_runs carries no live/backfill marker), so the
    Admin Center must label this a "captured total", not "backfilled". A mailbox
    with no captures simply won't appear in the returned map (the caller defaults
    it to 0 / null / null). Joins through capture_run_id, so the rare pre-0007
    event with a NULL run is not counted.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cr.mailbox,
                   count(ce.id),
                   min(ce.occurred_at),
                   max(ce.ingested_at)
            FROM captured_events ce
            JOIN capture_runs cr ON cr.id = ce.capture_run_id
            WHERE ce.source = 'email' AND cr.mailbox IS NOT NULL
            GROUP BY cr.mailbox;
            """
        )
        rows = cur.fetchall()
    stats: dict[str, dict] = {}
    for mailbox, captured, oldest, last in rows:
        stats[(mailbox or "").lower()] = {
            "captured": int(captured or 0),
            "oldest_email": oldest.isoformat() if oldest else None,
            "last_capture": last.isoformat() if last else None,
        }
    return stats


def enabled_mailboxes(conn: psycopg.Connection) -> List[str]:
    """The mailboxes the sync should pull — enabled rows only.

    Provider-agnostic convenience kept for callers that only need the identity.
    The scheduler uses ``enabled_sources`` instead, since it must branch on the
    provider to build the right connector.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT mailbox FROM capture_sources "
            "WHERE enabled = TRUE ORDER BY mailbox;"
        )
        return [r[0] for r in cur.fetchall()]


def enabled_sources(conn: psycopg.Connection) -> List[dict]:
    """Enabled sources with enough detail for the sync to pick a connector.

    Returns the display shape (id, mailbox, provider, imap_* connection bits —
    no secret) for each enabled row. The scheduler branches on ``provider`` and,
    for IMAP, calls ``get_imap_config`` to decrypt the password just-in-time.
    """
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_DISPLAY_COLS} FROM capture_sources "
            "WHERE enabled = TRUE ORDER BY mailbox;"
        )
        return [_display_row(r) for r in cur.fetchall()]


def get_source_by_id(conn: psycopg.Connection, source_id: int) -> dict | None:
    """One source row by id (display shape, no secret), or None if no such row."""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_DISPLAY_COLS} FROM capture_sources WHERE id = %s;",
            (source_id,),
        )
        r = cur.fetchone()
    if not r:
        return None
    return _display_row(r)


def get_imap_config(conn: psycopg.Connection, source_id: int) -> dict | None:
    """Decrypted IMAP connection details for one source, or None.

    Returns ``None`` if the row doesn't exist or isn't an IMAP source. The
    returned dict (host/port/username/password/use_ssl) is exactly the kwargs an
    ``imap_client.ImapConfig`` takes. Decrypts the app password via secret_box —
    so this is the ONLY path the plaintext is ever reconstructed, at connect time.
    """
    from src import secret_box

    with conn.cursor() as cur:
        cur.execute(
            "SELECT provider, imap_host, imap_port, imap_username, "
            "imap_secret_encrypted, imap_use_ssl "
            "FROM capture_sources WHERE id = %s;",
            (source_id,),
        )
        r = cur.fetchone()
    if not r or r[0] != "imap":
        return None
    return {
        "host": r[1],
        "port": r[2] or 993,
        "username": r[3],
        "password": secret_box.decrypt(r[4]),
        "use_ssl": r[5],
    }


def add_source(
    conn: psycopg.Connection,
    mailbox: str,
    *,
    actor: str = "admin",
) -> dict:
    """Register a mailbox to pull from. Idempotent on the mailbox.

    Re-adding the same mailbox re-enables it, so the admin can flip a removed or
    disabled source back on without a duplicate row.
    """
    # Lowercase the mailbox so case/whitespace can't create duplicate rows
    # (the UNIQUE is case-sensitive) and so it matches the control-plane email,
    # which is stored lowercased.
    mailbox = mailbox.strip().lower()
    if not mailbox:
        raise ValueError("mailbox must not be empty.")
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO capture_sources (mailbox, enabled, provider, created_by)
            VALUES (%s, TRUE, 'graph', %s)
            ON CONFLICT (mailbox)
                DO UPDATE SET enabled = TRUE, provider = 'graph'
            RETURNING id;
            """,
            (mailbox, actor),
        )
        source_id = cur.fetchone()[0]
    conn.commit()
    return get_source_by_id(conn, source_id)  # type: ignore[return-value]


def add_imap_source(
    conn: psycopg.Connection,
    *,
    host: str,
    username: str,
    password: str,
    port: int = 993,
    use_ssl: bool = True,
    actor: str = "admin",
) -> dict:
    """Register a generic IMAP mailbox to pull from. Idempotent on the username.

    The IMAP username IS the mailbox identity, so re-adding the same account
    updates its connection details (host/port/SSL) and password and re-enables
    it — no duplicate row. The app password is encrypted with secret_box before
    it touches the database; the plaintext is never stored.
    """
    from src import secret_box

    host = host.strip()
    username = username.strip().lower()
    if not host or not username:
        raise ValueError("IMAP host and username are required.")
    if not password:
        raise ValueError("IMAP app password is required.")
    secret_encrypted = secret_box.encrypt(password)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO capture_sources
                (mailbox, enabled, provider, imap_host, imap_port,
                 imap_username, imap_secret_encrypted, imap_use_ssl, created_by)
            VALUES (%s, TRUE, 'imap', %s, %s, %s, %s, %s, %s)
            ON CONFLICT (mailbox) DO UPDATE SET
                enabled = TRUE,
                provider = 'imap',
                imap_host = EXCLUDED.imap_host,
                imap_port = EXCLUDED.imap_port,
                imap_username = EXCLUDED.imap_username,
                imap_secret_encrypted = EXCLUDED.imap_secret_encrypted,
                imap_use_ssl = EXCLUDED.imap_use_ssl
            RETURNING id;
            """,
            (username, host, port, username, secret_encrypted, use_ssl, actor),
        )
        source_id = cur.fetchone()[0]
    conn.commit()
    return get_source_by_id(conn, source_id)  # type: ignore[return-value]


def add_gdrive_source(
    conn: psycopg.Connection,
    *,
    folder_id: str,
    folder_name: str | None = None,
    drive_id: str | None = None,
    actor: str = "admin",
) -> dict:
    """Register a Google Drive folder to read from. Idempotent on the folder.

    There is NO per-source secret: access is via the shared service account whose
    key lives in the server env, granted by the customer sharing the folder with
    that account inside Google Drive. We persist only WHICH folder to read. The
    unique ``mailbox`` identity is ``gdrive:<folderId>`` so a folder can't be added
    twice; re-adding re-enables it and refreshes the cached folder name.

    NOTE: this only stores the connection. Actually reading the folder's files is a
    later phase — until that connector ships the scheduler skips gdrive rows.
    """
    folder_id = (folder_id or "").strip()
    if not folder_id:
        raise ValueError("Google Drive folder id is required.")
    identity = f"gdrive:{folder_id}"
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO capture_sources
                (mailbox, enabled, provider, gdrive_folder_id, gdrive_folder_name,
                 gdrive_drive_id, created_by)
            VALUES (%s, TRUE, 'gdrive', %s, %s, %s, %s)
            ON CONFLICT (mailbox) DO UPDATE SET
                enabled            = TRUE,
                provider           = 'gdrive',
                gdrive_folder_id   = EXCLUDED.gdrive_folder_id,
                gdrive_folder_name = EXCLUDED.gdrive_folder_name,
                gdrive_drive_id    = EXCLUDED.gdrive_drive_id
            RETURNING id;
            """,
            (identity, folder_id, folder_name, drive_id, actor),
        )
        source_id = cur.fetchone()[0]
    conn.commit()
    return get_source_by_id(conn, source_id)  # type: ignore[return-value]


def set_enabled(
    conn: psycopg.Connection, source_id: int, enabled: bool
) -> bool:
    """Enable/disable one source by id. Returns False if no such row."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE capture_sources SET enabled = %s WHERE id = %s;",
            (enabled, source_id),
        )
        changed = cur.rowcount > 0
    conn.commit()
    return changed


def remove_source(conn: psycopg.Connection, source_id: int) -> bool:
    """Delete one source by id. Returns False if no such row.

    Only removes it from the pull list; the mailbox's delta cursor and any
    already-captured events are left untouched.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM capture_sources WHERE id = %s;", (source_id,))
        changed = cur.rowcount > 0
    conn.commit()
    return changed
