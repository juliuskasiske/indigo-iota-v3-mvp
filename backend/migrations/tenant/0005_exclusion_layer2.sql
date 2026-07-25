-- 0005_exclusion_layer2.sql
-- ---------------------------------------------------------------------------
-- The scope gate excludes a redzone email at one of two layers (src/ingest/
-- classify): Layer 1, when redzone is the single nearest bucket; or Layer 2,
-- the security runoff, when the email looks in-scope but redzone is close
-- enough (within the caution margin) to keep it out anyway.
--
-- The audit row already records the bucket and the human-readable reason, but
-- the layer wasn't a first-class column — so a faithful "where did each email
-- branch" breakdown had to parse the reason string. This adds the flag the
-- classifier already computes (Decision.layer2_applied), so the Brain-activity
-- decision tree can split Layer-1 vs Layer-2 redzone exclusions exactly.
--
-- Backfill: existing rows predate the flag. A redzone reason mentioning
-- "Layer 2" is a Layer-2 exclusion; everything else stays Layer 1 (the
-- column default).
-- ---------------------------------------------------------------------------

ALTER TABLE ingestion_exclusions
    ADD COLUMN IF NOT EXISTS layer2_applied BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ingestion_exclusions
   SET layer2_applied = TRUE
 WHERE bucket = 'redzone'
   AND reason LIKE 'Layer 2%';
