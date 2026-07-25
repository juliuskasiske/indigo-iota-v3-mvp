-- 0025_gdrive_capture_sources.sql
-- ---------------------------------------------------------------------------
-- A capture source can now be a Google Drive FOLDER, not just an email mailbox.
--
-- v0 scope is CONNECT-ONLY: the admin shares a Drive folder with our shared
-- service account, pastes the folder link, and we store it (after a live read
-- check). Actually reading/ingesting the folder's files is a LATER phase — until
-- that connector ships, the periodic sync deliberately SKIPS provider='gdrive'
-- rows (see src/ingestion/scheduler.py), so a stored Drive folder is inert and
-- can never disturb the email sync.
--
-- Purely ADDITIVE: existing rows keep provider in ('graph','imap') and leave the
-- new gdrive_* columns null. Only provider='gdrive' rows carry a folder id.
--
-- There is NO per-source secret here: access is via ONE shared service account
-- whose key lives in the server env (GDRIVE_SERVICE_ACCOUNT_JSON), not the DB.
-- The customer grants access by sharing the folder with the service account's
-- email inside Google Drive; we only persist which folder to read.
-- ---------------------------------------------------------------------------

ALTER TABLE capture_sources
    ADD COLUMN IF NOT EXISTS gdrive_folder_id   TEXT,
    ADD COLUMN IF NOT EXISTS gdrive_folder_name TEXT,
    ADD COLUMN IF NOT EXISTS gdrive_drive_id    TEXT;  -- Shared Drive id (null for My-Drive folders)

-- Widen the provider guard to include 'gdrive'. The constraint already exists
-- from 0017 as ('graph','imap'); drop and re-add so the set includes gdrive.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_provider_check'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources DROP CONSTRAINT capture_sources_provider_check;
    END IF;
    ALTER TABLE capture_sources
        ADD CONSTRAINT capture_sources_provider_check
        CHECK (provider IN ('graph', 'imap', 'gdrive'));
END $$;

-- A Google Drive source is unusable without the folder id, so require it at the
-- row level (other providers are unaffected — the OR short-circuits).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_gdrive_fields_check'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources
            ADD CONSTRAINT capture_sources_gdrive_fields_check
            CHECK (
                provider <> 'gdrive'
                OR gdrive_folder_id IS NOT NULL
            );
    END IF;
END $$;
