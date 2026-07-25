-- 0028_delivery_suggestions.sql
-- ---------------------------------------------------------------------------
-- The Delivery pool now carries two lists: strict ``todos`` (action due in the
-- next 24h, which may be empty) and proactive ``suggestions`` — a few next steps
-- to progress open lines of work, so the tab is useful even when nothing is
-- strictly due. Stored alongside the to-dos in the same per-user row.
-- ---------------------------------------------------------------------------

ALTER TABLE delivery_todos
    ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;
