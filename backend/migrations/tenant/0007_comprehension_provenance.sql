-- 0007_comprehension_provenance.sql
-- ---------------------------------------------------------------------------
-- Close the provenance gap in the brain, in two places.
--
-- 1. captured_events -> capture_runs. A captured event never recorded WHICH
--    sweep first pulled it in. Add capture_run_id so "what did run #N capture"
--    is a plain query. Capture dedups on (source, external_id) ON CONFLICT DO
--    NOTHING, so this column is the run that FIRST captured the event; later
--    runs that re-see it count it as a duplicate and never touch the row.
--    ON DELETE SET NULL: pruning a run record must never delete content.
--
-- 2. comprehension_log -> the specific entities + relationships it wrote.
--    comprehension_log is 1:1 with a captured_event and already records HOW
--    MANY entities an email produced, but not WHICH ones — so "show every
--    entity/relationship this email touched" wasn't answerable. One comprehend
--    creates/updates many entities and relationships, so the link is
--    many-to-many: two junction tables.
--
--    Entity links are stable (entities are never deleted in normal operation).
--    Relationship rows, however, are wiped-and-rewritten per brain page on each
--    re-sync (see index/graph_sync.delete_relationships_for_page), so a
--    relationship's id is recreated whenever a LATER email re-syncs the same
--    page. ON DELETE CASCADE means an older comprehension's relationship links
--    fall away as the relationship gets re-attributed to whichever comprehension
--    most recently wrote it. The link therefore means "the relationships this
--    comprehension wrote, as they stand now" — coherent and self-cleaning.
-- ---------------------------------------------------------------------------

-- 1. captured_events -> capture_runs ----------------------------------------
ALTER TABLE captured_events
    ADD COLUMN IF NOT EXISTS capture_run_id INTEGER
        REFERENCES capture_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS captured_events_run_idx
    ON captured_events (capture_run_id);

-- 2a. comprehension_log -> entities -----------------------------------------
-- action mirrors comprehension_log.entities_created / entities_updated: it is
-- 'created' when this comprehend produced a brand-new brain page for the entity,
-- 'updated' when it revised an existing one.
CREATE TABLE IF NOT EXISTS comprehension_entities (
    comprehension_id BIGINT  NOT NULL REFERENCES comprehension_log(id) ON DELETE CASCADE,
    entity_id        INTEGER NOT NULL REFERENCES entities(id)          ON DELETE CASCADE,
    action           TEXT    NOT NULL CHECK (action IN ('created', 'updated')),
    PRIMARY KEY (comprehension_id, entity_id)
);

-- Reverse lookup: "which comprehensions touched this entity?"
CREATE INDEX IF NOT EXISTS comprehension_entities_entity_idx
    ON comprehension_entities (entity_id);

-- 2b. comprehension_log -> relationships ------------------------------------
CREATE TABLE IF NOT EXISTS comprehension_relationships (
    comprehension_id BIGINT  NOT NULL REFERENCES comprehension_log(id)  ON DELETE CASCADE,
    relationship_id  INTEGER NOT NULL REFERENCES relationships(id)      ON DELETE CASCADE,
    PRIMARY KEY (comprehension_id, relationship_id)
);

-- Reverse lookup: "which comprehensions wrote this relationship?"
CREATE INDEX IF NOT EXISTS comprehension_relationships_rel_idx
    ON comprehension_relationships (relationship_id);
