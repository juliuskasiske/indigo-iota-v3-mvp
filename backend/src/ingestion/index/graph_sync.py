"""Sync a BrainPage to the graph: write its entity, relationships, and chunks.

Relationships are no longer DERIVED here. They used to be emitted mechanically
from typed frontmatter fields against a hardcoded predicate vocabulary; now the
RelationshipAgent picks them per subject from the tenant's ontology and stores
them on the page (page.relationships). This module reads that explicit list,
canonicalizes each object onto an existing entity, and writes the validated
triple — so a cred-free rebuild (reinit) reconstructs the graph straight from
the committed pages, with the page still the source of truth.
"""
from __future__ import annotations

import psycopg

from src.ingestion.comprehend.page import BrainPage
from src.ingestion.comprehend.canonicalize import canonicalize_or_keep
from src.db import entities as entity_repo
from src.db import relationships as relationship_repo
from src.db.ontology import Ontology


def sync_page_to_graph(
    conn: psycopg.Connection, ontology: Ontology, page: BrainPage
) -> tuple[int | None, list[int]]:
    """Resolve this page's subject entity, write its relationships, index chunks.

    Returns ``(subject_id, relationship_ids)`` so the caller can record which
    entity and relationships this page touched. ``subject_id`` is None (with an
    empty list) when the page has no usable type/name anchor.

    Relationships are additive and idempotent on the triple (the repo dedupes),
    so re-syncing a page never duplicates rows; the page's current
    ``relationships`` list is the set written.
    """
    fm = page.data["frontmatter"]
    etype = fm.get("type")
    name = fm.get("name")
    if not etype or not name:
        return None, []

    rel_path = page.page_path

    # Resolve (find or create) the page's own subject, and make sure its
    # page_path is set even if it already existed without one (because it was
    # first referenced as a relationship endpoint from another page).
    subject_id = entity_repo.resolve_entity(conn, etype, name, rel_path)
    entity_repo.update_entity_page_path(conn, subject_id, rel_path)

    rel_ids = _write_relationships(conn, ontology, page, subject_id, etype, rel_path)
    _sync_chunks(conn, page, rel_path, subject_id)
    return subject_id, rel_ids


# Max distinct predicates kept per (subject, object) pair. Open inference can
# propose several near-equivalent links; normalization collapses synonyms and
# this caps what survives, so a pair never accumulates a sprawl of predicates.
_MAX_PREDICATES_PER_PAIR = 3


def _pair_predicates(
    conn: psycopg.Connection, subject_id: int, object_id: int
) -> set[str]:
    """Distinct predicates already stored for this (subject, object) pair."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT predicate FROM relationships "
            "WHERE subject = %s AND object = %s;",
            (subject_id, object_id),
        )
        return {r[0] for r in cur.fetchall()}


def _write_relationships(
    conn: psycopg.Connection,
    ontology: Ontology,
    page: BrainPage,
    subject_id: int,
    subject_type: str,
    source_page: str,
) -> list[int]:
    """Write the page's stored outgoing triples (open predicates). Each object
    name is canonicalized onto an existing entity so 'Acme GmbH' collapses onto
    'Acme' rather than spawning an orphan. Distinct predicates per (subject,
    object) pair are capped at ``_MAX_PREDICATES_PER_PAIR`` — durably, against
    what the pair already holds, so the cap survives across re-syncs. Returns the
    relationship ids written (or reused)."""
    rel_ids: list[int] = []
    pair_preds: dict[int, set[str]] = {}
    for triple in page.relationships():
        predicate = triple.get("predicate")
        obj_name = triple.get("object")
        obj_type = triple.get("object_type")
        if not predicate or not obj_name or not obj_type:
            continue
        object_id = _resolve_canonical(conn, obj_type, obj_name)
        existing = pair_preds.get(object_id)
        if existing is None:
            existing = _pair_predicates(conn, subject_id, object_id)
            pair_preds[object_id] = existing
        # Re-asserting a predicate the pair already has is idempotent (allowed);
        # a NEW predicate beyond the cap is dropped.
        if predicate not in existing and len(existing) >= _MAX_PREDICATES_PER_PAIR:
            continue
        rid = write_relationship(
            conn, ontology, subject_id, subject_type,
            predicate, object_id, obj_type, source_page,
        )
        if rid is not None:
            rel_ids.append(rid)
            existing.add(predicate)
    return rel_ids


def write_relationship(
    conn: psycopg.Connection,
    ontology: Ontology,
    subject_id: int,
    subject_type: str,
    predicate: str,
    object_id: int,
    object_type: str,
    source_page: str | None,
) -> int | None:
    """Write one triple. Returns its id, or None if it can't be written.

    Predicates are OPEN — inferred freely by the comprehend agent and normalized
    onto the tenant's canonical vocabulary upstream — so there is no ontology
    domain/range gate here; any grounded (subject, predicate, object) is stored.
    ``ontology``/``subject_type``/``object_type`` are kept for signature
    compatibility with existing callers. Idempotent on the triple via the repo.
    """
    if not predicate or object_id is None:
        return None
    return relationship_repo.add_relationship(
        conn, subject_id, predicate, object_id, source_page
    )


def _resolve_canonical(
    conn: psycopg.Connection, entity_type: str, raw_name: str
) -> int:
    """Canonicalize `raw_name` against existing entities of `entity_type`,
    then resolve_entity on the result.

    Stops 'Acme GmbH' from spawning an orphan when an
    'Acme' entity already exists; stops 'Felix' (mentioned in
    an email's body) from spawning an orphan when a 'Dr Felix Kasiske'
    entity has its own brain page.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM entities WHERE type = %s;", (entity_type,))
        known = [row[0] for row in cur.fetchall()]
    canonical = canonicalize_or_keep(raw_name, known)
    return entity_repo.resolve_entity(conn, entity_type, canonical)


def _sync_chunks(
    conn: psycopg.Connection, page: BrainPage, rel_path: str, subject_id: int
) -> None:
    """Compute chunks for this page, embed them, replace the page's rows
    in the chunks table. Lazy-imports fastembed-touching modules so the
    rest of the system doesn't pay the embedding-model import cost on
    every startup."""
    from src.ingestion.index import embeddings
    from src.db import chunks as chunks_repo
    from src.ingestion.index.chunker import chunk_page

    raw = chunk_page(page)
    chunks_repo.delete_chunks_for_page(conn, rel_path)
    if not raw:
        return
    vectors = embeddings.embed([c["text"] for c in raw])
    rows = [
        {**c, "page_path": rel_path, "entity_id": subject_id, "embedding": v}
        for c, v in zip(raw, vectors)
    ]
    chunks_repo.insert_chunks(conn, rows)
