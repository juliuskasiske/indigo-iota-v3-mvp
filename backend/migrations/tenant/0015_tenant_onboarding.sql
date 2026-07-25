-- 0015_tenant_onboarding.sql
-- ---------------------------------------------------------------------------
-- Once-per-tenant onboarding completion stamp.
--
-- The Admin Center has two distinct modes:
--   * a once-per-tenant onboarding WIZARD (set credits, connect sources,
--     approve scope, define the brain, run the first backfill), and
--   * the steady-state DASHBOARD where every one of those settings stays
--     freely editable with no step framing.
--
-- This table records whether a tenant has finished the wizard. While unset,
-- the Admin Center renders the wizard; once stamped (an admin clicks Finish),
-- it renders the dashboard. An admin can deliberately re-open the wizard,
-- which clears the stamp.
--
-- Grandfather clause: any tenant that has already approved its scope is an
-- established workspace from before this wizard existed — mark it onboarded so
-- the new check never drops a live customer back into the setup wizard. Fresh
-- tenants (no approval yet) correctly start un-onboarded.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_onboarding (
    id            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    onboarded_at  TIMESTAMPTZ,
    onboarded_by  TEXT
);

-- Ensure the singleton row exists.
INSERT INTO tenant_onboarding (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

-- Grandfather: established tenants (scope already approved) are onboarded.
UPDATE tenant_onboarding
   SET onboarded_at = COALESCE(onboarded_at, now()),
       onboarded_by = COALESCE(onboarded_by, 'migration: pre-existing tenant')
 WHERE onboarded_at IS NULL
   AND EXISTS (
       SELECT 1 FROM triage_settings
        WHERE id = TRUE AND approved_at IS NOT NULL
   );
