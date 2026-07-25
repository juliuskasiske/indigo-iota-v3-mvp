"""Mail ingestion orchestrator: provider events -> scope gate -> captured_events.

This is the connector's chokepoint. For one mailbox it:

  1. loads the saved sync cursor (incremental sync),
  2. fetches changed messages (via an injected fetcher — GraphMailClient or
     ImapFetcher in production, a fake in tests),
  3. runs each through the per-tenant scope classifier,
  4. writes INCLUDED events to captured_events (deduped); records EXCLUDED events
     as content-free audit rows,
  5. applies tombstones (deletes the matching captured_events row),
  6. persists the new sync cursor and a run summary.

Each fetcher returns already-normalized ``NormalizedCapturedEvent`` objects, so
everything here is provider-agnostic — the Graph-vs-IMAP difference lives entirely
inside the connector. It takes an open tenant connection so the caller picks the
brain DB and owns the transaction boundary (database-per-tenant). Nothing here
touches the LLM — the expensive comprehend step is separate
(src/ingestion/runner.py), so capture is cheap, fast, and safe to run often.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, List, Protocol, Tuple

import psycopg
from psycopg.types.json import Jsonb

from src.ingestion.capture import normalize
from src.ingestion.triage import classify, scope_store


class MailFetcher(Protocol):
    """Anything that returns (normalized events, new cursor) for a mailbox.

    The connector owns the provider-specific bits: talking to Graph or IMAP,
    paging, AND turning each raw message into a ``NormalizedCapturedEvent``. The
    cursor is opaque to this module — Graph stores a delta link, IMAP stores a
    ``UIDVALIDITY:lastUID`` marker; both round-trip through ``capture_cursors``.
    """

    def fetch(
        self, mailbox: str, delta_link: str | None
    ) -> Tuple[List[normalize.NormalizedCapturedEvent], str | None]: ...


@dataclass
class CaptureSummary:
    run_id: int
    mailbox: str
    fetched: int = 0
    included: int = 0
    excluded: int = 0
    duplicates: int = 0
    removed: int = 0

    def as_dict(self) -> dict:
        return {
            "run_id": self.run_id, "mailbox": self.mailbox, "fetched": self.fetched,
            "included": self.included, "excluded": self.excluded,
            "duplicates": self.duplicates, "removed": self.removed,
        }


def _load_delta(conn: psycopg.Connection, mailbox: str, folder: str) -> str | None:
    # Graph's delta cursor is per folder, so the cursor is keyed by the
    # (mailbox, folder) pair — Inbox and Sent of the same mailbox each keep
    # their own place.
    with conn.cursor() as cur:
        cur.execute(
            "SELECT delta_link FROM capture_cursors "
            "WHERE mailbox = %s AND folder = %s;",
            (mailbox, folder),
        )
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def _save_delta(
    conn: psycopg.Connection, mailbox: str, folder: str, delta_link: str | None
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO capture_cursors (mailbox, folder, delta_link, last_synced_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (mailbox, folder)
                DO UPDATE SET delta_link = EXCLUDED.delta_link,
                              last_synced_at = now();
            """,
            (mailbox, folder, delta_link),
        )


