-- 0012_capture_sources_folder_key.sql
-- ---------------------------------------------------------------------------
-- Make a capture source identified by (mailbox, folder), not mailbox alone.
--
-- An admin needs to pull more than one folder from the same mailbox (e.g. both
-- Inbox and Sent Items of ops@). 0011 made the mailbox UNIQUE, which forbade
-- that. Here we drop that single-column UNIQUE and key the source on the pair
-- (mailbox, folder) instead, so the same mailbox can appear once per folder.
--
-- This also fixes a correctness bug in the delta cursor. Microsoft Graph's
-- delta cursor is PER FOLDER (the @odata.deltaLink is folder-specific), but
-- capture_cursors was keyed by mailbox alone — so Inbox and Sent of the same
-- mailbox would overwrite each other's cursor and corrupt both syncs. We add a
-- folder column to capture_cursors and re-key it on (mailbox, folder) so every
-- (mailbox, folder) sync keeps its own place.
--
-- Existing rows: capture_cursors rows predate folders, so they're Inbox cursors
-- (folder defaults to 'inbox', matching what the old single-folder sync pulled).
-- ---------------------------------------------------------------------------

-- 1. capture_sources: (mailbox, folder) is the natural key, not mailbox -------
--    Drop the mailbox-only UNIQUE that 0011's `mailbox TEXT NOT NULL UNIQUE`
--    auto-named capture_sources_mailbox_key, then add the composite UNIQUE.
--    Both guarded so a re-run is a no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_mailbox_key'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources DROP CONSTRAINT capture_sources_mailbox_key;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_mailbox_folder_key'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources
            ADD CONSTRAINT capture_sources_mailbox_folder_key UNIQUE (mailbox, folder);
    END IF;
END $$;

-- 2. capture_cursors: cursor is per (mailbox, folder), not per mailbox --------
--    Add the folder column (existing rows are Inbox cursors), drop whatever
--    primary key it currently has (mailbox_sync_state_pkey after the 0006
--    rename — renaming a table does not rename its constraints), and re-key
--    on (mailbox, folder).
ALTER TABLE capture_cursors ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'inbox';

DO $$
DECLARE
    pk_name TEXT;
BEGIN
    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'capture_cursors'::regclass AND contype = 'p';

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE capture_cursors DROP CONSTRAINT %I;', pk_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'capture_cursors'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE capture_cursors
            ADD CONSTRAINT capture_cursors_pkey PRIMARY KEY (mailbox, folder);
    END IF;
END $$;
