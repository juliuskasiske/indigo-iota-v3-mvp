"""Generic IMAP mail client — for customers who are NOT on Microsoft 365.

The IMAP-world twin of graph_client.py: it is the ONLY part of this connector
that talks to a customer's IMAP server, and (per the connector contract) it
normalizes every fetched message into a ``NormalizedCapturedEvent`` so everything
downstream — scope gate, captured_events, comprehend — is provider-agnostic.

Auth: per-source host + username + app password. No OAuth — generic IMAP shops
have no SSO identity provider. The password is stored encrypted (secret_box) and
decrypted by the caller before it builds an ``ImapConfig``; this module never
touches the database.

Incremental sync: IMAP has no delta token, so we track our place per folder with
the server's UIDVALIDITY plus the highest UID we have already pulled, serialized
as the cursor string ``"<uidvalidity>:<last_uid>"`` (stored in the same
``capture_cursors`` slot Graph uses for its delta link). Next run we fetch only
UIDs above ``last_uid``. If UIDVALIDITY changed, the server renumbered the folder
and the old UIDs are meaningless, so we resync that folder from scratch.

Deletions are not tracked: unlike Graph delta there are no tombstones here, so a
message deleted on the server stays in the brain until erased another way. That's
an accepted limitation of the IMAP path.
"""
from __future__ import annotations

import email
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.utils import getaddresses, parsedate_to_datetime
from typing import Iterable, List, Tuple

from src.ingestion.capture import normalize
from src.ingestion.capture.clean import html_to_text

_DEFAULT_PORT = 993
_HTTP_TIMEOUT = 30.0
# Fetch bodies in batches so one huge folder doesn't become a single giant FETCH
# the server (or our memory) chokes on.
_FETCH_CHUNK = 200

# Folders we never pull, mirroring the Graph connector's junk/deleted/drafts rule.
# Reliable path: RFC 6154 SPECIAL-USE flags (locale-independent). Fallback: match
# common folder names for servers that don't advertise SPECIAL-USE.
_EXCLUDED_SPECIAL_USE = frozenset({"\\junk", "\\trash", "\\drafts"})
_EXCLUDED_NAMES = frozenset(
    {
        "junk", "junk e-mail", "junk email", "spam", "bulk mail",
        "trash", "deleted", "deleted items", "deleted messages", "bin",
        "drafts", "draft",
    }
)


@dataclass
class ImapConfig:
    """Connection details for one IMAP account (password already decrypted)."""

    host: str
    username: str
    password: str
    port: int = _DEFAULT_PORT
    use_ssl: bool = True


def _parse_cursor(cursor: str | None) -> Tuple[int | None, int]:
    """Split ``"<uidvalidity>:<last_uid>"`` into (uidvalidity, last_uid).

    Returns ``(None, 0)`` when there is no cursor or it can't be parsed, which
    forces a fresh full pull of the folder.
    """
    if not cursor:
        return None, 0
    try:
        validity, last_uid = cursor.split(":", 1)
        return int(validity), int(last_uid)
    except (ValueError, AttributeError):
        return None, 0


