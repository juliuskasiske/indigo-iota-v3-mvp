-- 0019_capture_duplicates.sql
-- ---------------------------------------------------------------------------
-- Per-email duplicate log.
--
-- Capture dedups on (source, external_id) via ON CONFLICT DO NOTHING, which
-- silently discards a re-fetched email — so the only duplicate signal was the
-- run-level capture_runs.duplicates COUNT, with no record of WHICH email
-- repeated. This table logs one row per duplicate hit (a re-fetch of an email
-- already captured), so the Tenant-observability trace can show, per email,
-- how many times it was re-seen.
--
-- No content is stored: just the dedup key + which run saw it again.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capture_duplicates (
    id          BIGSERIAL PRIMARY KEY,
    source      TEXT NOT NULL,             -- 'email' | 'file' | …
    external_id TEXT,                       -- the (source, external_id) dedup key
    run_id      INTEGER REFERENCES capture_runs(id) ON DELETE SET NULL,
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capture_duplicates_ext_idx
    ON capture_duplicates (source, external_id);
