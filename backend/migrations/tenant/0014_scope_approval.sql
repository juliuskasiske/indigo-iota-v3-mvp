-- 0014_scope_approval.sql
-- ---------------------------------------------------------------------------
-- Scope sign-off gate.
--
-- Capture (both the live sync and a manual backfill) runs every email through
-- the triage scope gate. Pulling mail before the customer has reviewed and
-- approved that scope policy means filtering their inbox against an unreviewed
-- ruleset. So we add an explicit approval stamp: capture stays paused for a
-- tenant until an admin approves the scope here.
--
-- Grandfather clause: any tenant that ALREADY has a scope_settings row is a
-- live workspace from before this gate existed — mark it approved so the new
-- check never silently pauses an established sync. Fresh tenants have no row
-- yet (it is seeded lazily on first read), so they correctly start unapproved
-- and must go through the onboarding sign-off.
-- ---------------------------------------------------------------------------

ALTER TABLE triage_settings ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE triage_settings ADD COLUMN IF NOT EXISTS approved_by TEXT;

UPDATE triage_settings
   SET approved_at = COALESCE(approved_at, now()),
       approved_by = COALESCE(approved_by, 'migration: pre-existing tenant')
 WHERE approved_at IS NULL;
