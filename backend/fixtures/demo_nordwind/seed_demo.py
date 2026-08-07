"""Load the Nordwind Analytics demo corpus into a tenant brain.

This is the offline stand-in for the Admin Center's Activate step: instead of
pulling a window of history from Microsoft Graph or IMAP, it replays the invented
corpus in ``emails.py`` / ``documents/`` through exactly the same code path the
real connector uses —

    capture (normalize)  ->  triage (the tenant's own scope gate)
        ->  captured_events  ->  comprehend (LLM agents)  ->  index (graph + chunks)

so the brain it produces is a real one, not a fixture pasted into tables. Emails
go through ``mail.backfill_mailbox`` (the historical path, which has no
forward-only floor, so back-dated demo mail is kept). Documents go through the
Drive capture helpers: stored as ``source='file'`` captured_events and chunked
with the local embedder.

Usage (from backend/, with the venv active):

    python -m fixtures.demo_nordwind.seed_demo --slug nordwind             # capture only
    python -m fixtures.demo_nordwind.seed_demo --slug nordwind --comprehend
    python -m fixtures.demo_nordwind.seed_demo --slug nordwind --classify-only

``--classify-only`` runs the scope gate and prints the bucket for every message
without writing anything — use it after editing the scope anchors in the Admin
Center to check the corpus still lands in scope.

Comprehension spends real LLM credits against the org's balance, exactly as a
customer backfill would.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from src.db.connection import get_tenant_connection
from src.ingestion.capture import mail, normalize
from src.ingestion.triage import classify, scope_store
from src.tenancy.provision import tenant_db_name

from fixtures.demo_nordwind.emails import EMAILS, MAILBOX

DOCS_DIR = Path(__file__).resolve().parent / "documents"

# The folder identity documents are captured under, standing in for a connected
# Google Drive folder. Keeps document capture_runs attributable and re-runnable.
DRIVE_IDENTITY = "demo-drive:nordwind-sales"


# --- corpus -> normalized events --------------------------------------------

_ADDR_RE = re.compile(r"^\s*(?:(?P<name>.*?)\s*<)?(?P<addr>[^<>\s]+@[^<>\s]+?)>?\s*$")


def _split(entry: str) -> tuple[str | None, str]:
    """'Lena Brandt <lena@x.de>' -> ('Lena Brandt', 'lena@x.de')."""
    m = _ADDR_RE.match(entry)
    if not m:
        return None, entry.strip()
    return (m.group("name") or None), m.group("addr")


def _event(spec: dict) -> normalize.NormalizedCapturedEvent:
    sender_name, sender = _split(spec["frm"])
    to = [_split(t)[1] for t in spec.get("to", [])]
    cc = [_split(c)[1] for c in spec.get("cc", [])]
    return normalize.NormalizedCapturedEvent(
        source=normalize.SOURCE_EMAIL,
        external_id=spec["id"],
        thread_id=spec.get("thread"),
        occurred_at=datetime.fromisoformat(spec["date"].replace("Z", "+00:00")),
        sender=sender,
        sender_name=sender_name,
        participants=[a for a in ([sender] + to + cc) if a],
        recipients_to=to,
        recipients_cc=cc,
        subject=spec["subject"],
        body_text=spec["body"],
        attachments=[],
        raw={"demo": True, "id": spec["id"], "thread": spec.get("thread")},
    )


def _documents() -> list[tuple[dict, str]]:
    """(file_meta, markdown) for every document in documents/, sorted by name."""
    out = []
    for path in sorted(DOCS_DIR.glob("*.md")):
        stat = path.stat()
        modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        out.append((
            {
                "id": "demo-doc-" + path.stem.lower().replace(" ", "-"),
                "name": path.name,
                "mimeType": "text/markdown",
                "modifiedTime": modified.isoformat().replace("+00:00", "Z"),
                "web_view_link": None,
                "path": f"/Nordwind Sales/{path.name}",
            },
            path.read_text(encoding="utf-8"),
        ))
    return out


# --- the three modes ---------------------------------------------------------

def classify_only(db_name: str) -> int:
    """Print the scope decision for every email. Writes nothing."""
    with get_tenant_connection(db_name) as conn:
        scope_store.seed_if_empty(conn)
        defs = scope_store.get_definitions(conn)
    included = 0
    for spec in EMAILS:
        ev = _event(spec)
        d = classify.classify(ev.classify_text, defs)
        included += bool(d.include)
        top = " ".join(f"{k}={v:.3f}" for k, v in sorted(d.scores.items()))
        print(f"  {'IN ' if d.include else 'OUT'}  {d.bucket:<13} {spec['id']}  "
              f"{spec['subject'][:58]:<58}  {top}")
    print(f"\n[classify] {included}/{len(EMAILS)} in scope.")
    return 0 if included else 1


def capture(db_name: str) -> None:
    """Run the corpus through the scope gate into captured_events."""
    events = [_event(spec) for spec in EMAILS]
    with get_tenant_connection(db_name) as conn:
        scope_store.seed_if_empty(conn)
        summary = mail.backfill_mailbox(conn, MAILBOX, events)
        print(f"[capture] emails: {summary.as_dict()}")

        # Documents: same storage + chunking the Drive connector uses.
        from src.ingestion.capture import drive_capture

        run_id = drive_capture._start_run(conn, DRIVE_IDENTITY)
        added = 0
        for meta, markdown in _documents():
            drive_capture._delete_file_artifacts(conn, meta["id"])  # replace on re-run
            drive_capture._insert_event(conn, run_id, meta, markdown)
            drive_capture._index_document(conn, meta, markdown)
            conn.commit()
            added += 1
            print(f"[capture] document: {meta['name']}")
        summary_docs = drive_capture.DriveSummary(
            run_id=run_id, folder=DRIVE_IDENTITY, listed=added, added=added
        )
        drive_capture._finish_run(conn, summary_docs, None)
        print(f"[capture] documents: {summary_docs.as_dict()}")


def comprehend(db_name: str, limit: int | None) -> None:
    """Comprehend + index everything captured but not yet processed."""
    from src import config
    from src.ingestion import runner
    from src.ingestion.comprehend import settings_store
    from src.ingestion.comprehend.pipeline import ComprehendPipeline

    config.require_llm_config()
    with get_tenant_connection(db_name) as conn:
        # Documents are comprehended into the graph only when the workspace has
        # opted in; the demo wants them in the graph, so turn it on.
        settings_store.update_settings(conn, drive_comprehend_enabled=True)
        conn.commit()

    pipeline = ComprehendPipeline(db_name=db_name)
    with get_tenant_connection(db_name) as conn:
        summary = runner.comprehend_pending(conn, pipeline, limit=limit)
    print(f"[comprehend] {summary}")


def main() -> int:
    p = argparse.ArgumentParser(description="Seed the Nordwind demo corpus.")
    p.add_argument("--slug", default="nordwind", help="Tenant slug (default: nordwind).")
    p.add_argument("--comprehend", action="store_true",
                   help="After capture, run comprehension (spends LLM credits).")
    p.add_argument("--comprehend-only", action="store_true",
                   help="Skip capture; comprehend whatever is already captured.")
    p.add_argument("--classify-only", action="store_true",
                   help="Print each email's scope bucket and exit. Writes nothing.")
    p.add_argument("--limit", type=int, default=None,
                   help="Comprehend at most N captured events.")
    args = p.parse_args()

    db_name = tenant_db_name(args.slug)
    print(f"[seed] tenant '{args.slug}' -> database {db_name}")

    if args.classify_only:
        return classify_only(db_name)
    if not args.comprehend_only:
        capture(db_name)
    if args.comprehend or args.comprehend_only:
        comprehend(db_name, args.limit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
