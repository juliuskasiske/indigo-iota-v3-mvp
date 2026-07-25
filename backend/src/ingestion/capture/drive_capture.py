"""Google Drive document ingestion (Phase 2): walk one connected folder, convert
each file to Markdown, store it, and chunk it for retrieval.

Why this is its own orchestrator (not mail.ingest_mailbox):
  * NO scope gate — every supported file in the folder is ingested (the folder is
    the curation).
  * "list cheap → download only new/changed" — the recursive listing is metadata
    only; content is fetched (and MarkItDown-converted) just for files that are new
    or whose Drive ``modifiedTime`` moved since we last captured them.
  * replace-on-change + delete handling — an edited file's old artifacts (event,
    document page, entity node, chunks) are removed before re-ingest; a file removed
    from the folder is cleaned up on the next scan.
  * document chunking happens HERE — local embeddings (no LLM credits), so a doc is
    searchable the moment it's scanned. The metered agent enrichment is the runner's
    separate, opt-in job (gated by the per-workspace ``drive_comprehend_enabled``).

Documents live ONLY as embedded chunks (``page_path = documents/<fileId>.json``,
``entity_id = NULL``) — never as graph/entity nodes. The chunks are their own
references: Q&A cites them by filename (the chunk text is prefixed with the name)
and links out to Drive via the captured_event's stored webViewLink.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from src.db import chunks as chunks_repo
from src.ingestion.capture import gdrive_client
from src.ingestion.index import chunker, embeddings


@dataclass
class DriveSummary:
    run_id: int
    folder: str
    listed: int = 0
    added: int = 0
    changed: int = 0
    removed: int = 0
    skipped: int = 0

    def as_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "folder": self.folder,
            "listed": self.listed,
            "added": self.added,
            "changed": self.changed,
            "removed": self.removed,
            "skipped": self.skipped,
        }


def _doc_page_path(file_id: str) -> str:
    return f"documents/{file_id}.json"


def _parse_dt(value):
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


# --- capture_runs bookkeeping (files) --------------------------------------------

def _start_run(conn: psycopg.Connection, folder: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO capture_runs (source, mailbox) VALUES ('file', %s) RETURNING id;",
            (folder,),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def _finish_run(conn: psycopg.Connection, s: DriveSummary, error: str | None) -> None:
    # Map the file tallies onto the capture_runs columns: fetched = files listed,
    # included = added + changed, removed = deletions.
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE capture_runs
               SET finished_at = now(), fetched = %s, included = %s,
                   removed = %s, error = %s
             WHERE id = %s;
            """,
            (s.listed, s.added + s.changed, s.removed, error, s.run_id),
        )
    conn.commit()


# --- per-source known state (for change + delete detection) ----------------------

def _known_files(conn: psycopg.Connection, folder_identity: str) -> dict[str, str]:
    """``{fileId: last modifiedTime}`` for files already captured under THIS folder.

    Scoped to the folder via the capture_run that captured each event (cr.mailbox =
    the gdrive source identity), so deletions for one folder never touch another's.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ce.external_id, ce.raw->>'modifiedTime'
            FROM captured_events ce
            JOIN capture_runs cr ON cr.id = ce.capture_run_id
            WHERE ce.source = 'file' AND cr.mailbox = %s
              AND ce.external_id IS NOT NULL;
            """,
            (folder_identity,),
        )
        return {r[0]: (r[1] or "") for r in cur.fetchall()}


def _delete_file_artifacts(conn: psycopg.Connection, file_id: str) -> None:
    """Remove everything we derived from a Drive file: its content chunks and its
    captured_event. Documents live ONLY as chunks (never as graph/entity nodes), so
    there is nothing in entities/relationships to clean up.
    """
    page_path = _doc_page_path(file_id)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM chunks WHERE page_path = %s;", (page_path,))
        cur.execute(
            "DELETE FROM captured_events WHERE source = 'file' AND external_id = %s;",
            (file_id,),
        )
    conn.commit()


# --- ingest one file -------------------------------------------------------------

