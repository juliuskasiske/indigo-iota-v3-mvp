"""Repository for the customer-defined ontology — the entity and relationship
vocabulary a tenant configures (tables created in migration 0008).

Until 0008 these were hardcoded in the agents; now the comprehend layer reads
them from the tenant's own brain DB so each customer defines what kinds of thing
they track and how those things connect. The descriptions stored here are not
documentation — the agents feed them to the LLM to drive detection.

Every function takes an explicit ``conn`` (a brain connection the caller owns),
so the ontology always comes from the right tenant.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field

import psycopg

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass
class FieldSpec:
    """One structured attribute a type carries. The page JSON holds the value;
    this is the spec the AttributeAgent extracts against."""
    field_key: str
    label: str
    description: str
    is_list: bool = False


@dataclass
class EntityTypeSpec:
    key: str
    label: str
    description: str
    page_folder: str
    fields: list[FieldSpec] = field(default_factory=list)


@dataclass
class RelationshipTypeSpec:
    key: str
    label: str
    description: str
    subject_type: str | None       # None = connects any type
    object_type: str | None


@dataclass
class Ontology:
    """The whole tenant ontology, loaded once per comprehend run."""
    entity_types: list[EntityTypeSpec]
    relationship_types: list[RelationshipTypeSpec]

    def entity_type(self, key: str) -> EntityTypeSpec | None:
        return next((t for t in self.entity_types if t.key == key), None)

    def relationship_type(self, key: str) -> RelationshipTypeSpec | None:
        return next((r for r in self.relationship_types if r.key == key), None)

    @property
    def entity_type_keys(self) -> list[str]:
        return [t.key for t in self.entity_types]

    def page_folder(self, key: str) -> str | None:
        t = self.entity_type(key)
        return t.page_folder if t else None


def get_entity_types(conn: psycopg.Connection) -> list[EntityTypeSpec]:
    """All entity types with their field specs, in admin-defined order."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, label, description, page_folder "
            "FROM entity_types ORDER BY position, key;"
        )
        types = [
            EntityTypeSpec(key=r[0], label=r[1], description=r[2], page_folder=r[3])
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT entity_type, field_key, label, description, is_list "
            "FROM entity_type_fields ORDER BY entity_type, position, field_key;"
        )
        by_type: dict[str, list[FieldSpec]] = {}
        for et, fk, label, desc, is_list in cur.fetchall():
            by_type.setdefault(et, []).append(
                FieldSpec(field_key=fk, label=label, description=desc, is_list=is_list)
            )
    for t in types:
        t.fields = by_type.get(t.key, [])
    return types


