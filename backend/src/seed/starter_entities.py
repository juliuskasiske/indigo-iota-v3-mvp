"""Manually placed starter (anchor) entities for a tenant brain.

At onboarding an admin pre-creates a handful of the entities they already
know — the company, key people, key projects — so that when emails are later
comprehended, the references in them canonicalize onto these existing pages
instead of spawning near-duplicates. This is the manual replacement for the
old website-crawl bootstrap.

Each starter page is marked ``data["seeded"] = True`` so the Admin Center can
list exactly the anchors that were placed by hand (the comprehend pipeline's
own pages don't carry that flag).

Every function takes an explicit ``conn`` — a tenant brain connection the
caller owns — so the seed lands in the right tenant's database.
"""
from __future__ import annotations

import psycopg

from src.db import brain_pages as brain_pages_repo
from src.db.ontology import Ontology
from src.ingestion.comprehend.page import BrainPage
from src.ingestion.comprehend.pipeline import _slugify
from src.ingestion.index.graph_sync import sync_page_to_graph


def seed_entity(
    conn: psycopg.Connection,
    ontology: Ontology,
    entity_type: str,
    name: str,
    description: str | None = None,
    is_principal: bool = False,
    email: str | None = None,
) -> dict:
    """Pre-create (or annotate) one anchor brain page of ``entity_type``.

    Shaped by the ontology type's folder + attribute fields, so the anchor
    matches what the comprehend pipeline produces. Idempotent on the page path.

    ``is_principal`` marks this entity the workspace's center of gravity — the
    one everything should relate to (a company customer or a person). Exactly one
    principal exists, so setting it clears any prior one. ``email`` is stored on
    the page's frontmatter (and is what email-based entity resolution keys on for
    the principal). Either flag is applied even when the page already exists, so
    you can promote an existing anchor to principal / attach its address.

    Raises ``ValueError`` on an unknown type or a blank name.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required.")

    spec = ontology.entity_type(entity_type)
    if spec is None:
        raise ValueError(f"No such entity type: {entity_type}.")

    slug = _slugify(name)
    if not slug:
        raise ValueError("Name must contain at least one letter or number.")

    page_path = f"{spec.page_folder}/{slug}.json"
    existing = brain_pages_repo.load_page(conn, page_path)

    # Nothing new to apply to an existing page → leave it untouched (old behavior).
    if existing is not None and not is_principal and not (email and email.strip()):
        return {
            "page_path": page_path,
            "entity_type": entity_type,
            "name": name,
            "created": False,
        }

    if existing is not None:
        page = BrainPage.from_row(existing, page_path)
    else:
        page = BrainPage.create(entity_type, name, page_path, spec.fields)
        if description and description.strip():
            page.set_description(description.strip())

    if email and email.strip():
        page.set_frontmatter("email", email.strip())
    page.data["seeded"] = True
    if is_principal:
        # One center of gravity per workspace: clear the old flag first.
        brain_pages_repo.clear_principal(conn)
        page.data["is_principal"] = True

    brain_pages_repo.save_page(conn, page_path, entity_type, page.data)
    sync_page_to_graph(conn, ontology, page)

    return {
        "page_path": page_path,
        "entity_type": entity_type,
        "name": name,
        "created": existing is None,
    }


def delete_seeded_entity(conn: psycopg.Connection, page_path: str) -> bool:
    """Remove a hand-placed anchor entirely: its brain page AND its derived index.

    Wipes the entity node (entities), any relationships it's an endpoint of, and
    its vector chunks, then the page JSON. Chunks / provenance / question links
    cascade off the entity row; relationships have no cascade, so they're deleted
    explicitly first. SAFETY: only deletes pages flagged ``seeded`` — a page the
    comprehend pipeline built from email is left untouched. Returns True if a
    seeded page was found and removed. Caller owns the tenant connection.
    """
    data = brain_pages_repo.load_page(conn, page_path)
    if data is None or not (isinstance(data, dict) and data.get("seeded")):
        return False

    with conn.cursor() as cur:
        cur.execute("SELECT id FROM entities WHERE page_path = %s;", (page_path,))
        ids = [r[0] for r in cur.fetchall()]
        for eid in ids:
            cur.execute(
                "DELETE FROM relationships WHERE subject = %s OR object = %s;",
                (eid, eid),
            )
            # Cascades chunks (node_id), comprehension_entities, question_entities.
            cur.execute("DELETE FROM entities WHERE id = %s;", (eid,))
        # Belt-and-suspenders: drop any chunks keyed only by page_path.
        cur.execute("DELETE FROM chunks WHERE page_path = %s;", (page_path,))
    conn.commit()

    brain_pages_repo.delete_page(conn, page_path)
    return True


def update_starter_entity(
    conn: psycopg.Connection,
    ontology: Ontology,
    old_page_path: str,
    entity_type: str,
    name: str,
    description: str | None = None,
    is_principal: bool = False,
    email: str | None = None,
) -> dict:
    """Edit a hand-placed anchor — including changing its TYPE.

    The page is keyed by ``<type-folder>/<slug>.json``, so changing the type or
    name re-keys it to a new page. The simplest correct edit is therefore:
    remove the old anchor (page + node + edges + chunks), then seed a fresh one
    with the new fields. This is intended for onboarding fixes (before email has
    built relationships onto the entity); a re-typed anchor starts clean.

    Raises ``ValueError`` (surfaced as 400) on an unknown type or blank name, and
    if the old anchor doesn't exist / isn't a seeded page.
    """
    if not brain_pages_repo.load_page(conn, old_page_path):
        raise ValueError("That starter entity no longer exists.")
    if not delete_seeded_entity(conn, old_page_path):
        raise ValueError("That entity can't be edited (it isn't a hand-placed anchor).")
    return seed_entity(
        conn,
        ontology,
        entity_type=entity_type,
        name=name,
        description=description,
        is_principal=is_principal,
        email=email,
    )
