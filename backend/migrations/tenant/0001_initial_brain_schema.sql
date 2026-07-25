-- TENANT (brain) schema — migration 0001, the baseline.
-- This is applied to *each customer's own database*. It holds only that one
-- customer's knowledge: the raw ingested events, the entity graph, and the
-- embedded text chunks. No cross-customer data ever lives here.
--
-- This file is the canonical brain schema (it used to live in src/db/schema.sql).
-- Evolve it by ADDING new numbered migrations in this directory — never edit an
-- already-applied file, or tenant databases will drift.

-- pgvector for the chunks.embedding column. Cheap no-op when already enabled.
CREATE EXTENSION IF NOT EXISTS vector;

-- source_events: the raw, normalized communications ingested from any source
-- (email | slack | file). This is the provenance + replay layer: every
-- connector (mock today; Slack/Outlook/SharePoint later) normalizes its
-- payload into a row here BEFORE the extraction pipeline runs. Keeping the
-- raw event lets us re-run extraction without re-pulling from the source.
CREATE TABLE IF NOT EXISTS source_events (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,            -- 'email' | 'slack' | 'file'
    external_id  TEXT,                     -- id in the origin system (dedup key)
    thread_id    TEXT,                     -- groups a conversation / file set
    occurred_at  TIMESTAMP,               -- when the event happened at source
    sender       TEXT,                     -- author / from address / uploader
    participants JSONB,                    -- recipients / channel members
    subject      TEXT,                     -- email subject / file name / channel
    body_text    TEXT,                     -- normalized plain-text content
    attachments  JSONB,                    -- [{name, mime, ...}] metadata
    raw          JSONB,                    -- the original payload, verbatim
    ingested_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Dedup on (source, external_id) so re-ingesting the same event is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS source_events_source_extid_idx
    ON source_events (source, external_id)
    WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_events_thread_idx ON source_events (thread_id);
CREATE INDEX IF NOT EXISTS source_events_occurred_idx ON source_events (occurred_at);

CREATE TABLE IF NOT EXISTS nodes (
    id        SERIAL PRIMARY KEY,      -- auto-incrementing id, Postgres fills it in
    type      TEXT NOT NULL,           -- 'person' | 'company' | 'project'
    name      TEXT NOT NULL,           -- the entity's name
    page_path TEXT                     -- link to its brain page (may be empty)
);

CREATE TABLE IF NOT EXISTS edges (
    id          SERIAL PRIMARY KEY,
    subject     INTEGER NOT NULL REFERENCES nodes(id),  -- must be a real node id
    predicate   TEXT NOT NULL,                          -- the relationship type
    object      INTEGER NOT NULL REFERENCES nodes(id),  -- must be a real node id
    source_page TEXT                                    -- which page this edge came from
);

-- Chunks: one row per embedded text fragment of a brain page.
-- Each page contributes 1 chunk for its description + 1 chunk per
-- timeline entry. embedding = vector for semantic similarity;
-- keywords = tsvector for full-text/keyword search; hybrid query
-- combines both for ranking.
CREATE TABLE IF NOT EXISTS chunks (
    id          SERIAL PRIMARY KEY,
    page_path   TEXT NOT NULL,                                -- e.g. 'persons/felix.json'
    node_id     INTEGER REFERENCES nodes(id) ON DELETE CASCADE, -- the entity this is about
    section     TEXT NOT NULL,                                -- 'description' | 'timeline'
    date        TEXT,                                         -- YYYY-MM-DD for timeline entries
    text        TEXT NOT NULL,                                -- the actual content embedded
    embedding   VECTOR(384),                                  -- bge-small-en-v1.5 dim
    keywords    TSVECTOR,                                     -- to_tsvector('english', text)
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_page_path_idx ON chunks (page_path);
CREATE INDEX IF NOT EXISTS chunks_keywords_idx  ON chunks USING GIN (keywords);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);

-- Questions: one row per Search-tab question. Stores the full answer +
-- the sources list verbatim, so the sidebar can replay a past question
-- without re-running the LLM.
--
-- (Previously called `chats`; renamed in-place via the migration block
-- below. Existing rows survive the rename.)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'chats' AND table_schema = current_schema())
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'questions' AND table_schema = current_schema())
    THEN
        ALTER TABLE chats RENAME TO questions;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS questions (
    id         SERIAL PRIMARY KEY,
    question   TEXT      NOT NULL,
    answer     TEXT      NOT NULL,
    sources    JSONB,                       -- the merged source list, verbatim
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS chats_created_at_idx;
CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC);
