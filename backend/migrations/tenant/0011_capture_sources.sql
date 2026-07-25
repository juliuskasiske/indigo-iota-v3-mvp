-- 0011_capture_sources.sql
-- ---------------------------------------------------------------------------
-- Admin-managed list of which mailboxes (and folder) this tenant pulls mail
-- from. Per-tenant (lives in the brain DB), edited from the Admin Center.
--
-- Until now the set of mailboxes to sync lived only in the IOTA_SYNC_TARGETS
-- env var, so an admin had no way to say "pull from ops@ and sales@" without a
-- redeploy. This table is the source of truth the scheduler reads: each enabled
-- row is one mailbox the periodic sync (and a manual backfill) will pull. The
-- env var stays as an offline/override path.
--
-- One row per mailbox (UNIQUE) — the same mailbox is never listed twice. The
-- delta cursor for each mailbox lives separately in capture_cursors, keyed by
-- the same mailbox string, so disabling/removing a source here does not lose
-- the cursor's place.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capture_sources (
    id         SERIAL PRIMARY KEY,
    mailbox    TEXT NOT NULL UNIQUE,
    folder     TEXT NOT NULL DEFAULT 'inbox',
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT
);
