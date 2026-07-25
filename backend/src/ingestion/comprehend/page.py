# src/ingestion/comprehend/page.py
"""The BrainPage class: build, hold, and modify one brain page (JSON).

A BrainPage is a pure in-memory object: the page ``data`` plus its identity
(``page_path`` — the relative key like 'persons/felix-kasiske.json' — and
``entity_type``). Persistence lives in ``src.db.brain_pages``: the page is
stored as a row in the tenant's brain DB, not a file on disk, so it survives a
container redeploy and is shared across the api/sync services. Callers load via
``brain_pages.load_page`` and save via ``brain_pages.save_page``.
"""
from __future__ import annotations
from typing import Sequence

from src.db.ontology import FieldSpec


def _blank_page(entity_type: str, name: str, fields: Sequence[FieldSpec]) -> dict:
    """A fresh page shaped by the entity type's field spec.

    Every page is {frontmatter, description, timeline, relationships}.
    Frontmatter always carries `type`, `name`, and `tags`; the type's configured
    attribute fields are added as empty slots ([] for list fields, null
    otherwise) for the AttributeAgent to fill. `relationships` holds this
    subject's outgoing triples (predicate + object), as picked by the
    RelationshipAgent — the page is the source of truth the graph is synced from.
    """
    frontmatter: dict = {"type": entity_type, "name": name}
    for f in fields:
        frontmatter[f.field_key] = [] if f.is_list else None
    frontmatter["tags"] = []
    return {
        "frontmatter": frontmatter,
        "description": "",
        "timeline": [],
        "relationships": [],
    }


class BrainPage:
    """One brain page held in memory. ``page_path`` is its storage key (the
    relative path string, e.g. 'persons/felix-kasiske.json') and ``entity_type``
    its ontology type. Persisted via the ``src.db.brain_pages`` repo."""

    def __init__(self, data: dict, page_path: str, entity_type: str):
        self.data = data
        self.page_path = page_path
        self.entity_type = entity_type

    @classmethod
    def create(
        cls, entity_type: str, name: str, page_path: str,
        fields: Sequence[FieldSpec] = (),
    ) -> "BrainPage":
        """Build a fresh page for ``entity_type``, shaped by its field spec."""
        return cls(_blank_page(entity_type, name, fields), page_path, entity_type)

    @classmethod
    def from_row(cls, data: dict, page_path: str) -> "BrainPage":
        """Wrap a page loaded from storage. The type is read from frontmatter."""
        entity_type = (data.get("frontmatter") or {}).get("type") or ""
        return cls(data, page_path, entity_type)

    def set_frontmatter(self, field: str, value) -> None:
        """Set one frontmatter field, but never overwrite a real value with null."""
        if value is not None:
            self.data["frontmatter"][field] = value

    def set_description(self, text: str) -> None:
        self.data["description"] = text

    def relationships(self) -> list[dict]:
        """This subject's outgoing triples; [] for pages that predate the field."""
        return self.data.get("relationships", [])

    def set_relationships(self, triples: list[dict]) -> None:
        """Replace this subject's outgoing relationships (predicate + object)."""
        self.data["relationships"] = triples

    def append_timeline(self, date: str, entry: str, source: str | None = None) -> None:
        """Add a dated timeline entry, skipping exact duplicates.

        ``source`` tags the entry's provenance (e.g. ``"delivery"`` for a
        self-reported task completion) so it's distinguishable from facts
        observed in email/documents. Omit for observed events (the default)."""
        new = {"date": date, "entry": entry}
        if source:
            new["source"] = source
        if new not in self.data["timeline"]:
            self.data["timeline"].append(new)
            self.data["timeline"].sort(key=lambda e: e["date"])
