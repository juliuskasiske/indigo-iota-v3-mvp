-- TENANT (brain) schema — migration 0006: rename tables/columns to the crisp
-- ingestion vocabulary used everywhere else now (code + the explainer).
--
-- ingestion = the WHOLE flow (email -> graph + chunks), in four phases:
--   capture  -> captured_events, capture_runs, capture_cursors
--   triage   -> triage_exclusions, triage_buckets, triage_settings
--   comprehend -> comprehension_log, entities, relationships
--   index    -> chunks (kept)
--
-- Renames are guarded so a partial/re-run is a no-op (the migration runner
-- already records applied versions, but this keeps it safe under manual replay).

DO $$
BEGIN
    -- capture phase
    IF to_regclass('source_events') IS NOT NULL AND to_regclass('captured_events') IS NULL THEN
        ALTER TABLE source_events RENAME TO captured_events;
    END IF;
    IF to_regclass('ingestion_runs') IS NOT NULL AND to_regclass('capture_runs') IS NULL THEN
        ALTER TABLE ingestion_runs RENAME TO capture_runs;
    END IF;
    IF to_regclass('mailbox_sync_state') IS NOT NULL AND to_regclass('capture_cursors') IS NULL THEN
        ALTER TABLE mailbox_sync_state RENAME TO capture_cursors;
    END IF;

    -- triage phase
    IF to_regclass('ingestion_exclusions') IS NOT NULL AND to_regclass('triage_exclusions') IS NULL THEN
        ALTER TABLE ingestion_exclusions RENAME TO triage_exclusions;
    END IF;
    IF to_regclass('scope_buckets') IS NOT NULL AND to_regclass('triage_buckets') IS NULL THEN
        ALTER TABLE scope_buckets RENAME TO triage_buckets;
    END IF;
    IF to_regclass('scope_settings') IS NOT NULL AND to_regclass('triage_settings') IS NULL THEN
        ALTER TABLE scope_settings RENAME TO triage_settings;
    END IF;

    -- comprehend phase
    IF to_regclass('processed_items') IS NOT NULL AND to_regclass('comprehension_log') IS NULL THEN
        ALTER TABLE processed_items RENAME TO comprehension_log;
    END IF;
    IF to_regclass('nodes') IS NOT NULL AND to_regclass('entities') IS NULL THEN
        ALTER TABLE nodes RENAME TO entities;
    END IF;
    IF to_regclass('edges') IS NOT NULL AND to_regclass('relationships') IS NULL THEN
        ALTER TABLE edges RENAME TO relationships;
    END IF;
END $$;

-- Column renames (run after the tables exist under their new names).
DO $$
BEGIN
    IF to_regclass('comprehension_log') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'comprehension_log' AND column_name = 'source_event_id')
    THEN
        ALTER TABLE comprehension_log RENAME COLUMN source_event_id TO captured_event_id;
    END IF;

    IF to_regclass('chunks') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'chunks' AND column_name = 'node_id')
    THEN
        ALTER TABLE chunks RENAME COLUMN node_id TO entity_id;
    END IF;
END $$;

-- Keep index names aligned with their new tables (cosmetic; Postgres would keep
-- the old names working otherwise). Guarded individually.
ALTER INDEX IF EXISTS source_events_source_extid_idx   RENAME TO captured_events_source_extid_idx;
ALTER INDEX IF EXISTS source_events_thread_idx         RENAME TO captured_events_thread_idx;
ALTER INDEX IF EXISTS source_events_occurred_idx       RENAME TO captured_events_occurred_idx;
ALTER INDEX IF EXISTS source_events_unprocessed_idx    RENAME TO captured_events_unprocessed_idx;
ALTER INDEX IF EXISTS ingestion_exclusions_run_idx     RENAME TO triage_exclusions_run_idx;
ALTER INDEX IF EXISTS processed_items_processed_at_idx RENAME TO comprehension_log_processed_at_idx;