def get_relationship_types(conn: psycopg.Connection) -> list[RelationshipTypeSpec]:
    """All relationship types with their domain/range, in admin-defined order."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, label, description, subject_type, object_type "
            "FROM relationship_types ORDER BY position, key;"
        )
        return [
            RelationshipTypeSpec(
                key=r[0], label=r[1], description=r[2],
                subject_type=r[3], object_type=r[4],
            )
            for r in cur.fetchall()
        ]


def load_ontology(conn: psycopg.Connection) -> Ontology:
    """Load the whole tenant ontology in one shot (entity + relationship types)."""
    return Ontology(
        entity_types=get_entity_types(conn),
        relationship_types=get_relationship_types(conn),
    )


def _check_key(kind: str, key: str) -> None:
    if not _KEY_RE.match(key or ""):
        raise ValueError(
            f"{kind} key {key!r} must be lowercase letters, digits or underscores, "
            "starting with a letter."
        )


def save_ontology(
    conn: psycopg.Connection,
    entity_types: list[EntityTypeSpec],
    relationship_types: list[RelationshipTypeSpec],
    *,
    actor: str = "admin",
) -> None:
    """Reconcile the tenant ontology to EXACTLY the given types (full replace).

    Upserts every supplied type (list order becomes ``position``), rewrites each
    type's field specs, then deletes any type no longer present. Deleting a type
    that existing brain data still uses raises a foreign-key error
    (``entities.type`` / ``relationships.predicate`` are ON DELETE RESTRICT) — the
    caller turns that into a 409. This is meant for onboarding, before any data
    exists, where a full replace is free; afterwards it still works but can only
    drop unused types.

    Whole thing runs in one transaction: on any error nothing is committed.
    """
    et_keys = [t.key for t in entity_types]
    if len(set(et_keys)) != len(et_keys):
        raise ValueError("duplicate entity type keys.")
    incoming = set(et_keys)
    for t in entity_types:
        _check_key("entity type", t.key)
        if not (t.label or "").strip():
            raise ValueError(f"entity type {t.key!r} needs a label.")
        if not (t.page_folder or "").strip():
            raise ValueError(f"entity type {t.key!r} needs a page folder.")
        for f in t.fields:
            _check_key("field", f.field_key)

    rt_keys = [r.key for r in relationship_types]
    if len(set(rt_keys)) != len(rt_keys):
        raise ValueError("duplicate relationship type keys.")
    for r in relationship_types:
        _check_key("relationship type", r.key)
        if not (r.label or "").strip():
            raise ValueError(f"relationship type {r.key!r} needs a label.")
        for endpoint in (r.subject_type, r.object_type):
            if endpoint is not None and endpoint not in incoming:
                raise ValueError(
                    f"relationship type {r.key!r} points at unknown entity type "
                    f"{endpoint!r}."
                )

    with conn.cursor() as cur:
        for i, t in enumerate(entity_types, start=1):
            cur.execute(
                """
                INSERT INTO entity_types
                    (key, label, description, page_folder, position, updated_at, updated_by)
                VALUES (%s, %s, %s, %s, %s, now(), %s)
                ON CONFLICT (key) DO UPDATE SET
                    label       = EXCLUDED.label,
                    description = EXCLUDED.description,
                    page_folder = EXCLUDED.page_folder,
                    position    = EXCLUDED.position,
                    updated_at  = now(),
                    updated_by  = EXCLUDED.updated_by;
                """,
                (t.key, t.label, t.description, t.page_folder, i, actor),
            )
            cur.execute(
                "DELETE FROM entity_type_fields WHERE entity_type = %s;", (t.key,)
            )
            for j, f in enumerate(t.fields, start=1):
                cur.execute(
                    """
                    INSERT INTO entity_type_fields
                        (entity_type, field_key, label, description, is_list, position)
                    VALUES (%s, %s, %s, %s, %s, %s);
                    """,
                    (t.key, f.field_key, f.label, f.description, f.is_list, j),
                )

        for i, r in enumerate(relationship_types, start=1):
            cur.execute(
                """
                INSERT INTO relationship_types
                    (key, label, description, subject_type, object_type, position, updated_at, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, now(), %s)
                ON CONFLICT (key) DO UPDATE SET
                    label        = EXCLUDED.label,
                    description  = EXCLUDED.description,
                    subject_type = EXCLUDED.subject_type,
                    object_type  = EXCLUDED.object_type,
                    position     = EXCLUDED.position,
                    updated_at   = now(),
                    updated_by   = EXCLUDED.updated_by;
                """,
                (r.key, r.label, r.description, r.subject_type, r.object_type, i, actor),
            )

        # Remove rel types first (they only reference kept entity types now), then
        # the entity types the admin dropped. An in-use entity/predicate trips the
        # ON DELETE RESTRICT foreign key — surfaced upstream as a 409.
        if rt_keys:
            cur.execute("DELETE FROM relationship_types WHERE key <> ALL(%s);", (rt_keys,))
        else:
            cur.execute("DELETE FROM relationship_types;")
        if et_keys:
            cur.execute("DELETE FROM entity_types WHERE key <> ALL(%s);", (et_keys,))
        else:
            cur.execute("DELETE FROM entity_types;")
    conn.commit()