def _insert_event(
    conn: psycopg.Connection, run_id: int, file_meta: dict, markdown: str
) -> None:
    """Store the file as a captured_events row (source='file'). Idempotent on
    (source, external_id) — a changed file is deleted first, so this is an insert."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO captured_events
                (source, external_id, occurred_at, subject, body_text, raw, capture_run_id)
            VALUES ('file', %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
                DO NOTHING;
            """,
            (
                file_meta["id"],
                _parse_dt(file_meta.get("modifiedTime")),
                file_meta.get("name") or file_meta["id"],
                markdown,
                Jsonb(
                    {
                        "mimeType": file_meta.get("mimeType"),
                        "modifiedTime": file_meta.get("modifiedTime"),
                        "webViewLink": file_meta.get("web_view_link"),
                        "path": file_meta.get("path"),
                    }
                ),
                run_id,
            ),
        )
    conn.commit()


def _index_document(conn: psycopg.Connection, file_meta: dict, markdown: str) -> None:
    """Make the document searchable as content chunks — and nothing else.

    Documents are deliberately NOT entities in the graph (no brain page, no entity
    node): they only ever exist as embedded chunks, which serve as their own
    references in Q&A. Each chunk carries ``page_path = documents/<fileId>.json`` and
    ``entity_id = NULL``; retrieval cites it by filename (the chunk text is prefixed
    with the name) and links out to Drive via the captured_event's stored webViewLink.

    Chunks are embedded with the LOCAL embedder (no LLM credits), so the document is
    retrievable the moment it's scanned, even at zero credits.
    """
    page_path = _doc_page_path(file_meta["id"])
    name = file_meta.get("name") or file_meta["id"]

    raw_chunks = chunker.chunk_document(name, markdown)
    chunks_repo.delete_chunks_for_page(conn, page_path)  # replace on re-ingest
    if raw_chunks:
        vectors = embeddings.embed([c["text"] for c in raw_chunks])
        rows = [
            {**c, "page_path": page_path, "entity_id": None, "embedding": v}
            for c, v in zip(raw_chunks, vectors)
        ]
        chunks_repo.insert_chunks(conn, rows)


# --- top-level: scan one connected folder ----------------------------------------

def ingest_drive_source(conn: psycopg.Connection, source: dict) -> DriveSummary:
    """Scan one connected Drive folder: ingest new/changed files, drop deleted ones.

    ``source`` is a row from sources_store (provider='gdrive') with ``mailbox`` (the
    identity ``gdrive:<id>``) and ``gdrive_folder_id``. Leaves each captured file's
    ``processed_at`` NULL so the runner can (optionally) comprehend it later.
    """
    folder_id = source.get("gdrive_folder_id")
    identity = source["mailbox"]
    if not folder_id:
        raise RuntimeError(f"gdrive source {identity} has no folder id.")

    run_id = _start_run(conn, identity)
    summary = DriveSummary(run_id=run_id, folder=identity)
    error: str | None = None
    try:
        files = gdrive_client.list_tree(folder_id)
        summary.listed = len(files)
        known = _known_files(conn, identity)
        present: set[str] = set()

        for f in files:
            fid = f["id"]
            present.add(fid)
            prev = known.get(fid)
            mtime = f.get("modifiedTime") or ""
            if prev is not None and mtime <= prev:
                summary.skipped += 1
                continue  # unchanged
            markdown = gdrive_client.fetch_markdown(f)
            if not markdown.strip():
                summary.skipped += 1
                continue  # unsupported / empty / oversize / unreadable
            if prev is not None:
                _delete_file_artifacts(conn, fid)  # replace on change
                summary.changed += 1
            else:
                summary.added += 1
            _insert_event(conn, run_id, f, markdown)
            _index_document(conn, f, markdown)

        # Deletions: files we had under this folder that are no longer present.
        for gone in set(known) - present:
            _delete_file_artifacts(conn, gone)
            summary.removed += 1

    except Exception as exc:
        error = repr(exc)
        _finish_run(conn, summary, error)
        raise
    _finish_run(conn, summary, error)
    return summary
