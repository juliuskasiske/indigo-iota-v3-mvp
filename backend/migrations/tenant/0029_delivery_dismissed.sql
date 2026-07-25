-- 0029_delivery_dismissed.sql
-- ---------------------------------------------------------------------------
-- Remember which to-dos / suggestions a user has already acted on, so the
-- 3-hourly regeneration doesn't keep re-surfacing the same ones. Stored as an
-- array of normalized keys (lowercased titles) on the per-user delivery row.
-- compute_pool_for_user excludes these and fills the freed slots with other
-- entities; the API also filters them out of any already-cached pool.
-- ---------------------------------------------------------------------------

ALTER TABLE delivery_todos
    ADD COLUMN IF NOT EXISTS dismissed JSONB NOT NULL DEFAULT '[]'::jsonb;
