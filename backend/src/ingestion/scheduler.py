"""Periodic mail sync — pull configured mailboxes on a timer.

Without this, a mailbox is only ingested when someone runs ``python -m
src.ingestion`` by hand, so the brain goes stale between manual runs. This loops
"sync every configured mailbox -> wait -> repeat" so each tenant's brain stays
current on its own. It reuses the exact ingest path the CLI uses (scope gate,
audit, captured_events), so behaviour is identical — only the trigger differs.

Configuration (env):
    IOTA_SYNC_TARGETS           Comma-separated ``slug:mailbox`` pairs, e.g.
                                "acme:ops@acme.com,acme:sales@acme.com".
                                Each is synced into that tenant's brain DB.
                                OVERRIDE/offline path: when set, ONLY these are
                                synced. Unset/empty -> the loop discovers targets
                                from each active tenant's admin-managed
                                ``capture_sources`` table every cycle.
    IOTA_SYNC_INTERVAL_SECONDS  Seconds between cycles (default 600).
    IOTA_SYNC_FOLDER            Mail folder for env targets (default "inbox").
                                DB-discovered targets ignore this — they pull
                                ALL of the mailbox's folders (minus junk/deleted/
                                drafts), re-discovered each sync.
    IOTA_SYNC_PROCESS           "1" to also comprehend new events into the brain
                                after each capture (needs LLM config + credits).
    IOTA_SYNC_FROM_FILE         Offline testing: replay Graph messages from this
                                JSON file instead of calling Microsoft. Lets the
                                loop be exercised with no credentials.

Live sync talks to Microsoft Graph and therefore needs GRAPH_* creds plus the
customer's admin consent; until that exists, use IOTA_SYNC_FROM_FILE to verify
the machinery offline.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

from src.db.connection import get_tenant_connection
from src.ingestion.capture import mail, normalize
from src.tenancy.provision import tenant_db_name

_DEFAULT_INTERVAL = 600

# Providers the sync loop knows how to pull.
_SYNCABLE_PROVIDERS = {"graph", "imap", "gdrive"}

# Google Drive is scanned far less often than mail (a folder tree-walk is heavier
# and files change slowly): only re-scan a Drive source if its last scan was at
# least this long ago. Tracked per source in capture_cursors (folder=_DRIVE_CURSOR).
_GDRIVE_SCAN_INTERVAL = int(os.environ.get("IOTA_GDRIVE_SCAN_INTERVAL_SECONDS", 86400))
_DRIVE_CURSOR = "__drive__"

# The Delivery tab's to-do pool is recomputed (a per-member brain inference) at
# most this often; the rest of the time the cached pool is served. Gated off each
# pool's computed_at (db.delivery_store). Default 3 hours.
_DELIVERY_INTERVAL = int(os.environ.get("IOTA_DELIVERY_INTERVAL_SECONDS", 10800))


class _FileFetcher:
    """Replays Graph messages from a JSON file — offline, credential-free.

    The file holds raw Graph message JSON (the wire shape), so it normalizes each
    one here to match the live fetchers, which now return normalized events.
    """

    def __init__(self, path: str):
        self._messages = json.loads(Path(path).read_text(encoding="utf-8"))

    def fetch(
        self, mailbox: str, delta_link: str | None
    ) -> Tuple[List[normalize.NormalizedCapturedEvent], str | None]:
        return [normalize.normalize_message(m) for m in self._messages], None


def _parse_targets(raw: str, folder: str) -> List[dict]:
    """Parse ``slug:mailbox`` pairs into Graph targets; skip malformed.

    Env targets are always Graph with one explicit ``folder`` (the offline/
    override path). Each is the same dict shape ``_discover_targets`` produces, so
    ``_sync_once`` handles both uniformly.
    """
    targets: List[dict] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        slug, sep, mailbox = chunk.partition(":")
        slug, mailbox = slug.strip(), mailbox.strip()
        if not sep or not slug or not mailbox:
            print(f"[sync] ignoring malformed target {chunk!r} (want 'slug:mailbox').")
            continue
        targets.append(
            {
                "slug": slug,
                "db_name": tenant_db_name(slug),
                "mailbox": mailbox,
                "provider": "graph",
                "source_id": None,
                "folder": folder,  # one explicit folder for env/offline targets
            }
        )
    return targets


def _discover_targets() -> List[dict]:
    """Targets from every active tenant's admin-managed ``capture_sources``.

    Reads each tenant's own brain DB for the enabled sources, so what gets synced
    follows what admins configure in the Admin Center — no redeploy. A tenant with
    no enabled sources contributes nothing. ``folder`` is ``None``: these targets
    pull from ALL of the mailbox's folders, discovered per sync. Each target
    carries its ``provider`` and ``source_id`` so the loop can build the right
    connector (Graph app-creds vs. IMAP host/username/password).
    """
    from src.ingestion.capture import sources_store
    from src.db import onboarding_store
    from src.tenancy.provision import list_organizations

    targets: List[dict] = []
    for slug, _name, status, _region, db_name, _schema in list_organizations():
        if status != "active":
            continue
        try:
            with get_tenant_connection(db_name) as conn:
                # Live sync stays paused until onboarding is FINISHED, not merely
                # until the scope is approved. Scope approval happens mid-wizard
                # (the Triage step), several steps before the admin sets the
                # historical backfill window on Activate — so unpausing then let
                # the firehose pull the whole mailbox before the window was ever
                # chosen. Gating on completion keeps history the backfill's job and
                # leaves the live sync purely forward-looking. (is_onboarded also
                # implies scope approval, since the wizard can't finish without it.)
                if not onboarding_store.is_onboarded(conn):
                    print(f"[sync] skipping {slug}: onboarding not finished yet")
                    continue
                for s in sources_store.enabled_sources(conn):
                    # Skip providers the sync loop can't pull yet (e.g. 'gdrive',
                    # connect-only in v0). They stay stored but inert, so they can
                    # never break the email sync.
                    if s["provider"] not in _SYNCABLE_PROVIDERS:
                        continue
                    targets.append(
                        {
                            "slug": slug,
                            "db_name": db_name,
                            "mailbox": s["mailbox"],
                            "provider": s["provider"],
                            "source_id": s["id"],
                            "folder": None,  # pull all folders, discovered live
                        }
                    )
        except Exception:  # a bad tenant DB shouldn't sink discovery for the rest
            print(f"[sync] ERROR reading sources for {slug}:", file=sys.stderr)
            traceback.print_exc()
    return targets


def _build_fetcher(conn, target: dict, folder: str):
    """The connector to pull ``folder`` of one target, chosen by provider.

    Graph: a live GraphMailClient (or the file replayer when IOTA_SYNC_FROM_FILE
    is set — offline testing of the Graph path). IMAP: an ImapFetcher built from
    the source's decrypted host/username/password (read via ``conn`` just now, so
    the plaintext lives only for this pull).
    """
    if target["provider"] == "imap":
        from src.ingestion.capture import sources_store
        from src.ingestion.capture.imap_client import ImapConfig, ImapFetcher

        cfg = sources_store.get_imap_config(conn, target["source_id"])
        if not cfg:
            raise RuntimeError(
                f"IMAP source {target['source_id']} has no usable config."
            )
        return ImapFetcher(ImapConfig(**cfg), folder=folder)

    # Graph (default). The file replayer is a Graph-only offline stand-in.
    from_file = os.environ.get("IOTA_SYNC_FROM_FILE")
    if from_file:
        return _FileFetcher(from_file)
    from src.ingestion.capture.graph_client import GraphMailClient

    return GraphMailClient(folder=folder)


def _folders_to_sync(conn, target: dict) -> List[Tuple[str, str]]:
    """The (folder_id, label) list to sync for a target this cycle.

    Re-discovered every cycle so folders a user adds/removes are always reflected.
    Graph asks Microsoft; IMAP lists the account's folders over the wire. Both
    drop junk/trash/drafts inside their connector. Offline (IOTA_SYNC_FROM_FILE,
    Graph only) falls back to the single 'inbox' pseudo-folder the file replayer
    stands in for.
    """
    if target["provider"] == "imap":
        from src.ingestion.capture import sources_store
        from src.ingestion.capture.imap_client import ImapConfig, ImapFetcher

        cfg = sources_store.get_imap_config(conn, target["source_id"])
        if not cfg:
            raise RuntimeError(
                f"IMAP source {target['source_id']} has no usable config."
            )
        folders = ImapFetcher(ImapConfig(**cfg)).list_sync_folders()
        return [(f["id"], f["name"]) for f in folders]

    if os.environ.get("IOTA_SYNC_FROM_FILE"):
        return [("inbox", "Inbox")]
    from src.ingestion.capture.graph_client import GraphMailClient

    folders = GraphMailClient().list_sync_folders(target["mailbox"])
    return [(f["id"], f["name"]) for f in folders]


def _sync_all_folders(target: dict, do_process: bool) -> None:
    """Sync every (discovered) folder of one target into its tenant brain.

    A failure discovering folders, or syncing one folder, is logged and does not
    stop the other folders or targets.
    """
    try:
        with get_tenant_connection(target["db_name"]) as conn:
            folders = _folders_to_sync(conn, target)
    except Exception:  # discovery failed (bad creds, server error) — skip target
        print(
            f"[sync] ERROR discovering folders for "
            f"{target['slug']}/{target['mailbox']}:",
            file=sys.stderr,
        )
        traceback.print_exc()
        return
    for folder_id, label in folders:
        _sync_folder(target, folder_id, label, do_process)


def _sync_folder(target: dict, folder: str, label: str, do_process: bool) -> None:
    """Sync one folder of a target. Never raises — keeps the loop alive."""
    slug, mailbox, db_name = target["slug"], target["mailbox"], target["db_name"]
    try:
        with get_tenant_connection(db_name) as conn:
            fetcher = _build_fetcher(conn, target, folder)
            summary = mail.ingest_mailbox(conn, mailbox, fetcher, folder=folder)
        print(f"[sync] {slug}/{mailbox} [{label}]: {summary.as_dict()}")
        if do_process:
            _process(db_name)
    except Exception:  # keep the loop alive across a bad folder/target/cycle
        print(f"[sync] ERROR syncing {slug}/{mailbox} [{label}]:", file=sys.stderr)
        traceback.print_exc()


def _sync_once(targets: List[dict], do_process: bool) -> None:
    """One full pass over every configured target. Never raises — a failure on
    one target is logged (and recorded on its capture run) so the loop and the
    other targets keep going.

    A target's ``folder`` is ``None`` for admin-managed sources (pull ALL folders,
    discovered live) or an explicit folder for env/offline targets (pull just
    that one folder)."""
    for target in targets:
        if target["provider"] == "gdrive":
            _sync_drive(target, do_process)
        elif target["folder"] is None:
            _sync_all_folders(target, do_process)
        else:
            _sync_folder(target, target["folder"], target["folder"], do_process)


def _drive_scan_due(conn, identity: str) -> bool:
    """Whether this Drive source is due for a scan (daily gate, via capture_cursors)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_synced_at FROM capture_cursors WHERE mailbox = %s AND folder = %s;",
            (identity, _DRIVE_CURSOR),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return True
    age = (datetime.now(timezone.utc) - row[0]).total_seconds()
    return age >= _GDRIVE_SCAN_INTERVAL