def _chunks(items: List[int], size: int) -> Iterable[List[int]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


# A FETCH for the full message can come back under different keys depending on
# the server: we ask for BODY.PEEK[] (RFC 3501, no \Seen side-effect) but a
# server may key the returned literal as BODY[] or RFC822. Read whichever is
# present so messages are never silently skipped.
_BODY_FETCH_ITEM = "BODY.PEEK[]"
_BODY_KEYS = (b"BODY[]", b"RFC822")


def _raw_message(data: dict | None) -> bytes | None:
    if not data:
        return None
    for key in _BODY_KEYS:
        val = data.get(key)
        if val:
            return val
    return None


def _flag_strs(flags: Iterable) -> set[str]:
    """Lowercase a folder's flag tuple (imapclient yields bytes) to a str set."""
    out: set[str] = set()
    for f in flags or ():
        if isinstance(f, bytes):
            f = f.decode("ascii", "ignore")
        out.add(str(f).lower())
    return out


def _addr_list(values: list) -> List[str]:
    """Email addresses out of a list of header values (To/Cc/From)."""
    out: List[str] = []
    for _name, addr in getaddresses(values or []):
        addr = (addr or "").strip()
        if addr:
            out.append(addr)
    return out


def _strip_angle(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().strip("<>").strip()
    return value or None


def message_to_event(
    raw_bytes: bytes, uid: int, folder: str
) -> normalize.NormalizedCapturedEvent:
    """Parse one RFC822 message into a NormalizedCapturedEvent.

    Pure (no I/O), so it's unit-testable against .eml fixtures without a server.
    Mirrors normalize.normalize_message (the Graph translator) field-for-field so
    captured_events rows look identical regardless of which connector produced
    them.
    """
    msg = email.message_from_bytes(raw_bytes, policy=policy.default)

    message_id = _strip_angle(msg["Message-ID"])
    # External id is the dedup key (source, external_id). Message-ID is the stable
    # cross-folder identity; synthesize a per-folder fallback if it's missing.
    external_id = message_id or f"imap:{folder}:{uid}"

    from_pairs = getaddresses(msg.get_all("From", []))
    from_addrs = [a.strip() for _n, a in from_pairs if (a or "").strip()]
    sender = from_addrs[0] if from_addrs else None
    # Display name of the first From address, if the header carried one.
    sender_name = None
    for nm, a in from_pairs:
        if (a or "").strip() == sender and (nm or "").strip():
            sender_name = nm.strip()
            break

    recipients_to = _addr_list(msg.get_all("To", []))
    recipients_cc = _addr_list(msg.get_all("Cc", []))
    participants: List[str] = []
    seen: set[str] = set()
    for addr in (from_addrs + recipients_to + recipients_cc):
        if addr not in seen:
            seen.add(addr)
            participants.append(addr)

    # Thread root: the first References id (or In-Reply-To), else the message's
    # own id — so a standalone message threads to itself, like Graph's
    # conversationId.
    references = (msg["References"] or "").split()
    thread_raw = references[0] if references else (msg["In-Reply-To"] or "")
    thread_id = _strip_angle(thread_raw) or message_id

    occurred_at: datetime | None = None
    if msg["Date"]:
        try:
            occurred_at = parsedate_to_datetime(msg["Date"])
        except (TypeError, ValueError):
            occurred_at = None

    body = msg.get_body(preferencelist=("plain", "html"))
    if body is None:
        body_text = ""
    else:
        content = body.get_content() or ""
        if body.get_content_subtype() == "html":
            body_text = html_to_text(content)
        else:
            body_text = content.strip()

    attachments: List[dict] = []
    if any(True for _ in msg.iter_attachments()):
        attachments = [{"has_attachments": True}]

    # Keep raw compact and JSON-safe (Header objects aren't serializable).
    raw = {
        "provider": "imap",
        "folder": folder,
        "uid": int(uid),
        "message_id": message_id,
        "subject": str(msg["Subject"]) if msg["Subject"] else None,
        "from": str(msg["From"]) if msg["From"] else None,
        "date": str(msg["Date"]) if msg["Date"] else None,
    }

    return normalize.NormalizedCapturedEvent(
        source=normalize.SOURCE_EMAIL,
        external_id=external_id,
        thread_id=thread_id,
        occurred_at=occurred_at,
        sender=sender,
        sender_name=sender_name,
        participants=participants,
        recipients_to=recipients_to,
        recipients_cc=recipients_cc,
        subject=(str(msg["Subject"]) if msg["Subject"] else "").strip(),
        body_text=body_text,
        attachments=attachments,
        raw=raw,
    )


class ImapFetcher:
    """Pulls mail from one IMAP folder. Implements the ``fetch`` boundary.

    Bound to a single folder (like ``GraphMailClient(folder=...)``); the
    scheduler builds one per folder it discovers. ``fetch`` matches the
    ``MailFetcher`` protocol so mail.ingest_mailbox treats it exactly like the
    Graph client.
    """

    def __init__(self, cfg: ImapConfig, folder: str = "INBOX"):
        self.cfg = cfg
        self.folder = folder

    def _connect(self):
        """Open + authenticate an IMAP connection (caller must log out)."""
        from imapclient import IMAPClient

        client = IMAPClient(
            self.cfg.host,
            port=self.cfg.port,
            ssl=self.cfg.use_ssl,
            timeout=_HTTP_TIMEOUT,
        )
        client.login(self.cfg.username, self.cfg.password)
        return client

    def fetch(
        self, mailbox: str, delta_link: str | None = None
    ) -> Tuple[List[normalize.NormalizedCapturedEvent], str | None]:
        """Pull new messages from this folder. Returns (events, new_cursor).

        ``mailbox`` is ignored for connection (the account IS the mailbox); it's
        only the label/cursor key the caller threads through. ``delta_link`` here
        is our ``"<uidvalidity>:<last_uid>"`` cursor. With a matching cursor we
        fetch only UIDs above ``last_uid``; otherwise (first run or the folder
        was renumbered) we pull the whole folder to establish a baseline.
        """
        client = self._connect()
        try:
            select = client.select_folder(self.folder, readonly=True)
            uidvalidity = int(select[b"UIDVALIDITY"])
            prev_validity, last_uid = _parse_cursor(delta_link)

            if prev_validity == uidvalidity:
                # Incremental: UIDs strictly above where we left off. IMAP's
                # "N:*" returns the highest UID even when none are >= N, so
                # filter defensively.
                candidate = client.search(["UID", "%d:*" % (last_uid + 1)])
                uids = sorted(u for u in candidate if u > last_uid)
                max_uid = last_uid
            else:
                # First sync or renumbered folder: full baseline pull.
                uids = sorted(client.search(["ALL"]))
                max_uid = 0

            events: List[normalize.NormalizedCapturedEvent] = []
            for chunk in _chunks(uids, _FETCH_CHUNK):
                fetched = client.fetch(chunk, [_BODY_FETCH_ITEM])
                for uid in chunk:
                    raw = _raw_message(fetched.get(uid))
                    if raw is None:
                        continue
                    events.append(message_to_event(raw, uid, self.folder))
                    if uid > max_uid:
                        max_uid = uid

            return events, f"{uidvalidity}:{max_uid}"
        finally:
            client.logout()

    def fetch_window(
        self,
        since: datetime,
        max_count: int,
        folder: str | None = None,
    ) -> List[normalize.NormalizedCapturedEvent]:
        """Pull up to ``max_count`` messages received on/after ``since``, newest first.

        The IMAP twin of ``GraphMailClient.fetch_window`` for the historical
        backfill: filters by date (IMAP ``SINCE`` is day-granular) and returns NO
        cursor, so a backfill never disturbs the incremental baseline.
        """
        folder = folder or self.folder
        if max_count <= 0:
            return []
        since_utc = since.astimezone(timezone.utc) if since.tzinfo else since.replace(
            tzinfo=timezone.utc
        )
        client = self._connect()
        try:
            client.select_folder(folder, readonly=True)
            uids = client.search(["SINCE", since_utc.date()])
            # Newest first, capped to the budget.
            uids = sorted(uids, reverse=True)[:max_count]
            events: List[normalize.NormalizedCapturedEvent] = []
            for chunk in _chunks(uids, _FETCH_CHUNK):
                fetched = client.fetch(chunk, [_BODY_FETCH_ITEM])
                for uid in chunk:
                    raw = _raw_message(fetched.get(uid))
                    if raw is None:
                        continue
                    events.append(message_to_event(raw, uid, folder))
            return events[:max_count]
        finally:
            client.logout()

    def list_sync_folders(self) -> List[dict]:
        """Every folder we should sync, minus junk/trash/drafts.

        Prefers RFC 6154 SPECIAL-USE flags; falls back to common folder names for
        servers that don't advertise them. Each entry is ``{"id", "name"}`` where
        ``id`` is the IMAP folder name to SELECT — the same shape
        graph_client.list_sync_folders returns, so the scheduler treats both
        connectors alike.
        """
        client = self._connect()
        try:
            kept: List[dict] = []
            for flags, _delimiter, name in client.list_folders():
                flag_set = _flag_strs(flags)
                if flag_set & _EXCLUDED_SPECIAL_USE:
                    continue
                if name.lower() in _EXCLUDED_NAMES:
                    continue
                kept.append({"id": name, "name": name})
            return kept
        finally:
            client.logout()

    def probe(self) -> Tuple[str, str]:
        """Live check: can we connect, authenticate, and open the inbox?

        Mirrors graph_client.probe_mailbox so the admin "test connection" button
        gets a uniform verdict:
          * "readable"    — connected, logged in, INBOX opened
          * "auth_failed" — server rejected the username/app password
          * "error"       — anything else (network, TLS, no such folder)
        Never raises; returns the verdict so the API can surface it.
        """
        from imapclient.exceptions import IMAPClientError, LoginError

        try:
            client = self._connect()
        except LoginError as exc:
            return "auth_failed", f"Login rejected: {exc}"
        except (IMAPClientError, OSError) as exc:
            return "error", f"Could not connect: {exc}"
        try:
            client.select_folder("INBOX", readonly=True)
            return "readable", "ok"
        except (IMAPClientError, OSError) as exc:
            return "error", f"Connected but could not open INBOX: {exc}"
        finally:
            try:
                client.logout()
            except Exception:
                pass