def _capture_floor(conn: psycopg.Connection, mailbox: str) -> datetime | None:
    """The earliest ``occurred_at`` the live sync will ingest for this mailbox.

    A mailbox's own ``capture_sources.created_at`` — the moment it was connected.
    The live sync is forward-only: on first contact a provider hands back the
    ENTIRE folder (Graph's initial delta has no date filter; IMAP's first run is
    ``SEARCH ALL``), and without a floor that whole back-catalog — years of mail —
    would pour into the brain. Anything older than when the mailbox was connected
    is the historical backfill's job, and only to the window the admin picks; it
    is never the live sync's. Returns ``None`` for a mailbox with no source row
    (env-target / file-replay dev paths), which disables the floor.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT created_at FROM capture_sources WHERE mailbox = %s;",
            (mailbox,),
        )
        row = cur.fetchone()
    return row[0] if row else None


def _passes_floor(
    event: normalize.NormalizedCapturedEvent, floor: datetime | None
) -> bool:
    """Whether the live sync keeps ``event`` given the forward-only ``floor``.

    Always keep tombstones (a deletion must apply no matter how old the message
    was) and undated events (rare; better than silently dropping them). Otherwise
    keep only mail received at/after the floor. Genuinely new mail always sorts
    at/after ``created_at``, so this never bites incremental runs — it only trims
    the full-catalog dump on a first sync or an IMAP UIDVALIDITY reset.
    """
    if floor is None or event.removed or event.occurred_at is None:
        return True
    occurred = event.occurred_at
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)
    return occurred >= floor


def _start_capture_run(conn: psycopg.Connection, mailbox: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO capture_runs (source, mailbox) VALUES (%s, %s) RETURNING id;",
            (normalize.SOURCE_EMAIL, mailbox),
        )
        return cur.fetchone()[0]


def _finish_capture_run(conn: psycopg.Connection, s: CaptureSummary, error: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE capture_runs
               SET finished_at = now(), fetched = %s, included = %s, excluded = %s,
                   duplicates = %s, removed = %s, error = %s
             WHERE id = %s;
            """,
            (s.fetched, s.included, s.excluded, s.duplicates, s.removed, error, s.run_id),
        )


def _insert_captured_event(
    conn: psycopg.Connection, run_id: int, event: normalize.NormalizedCapturedEvent
) -> bool:
    """Insert an included captured event. Returns True if new, False if a duplicate.

    capture_run_id records the run that FIRST captured the event: on a duplicate
    the ON CONFLICT DO NOTHING leaves the existing row (and its run id) untouched.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO captured_events
                (source, external_id, thread_id, occurred_at, sender, sender_name,
                 participants, recipients_to, recipients_cc, subject, body_text,
                 attachments, raw, capture_run_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
                DO NOTHING;
            """,
            (
                event.source, event.external_id, event.thread_id, event.occurred_at,
                event.sender, event.sender_name, Jsonb(event.participants),
                Jsonb(event.recipients_to), Jsonb(event.recipients_cc),
                event.subject, event.body_text,
                Jsonb(event.attachments), Jsonb(event.raw), run_id,
            ),
        )
        inserted = cur.rowcount > 0
        # A no-op insert means this (source, external_id) was already captured —
        # i.e. a duplicate re-fetch. Log the hit (content-free) so the
        # observability trace can show per-email how often it recurred.
        if not inserted and event.external_id is not None:
            cur.execute(
                "INSERT INTO capture_duplicates (source, external_id, run_id) "
                "VALUES (%s, %s, %s);",
                (event.source, event.external_id, run_id),
            )
        return inserted


def _record_exclusion(
    conn: psycopg.Connection, run_id: int, event: normalize.NormalizedCapturedEvent,
    decision: classify.Decision,
) -> None:
    """Persist a content-free exclusion record (no subject/body/sender)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO triage_exclusions
                (run_id, source, external_id, bucket, reason, scores,
                 layer2_applied, occurred_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
            """,
            (
                run_id, event.source, event.external_id, decision.bucket, decision.reason,
                Jsonb({k: round(v, 4) for k, v in decision.scores.items()}),
                decision.layer2_applied, event.occurred_at,
            ),
        )


def _apply_removal(conn: psycopg.Connection, event: normalize.NormalizedCapturedEvent) -> None:
    """A delta tombstone: drop the matching captured_events row if we have it."""
    if not event.external_id:
        return
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM captured_events WHERE source = %s AND external_id = %s;",
            (event.source, event.external_id),
        )


