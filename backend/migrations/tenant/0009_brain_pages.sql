-- 0009_brain_pages.sql
-- ---------------------------------------------------------------------------
-- Move brain pages off the local filesystem and into the tenant's own brain DB.
--
-- Until now a brain page was a JSON file under backend/brain_pages/, and that
-- file was the SOURCE OF TRUTH (the entities/relationships/chunks tables are a
-- derived index rebuilt from it). On a single-box container deploy that breaks:
-- the api and sync services have separate, ephemeral filesystems, so pages the
-- scheduler writes are invisible to the API and are wiped on every redeploy.
--
-- This table makes the page durable, shared across containers (they all reach
-- the same Postgres), and EU-resident with the rest of the data. The page JSON
-- stays the source of truth — it just lives in a row now, keyed by the same
-- relative path string the entities/chunks tables already reference.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brain_pages (
    page_path   TEXT PRIMARY KEY,                  -- e.g. 'persons/felix-kasiske.json'
                                                   -- same key entities.page_path / chunks.page_path use
    entity_type TEXT NOT NULL REFERENCES entity_types(key) ON DELETE RESTRICT ON UPDATE CASCADE,
    data        JSONB NOT NULL,                    -- the full {frontmatter, description, timeline, relationships}
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_pages_type_idx ON brain_pages (entity_type);
