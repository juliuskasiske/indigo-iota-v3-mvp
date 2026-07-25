"""Normalize a Microsoft Graph mail message into a captured_events row.

The connector pulls raw Graph message objects; everything downstream (the triage
gate, captured_events, comprehend) speaks our normalized shape, not Graph's. This
module is the single translation point — and it's pure (no I/O), so it's trivial
to test against captured message fixtures.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, List

from src.ingestion.capture.clean import html_to_text

SOURCE_EMAIL = "email"


@dataclass
class NormalizedCapturedEvent:
    """A Graph message mapped to the captured_events columns + the classify text."""

    source: str
    external_id: str | None
    thread_id: str | None
    occurred_at: datetime | None
    sender: str | None
    participants: List[str]
    subject: str
    body_text: str
    attachments: List[dict]
    raw: dict
    removed: bool = False  # Graph delta tombstone — the message was deleted
    sender_name: str | None = None  # display name from the From header, if any
    # To and CC kept separate (participants merges them); BCC isn't in headers.
    recipients_to: List[str] = field(default_factory=list)
    recipients_cc: List[str] = field(default_factory=list)

    @property
    def classify_text(self) -> str:
        """The text the scope classifier compares against the bucket anchors.

        Subject + body carry the topical signal; we lead with the subject so a
        clear subject line isn't drowned out by a long body.
        """
        parts = [p for p in (self.subject, self.body_text) if p]
        return "\n\n".join(parts).strip()


def _address(entry: dict | None) -> str | None:
    """Pull the email address out of a Graph recipient object."""
    if not entry:
        return None
    ea = entry.get("emailAddress") or {}
    return ea.get("address") or None


def _display_name(entry: dict | None) -> str | None:
    """Pull the display name out of a Graph recipient object (None if absent)."""
    if not entry:
        return None
    name = ((entry.get("emailAddress") or {}).get("name") or "").strip()
    return name or None


def _addresses(entries: Any) -> List[str]:
    out: List[str] = []
    for e in entries or []:
        addr = _address(e)
        if addr:
            out.append(addr)
    return out


def _parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    # Graph returns e.g. '2026-05-30T08:15:00Z'. fromisoformat needs +00:00.
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _body_text(msg: dict) -> str:
    body = msg.get("body") or {}
    content = body.get("content") or ""
    if (body.get("contentType") or "").lower() == "html":
        return html_to_text(content)
    # Some messages only carry a preview; fall back to it.
    return (content or msg.get("bodyPreview") or "").strip()


def normalize_message(msg: dict) -> NormalizedCapturedEvent:
    """Map one Graph message (or delta tombstone) to a NormalizedCapturedEvent."""
    external_id = msg.get("id")

    # Delta tombstone: {"id": ..., "@removed": {"reason": "deleted"}}.
    if "@removed" in msg:
        return NormalizedCapturedEvent(
            source=SOURCE_EMAIL, external_id=external_id, thread_id=None,
            occurred_at=None, sender=None, participants=[], subject="",
            body_text="", attachments=[], raw=msg, removed=True,
        )

    sender = _address(msg.get("from"))
    sender_name = _display_name(msg.get("from"))
    recipients_to = _addresses(msg.get("toRecipients"))
    recipients_cc = _addresses(msg.get("ccRecipients"))
    # participants = sender + To + CC, de-duped, order-preserved (back-compat).
    participants: List[str] = ([sender] if sender else []) + recipients_to + recipients_cc
    seen: set[str] = set()
    participants = [p for p in participants if not (p in seen or seen.add(p))]

    attachments: List[dict] = []
    if msg.get("hasAttachments"):
        # Delta payloads don't expand attachments; record the flag now and
        # fetch metadata lazily later if needed.
        attachments = [{"has_attachments": True}]

    return NormalizedCapturedEvent(
        source=SOURCE_EMAIL,
        external_id=external_id,
        thread_id=msg.get("conversationId"),
        occurred_at=_parse_dt(msg.get("receivedDateTime") or msg.get("sentDateTime")),
        sender=sender,
        sender_name=sender_name,
        participants=participants,
        recipients_to=recipients_to,
        recipients_cc=recipients_cc,
        subject=(msg.get("subject") or "").strip(),
        body_text=_body_text(msg),
        attachments=attachments,
        raw=msg,
    )
