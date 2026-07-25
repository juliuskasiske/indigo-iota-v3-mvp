-- 0027_delivery_todos.sql
-- ---------------------------------------------------------------------------
-- The "Delivery" tab's per-user to-do pool.
--
-- Every ~3 hours (and on demand via the Sync-now button) a brain inference asks
-- which to-dos the logged-in member must act on in the next 24h — matching the
-- member's email to a graph entity. The result is cached here, one current pool
-- per member email (upsert latest). ``computed_at`` doubles as the freshness
-- gate: the scheduler recomputes a member's pool only when it's older than the
-- interval, and the refresh endpoint is rate-limited off the same column.
--
-- ``todos`` is the JSON the DeliveryAgent returned: a list of
-- {title, context, source, due_in_hours, urgency, suggested_ask}.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS delivery_todos (
    user_email   TEXT PRIMARY KEY,
    todos        JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
