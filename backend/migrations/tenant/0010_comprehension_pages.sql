-- 0010_comprehension_pages.sql
-- ---------------------------------------------------------------------------
-- Anchor comprehend provenance on the brain PAGE, not just the derived graph.
--
-- A comprehend touches the brain page FIRST (the page is the source of truth),
-- then derives the entity/relationship/chunk graph from it. Until now the only
-- provenance links were comprehension_entities / comprehension_relationships —
-- i.e. links to the DERIVED rows. That has two problems:
--
--   1. It's backwards: it records what the graph sync produced, not what the
--      comprehend actually wrote first.
--   2. It's lossy: if graph sync is disabled or fails, the page is still
--      written but NO provenance is recorded, because the entity link depends
--      on the sync having produced an entity id.
--
-- This table records "captured_event (via comprehension_log) -> brain page,
-- created or updated" directly and unconditionally — the page_path and the
-- created/updated action are both known before the graph is touched, so the
-- link survives even when graph sync is off. comprehension_entities /
-- comprehension_relationships remain as the graph-side (derived) view.
--
-- One comprehend creates/updates many pages (one per entity it mentions), so
-- the link is many-to-many. ON DELETE CASCADE on both sides keeps it self-
-- cleaning: dropping a comprehension_log receipt or a brain page drops its
-- links. ON UPDATE CASCADE on page_path follows a page that is ever re-keyed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS comprehension_pages (
    comprehension_id BIGINT NOT NULL REFERENCES comprehension_log(id) ON DELETE CASCADE,
    page_path        TEXT   NOT NULL REFERENCES brain_pages(page_path)
                                ON DELETE CASCADE ON UPDATE CASCADE,
    action           TEXT   NOT NULL CHECK (action IN ('created', 'updated')),
    PRIMARY KEY (comprehension_id, page_path)
);

-- Reverse lookup: "which comprehensions touched this page?"
CREATE INDEX IF NOT EXISTS comprehension_pages_page_idx
    ON comprehension_pages (page_path);