def _mark_drive_scanned(conn, identity: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO capture_cursors (mailbox, folder, last_synced_at)
            VALUES (%s, %s, now())
            ON CONFLICT (mailbox, folder)
                DO UPDATE SET last_synced_at = now();
            """,
            (identity, _DRIVE_CURSOR),
        )
    conn.commit()


def _sync_drive(target: dict, do_process: bool) -> None:
    """Scan one connected Drive folder into its tenant brain — at most daily.

    Reads the whole source row (for the folder id), runs the document ingest, then
    stamps the daily gate. Never raises — keeps the loop alive. The comprehend of
    new file rows is left to ``_process`` (when IOTA_SYNC_PROCESS=1), where the
    per-workspace ``drive_comprehend_enabled`` toggle decides whether agents run.
    """
    slug, identity, db_name = target["slug"], target["mailbox"], target["db_name"]
    try:
        from src.ingestion.capture import drive_capture, sources_store

        with get_tenant_connection(db_name) as conn:
            if not _drive_scan_due(conn, identity):
                return
            source = sources_store.get_source_by_id(conn, target["source_id"])
            if not source:
                return
            summary = drive_capture.ingest_drive_source(conn, source)
            _mark_drive_scanned(conn, identity)
        print(f"[sync] {slug}/{identity} (drive): {summary.as_dict()}")
        if do_process:
            _process(db_name)
    except Exception:  # keep the loop alive across a bad Drive scan
        print(f"[sync] ERROR scanning drive {slug}/{identity}:", file=sys.stderr)
        traceback.print_exc()


def _process(db_name: str) -> None:
    """Comprehend newly-captured events into this tenant's brain (opt-in).

    The pipeline is pinned to the tenant via ``db_name``: both its brain_pages
    rows and the derived graph live in that tenant's own brain DB.
    """
    from src import config
    from src.ingestion.comprehend.pipeline import ComprehendPipeline
    from src.ingestion import runner

    config.require_llm_config()
    pipeline = ComprehendPipeline(db_name=db_name)
    with get_tenant_connection(db_name) as conn:
        ps = runner.comprehend_pending(conn, pipeline)
    print(f"[sync] {db_name}: comprehend {ps}")


def _refresh_delivery_pools() -> None:
    """Recompute each logged-in member's Delivery to-do pool, at most every
    ``_DELIVERY_INTERVAL``.

    Per-member brain inference (metered LLM), so it's gated off the pool's
    ``computed_at``: a member is recomputed only when their pool is missing or
    stale. Restricted to members who've actually logged in (``linked``) to bound
    cost. Never raises — a bad tenant/member is logged and skipped.
    """
    from src.auth import service
    from src.billing import metering
    from src.db import delivery_store, onboarding_store
    from src.ingestion import delivery
    from src.ingestion.comprehend.canonicalize import normalize_email
    from src.tenancy.provision import list_organizations

    for slug, _name, status, _region, db_name, _schema in list_organizations():
        if status != "active":
            continue
        try:
            with get_tenant_connection(db_name) as conn:
                onboarded = onboarding_store.is_onboarded(conn)
                # Emails that already have a pool = members who've used the
                # Delivery tab. We refresh those regardless of how they log in.
                pool_emails = {
                    normalize_email(e) for e, _ in delivery_store.pool_times(conn)
                } if onboarded else set()
            if not onboarded:
                continue
            org_id = service.org_id_for_slug(slug)
            # Keep an ACTIVE member's pool fresh: anyone Microsoft-linked OR who
            # already has a pool (they opened the tab — e.g. native/password
            # logins, which carry no entra_oid and were wrongly skipped before).
            members = [
                m for m in service.list_members(slug)
                if m.get("email")
                and (m.get("linked") or normalize_email(m["email"]) in pool_emails)
            ]
        except Exception:  # a bad tenant shouldn't sink delivery for the rest
            print(f"[delivery] ERROR listing members for {slug}:", file=sys.stderr)
            traceback.print_exc()
            continue

        for m in members:
            email = m["email"]
            # Attribute this member's metered inference to their org + user, so
            # the scheduled sync cost shows up in the workspace's Egress · Delivery
            # observability (the on-demand refresh endpoint sets the same context).
            org_tok = metering.set_current_org(org_id)
            usr_tok = metering.set_current_user(m.get("user_id"))
            try:
                with get_tenant_connection(db_name) as conn:
                    age = delivery_store.pool_age_seconds(conn, email)
                    if age is not None and age < _DELIVERY_INTERVAL:
                        continue  # still fresh
                    pool = delivery.compute_pool_for_user(conn, email)
                    delivery_store.upsert_pool(conn, email, pool["todos"], pool["suggestions"])
                print(
                    f"[delivery] {slug}/{email}: {len(pool['todos'])} to-do(s), "
                    f"{len(pool['suggestions'])} suggestion(s)"
                )
            except Exception:  # keep going across a bad member
                print(f"[delivery] ERROR computing pool {slug}/{email}:", file=sys.stderr)
                traceback.print_exc()
            finally:
                metering.reset_current_user(usr_tok)
                metering.reset_current_org(org_tok)


def main() -> int:
    env_raw = os.environ.get("IOTA_SYNC_TARGETS", "")
    interval = int(os.environ.get("IOTA_SYNC_INTERVAL_SECONDS", _DEFAULT_INTERVAL))
    folder = os.environ.get("IOTA_SYNC_FOLDER", "inbox")
    do_process = os.environ.get("IOTA_SYNC_PROCESS", "0") == "1"
    run_once = "--once" in sys.argv

    env_targets = _parse_targets(env_raw, folder) if env_raw.strip() else None
    if env_targets is not None:
        pairs = ", ".join(f"{t['slug']}:{t['mailbox']}" for t in env_targets)
        print(f"[sync] env targets {pairs} every {interval}s (process={do_process}).")
    else:
        print(
            f"[sync] discovering targets from capture_sources every {interval}s "
            f"(process={do_process})."
        )

    # Stop promptly on docker stop / Ctrl-C instead of mid-sleep.
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    while not stop.is_set():
        # Env targets are a fixed override; otherwise rediscover each cycle so
        # admin edits to capture_sources take effect without a restart.
        targets = env_targets if env_targets is not None else _discover_targets()
        if targets:
            _sync_once(targets, do_process)
        else:
            print("[sync] no targets this cycle — nothing to sync.")
        # Delivery pools are per-member, not per-source, so they're refreshed
        # independently of HOW sync targets are configured (env override or DB
        # discovery). Gated only on processing (LLM) being enabled, since the
        # pool is a metered brain inference.
        if do_process:
            _refresh_delivery_pools()
        if run_once:
            break
        stop.wait(interval)

    print("[sync] stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
