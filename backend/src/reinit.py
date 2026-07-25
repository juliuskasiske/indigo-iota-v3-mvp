"""Re-initialize the demo database into a known good state.

Two modes:

  precomputed  (default, cred-free)
      Apply schema, wipe all tables, then rebuild entities/relationships/chunks by
      loading the committed brain-page JSON under brain_pages/ and syncing
      each through the existing graph layer. Embeddings are computed locally
      (fastembed) so this needs NO LLM credentials. Fast and deterministic —
      use this in front of a client.

  live  (needs LLM creds + a corpus)
      Apply schema, wipe all tables and brain pages, then run the real
      comprehend pipeline over the mock corpus (corpus/), populating
      captured_events and rebuilding the brain from scratch. This is the
      "watch the brain build itself" path.

Usage:
    python -m src.reinit                 # precomputed
    python -m src.reinit --mode live
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.db.connection import get_connection
from src.db.init_db import main as apply_schema

_ALL_TABLES = "brain_pages, captured_events, questions, chunks, relationships, entities"


def _wipe_tables() -> None:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f"TRUNCATE TABLE {_ALL_TABLES} RESTART IDENTITY CASCADE;")
        conn.commit()


def _brain_page_paths(brain_dir: Path) -> list[Path]:
    return sorted(p for p in brain_dir.rglob("*.json") if p.is_file())


def reinit_precomputed() -> None:
    """Rebuild the default brain from the committed seed pages. No LLM.

    Loads the committed JSON under brain_pages/ into the brain_pages table
    (the durable store), then rebuilds entities/relationships/chunks from those
    rows. Embeddings are computed locally (fastembed), so this needs no LLM
    credentials.
    """
    # Imported here (not at top) so `--mode live` failures surface before we
    # pay the fastembed model-load cost that this path triggers.
    from src import config
    from src.ingestion.comprehend.page import BrainPage
    from src.db import brain_pages as brain_pages_repo
    from src.db import entities as entity_repo
    from src.db.ontology import load_ontology
    from src.ingestion.index.graph_sync import sync_page_to_graph

    brain_dir: Path = config.BRAIN_DIR
    seed_files = _brain_page_paths(brain_dir)
    if not seed_files:
        print(f"[reinit] no seed pages under {brain_dir} — nothing to load.")
        return

    print(f"[reinit] precomputed: applying schema + wiping tables")
    apply_schema()
    _wipe_tables()

    print(f"[reinit] loading {len(seed_files)} seed pages from {brain_dir}")
    skipped = 0
    with get_connection() as conn:
        ontology = load_ontology(conn)
        # Pass 1: store every page row and resolve its subject entity, so all
        # canonical names exist before any relationship is written. Without
        # this, a triple whose object page loads later would canonicalize
        # against an incomplete entity set and spawn an orphan.
        loaded: list[BrainPage] = []
        for path in seed_files:
            data = json.loads(path.read_text(encoding="utf-8"))
            fm = data.get("frontmatter", {})
            # Skip malformed pages (no frontmatter) rather than aborting the
            # whole rebuild — seed data files are a system boundary.
            if not fm.get("name"):
                print(f"  skipped {path.relative_to(brain_dir)} (no frontmatter)")
                skipped += 1
                continue
            rel = str(path.relative_to(brain_dir))
            page = BrainPage.from_row(data, rel)
            brain_pages_repo.save_page(conn, rel, fm["type"], data)
            entity_repo.resolve_entity(conn, fm["type"], fm["name"], rel)
            loaded.append(page)
        # Pass 2: write each page's relationships + chunks against the full set.
        for page in loaded:
            sync_page_to_graph(conn, ontology, page)
            print(f"  synced {page.page_path}")
    if skipped:
        print(f"[reinit] skipped {skipped} malformed page(s)")

    _report_counts()
    print("[reinit] precomputed reinit complete.")


def reinit_live() -> None:
    """Wipe everything and rebuild by running real comprehension over the corpus."""
    from src import config

    config.require_llm_config()  # fail loudly before doing any work

    corpus_dir = config.REPO_ROOT.parent / "corpus"
    events = sorted(corpus_dir.rglob("*.json")) if corpus_dir.exists() else []
    if not events:
        print(
            f"[reinit] live mode: no corpus found under {corpus_dir}.\n"
            "         Author mock emails/slack/files there first "
            "(milestone 3), then re-run."
        )
        return

    print("[reinit] live: applying schema + wiping tables and brain pages")
    apply_schema()
    _wipe_tables()  # also truncates brain_pages — the live run rebuilds them

    # Deferred import: pulls in the LLM-touching comprehend stack.
    from src.ingestion.comprehend.pipeline import ComprehendPipeline
    from src.ingestion.triage.classify import classify
    from src.ingestion.triage import scope_store

    from datetime import date as date_cls

    # Load this database's admin-editable scope definitions once (seeds from
    # classification.yaml on first use), so the gate uses the same store the
    # Admin Center edits — not a hardcoded file.
    with get_connection() as conn:
        scope_defs = scope_store.get_definitions(conn)

    pipeline = ComprehendPipeline()
    today = date_cls.today().isoformat()
    print(f"[reinit] running comprehension over {len(events)} corpus events")
    included = excluded = 0
    for path in events:
        # NOTE: corpus event schema + captured_events ingestion land with the
        # connector layer (milestone 2). For now this is the wiring point —
        # and the scope gate that every connector will share. Classify BEFORE
        # anything is captured, comprehended or embedded; drop excluded events
        # leaving a content-free audit line (GDPR transparency).
        text = path.read_text(encoding="utf-8")
        decision = classify(text, scope_defs)
        if not decision.include:
            excluded += 1
            print(f"  EXCLUDED {path.name}: {decision.reason}")
            continue
        included += 1
        pipeline.process_text(text, today, label=f"corpus: {path.name}")

    print(f"[reinit] scope gate: {included} included, {excluded} excluded")
    _report_counts()
    print("[reinit] live reinit complete.")


def _report_counts() -> None:
    with get_connection() as conn, conn.cursor() as cur:
        counts = {}
        for table in ("entities", "relationships", "chunks", "captured_events", "questions"):
            cur.execute(f"SELECT count(*) FROM {table};")
            counts[table] = cur.fetchone()[0]
    summary = "  ".join(f"{t}={n}" for t, n in counts.items())
    print(f"[reinit] counts: {summary}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-initialize the demo DB.")
    parser.add_argument(
        "--mode",
        choices=("precomputed", "live"),
        default="precomputed",
        help="precomputed (cred-free, from brain pages) or live (runs comprehension)",
    )
    args = parser.parse_args()

    if args.mode == "precomputed":
        reinit_precomputed()
    else:
        reinit_live()


if __name__ == "__main__":
    sys.exit(main())