def _process_events(
    conn: psycopg.Connection,
    run_id: int,
    events: List[normalize.NormalizedCapturedEvent],
    scope_defs: dict,
    summary: CaptureSummary,
) -> None:
    """Run a batch of already-normalized events through scope gate -> store.

    Shared by the incremental sync and the historical backfill: removals are
    applied as tombstones, and the rest are classified and either captured
    (deduped) or recorded as content-free exclusions. Tallies land on
    ``summary``. The connector already normalized each message, so this is
    provider-agnostic; the caller owns fetching, cursor handling, and commits.
    """
    summary.fetched += len(events)
    for event in events:
        if event.removed:
            _apply_removal(conn, event)
            summary.removed += 1
            continue
        decision = classify.classify(event.classify_text, scope_defs)
        if decision.include:
            if _insert_captured_event(conn, run_id, event):
                summary.included += 1
            else:
                summary.duplicates += 1
        else:
            _record_exclusion(conn, run_id, event, decision)
            summary.excluded += 1


def ingest_mailbox(
    conn: psycopg.Connection,
    mailbox: str,
    fetcher: MailFetcher,
    scope_defs: dict | None = None,
    folder: str = "inbox",
) -> CaptureSummary:
    """Run one incremental ingest of ``mailbox``/``folder`` through the scope gate.

    ``folder`` selects which delta cursor to load/save: Graph's delta is
    per folder, so each (mailbox, folder) keeps its own cursor. The fetcher is
    already bound to that folder (the caller builds it via ``_make_fetcher``).
    """
    if scope_defs is None:
        scope_defs = scope_store.get_definitions(conn)

    run_id = _start_capture_run(conn, mailbox)
    conn.commit()
    summary = CaptureSummary(run_id=run_id, mailbox=mailbox)
    error: str | None = None
    try:
        delta = _load_delta(conn, mailbox, folder)
        events, new_delta = fetcher.fetch(mailbox, delta)
        # Forward-only: drop pre-connection back-catalog so a first sync (Graph's
        # full initial delta / IMAP's SEARCH ALL) can't pour years of history into
        # the brain. History is the backfill's job, to the window the admin picks.
        floor = _capture_floor(conn, mailbox)
        events = [e for e in events if _passes_floor(e, floor)]
        _process_events(conn, run_id, events, scope_defs, summary)
        _save_delta(conn, mailbox, folder, new_delta)
        conn.commit()
    except Exception as exc:  # persist the failure on the run, then re-raise
        conn.rollback()
        error = repr(exc)
        _finish_capture_run(conn, summary, error)
        conn.commit()
        raise
    _finish_capture_run(conn, summary, error)
    conn.commit()
    return summary


def backfill_mailbox(
    conn: psycopg.Connection,
    mailbox: str,
    events: List[normalize.NormalizedCapturedEvent],
    scope_defs: dict | None = None,
) -> CaptureSummary:
    """Capture a bounded batch of already-fetched, normalized historical events.

    A one-off catch-up over a date window (the caller fetches it via
    ``GraphMailClient.fetch_window``, which returns normalized events). It runs
    the same scope gate and writes a ``capture_runs`` row, but deliberately does
    NOT touch the delta cursor — backfill is orthogonal to the incremental
    baseline, so a later live sync still resumes from wherever delta left off.
    Captured events dedupe against whatever live sync has already pulled, so
    overlap is harmless.
    """
    if scope_defs is None:
        scope_defs = scope_store.get_definitions(conn)

    run_id = _start_capture_run(conn, mailbox)
    conn.commit()
    summary = CaptureSummary(run_id=run_id, mailbox=mailbox)
    error: str | None = None
    try:
        _process_events(conn, run_id, events, scope_defs, summary)
        conn.commit()
    except Exception as exc:  # persist the failure on the run, then re-raise
        conn.rollback()
        error = repr(exc)
        _finish_capture_run(conn, summary, error)
        conn.commit()
        raise
    _finish_capture_run(conn, summary, error)
    conn.commit()
    return summary
