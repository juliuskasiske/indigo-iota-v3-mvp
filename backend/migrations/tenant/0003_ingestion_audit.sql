-- 0003_ingestion_audit.sql
-- ---------------------------------------------------------------------------
-- Connector ingestion: delta-sync state, run history, and a content-free
-- exclusion audit. All per-tenant (lives in the brain DB).
--
-- The scope gate (src/ingest/classify) decides what enters source_events.
-- INCLUDED events become full source_events rows (raw payload kept for replay).
-- EXCLUDED events are NEVER stored as content — we keep only the scope decision
-- metadata here (bucket, reason, scores, the opaque source id) so we can explain
-- *why* something was dropped without persisting the dropped content. GDPR data
-- minimization by construction.
-- ---------------------------------------------------------------------------

-- Microsoft Graph delta state, one row per mailbox. delta_link is the opaque
-- cursor Graph returns; the next sync sends it to get only what changed.
CREATE TABLE IF NOT EXISTS mailbox_sync_state (
    mailbox        TEXT PRIMARY KEY,
    delta_link     TEXT,
    last_synced_at TIMESTAMPTZ
);

-- One row per ingest run (a single pull of a mailbox).
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id          SERIAL PRIMARY KEY,
    source      TEXT NOT NULL,             -- 'email'
    mailbox     TEXT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    fetched     INTEGER NOT NULL DEFAULT 0,
    included    INTEGER NOT NULL DEFAULT 0,
    excluded    INTEGER NOT NULL DEFAULT 0,
    duplicates  INTEGER NOT NULL DEFAULT 0,
    removed     INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);

-- Content-free record of every excluded event. NO subject / body / sender —
-- only the scope decision and the opaque origin id, for transparency + tuning.
CREATE TABLE IF NOT EXISTS ingestion_exclusions (
    id          SERIAL PRIMARY KEY,
    run_id      INTEGER REFERENCES ingestion_runs(id) ON DELETE SET NULL,
    source      TEXT NOT NULL,
    external_id TEXT,
    bucket      TEXT NOT NULL,             -- redzone | spam | out_of_scope
    reason      TEXT,
    scores      JSONB,                     -- per-bucket cosine similarities
    occurred_at TIMESTAMPTZ,
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_exclusions_run_idx
    ON ingestion_exclusions (run_id);

-- Mark which source_events have already been turned into brain pages, so the
-- extraction step only processes new ones (and can resume after a credit stop).
ALTER TABLE source_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS source_events_unprocessed_idx
    ON source_events (occurred_at) WHERE processed_at IS NULL;
