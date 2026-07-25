-- 0013_source_is_mailbox.sql
-- ---------------------------------------------------------------------------
-- A capture source is now just a MAILBOX — the admin no longer picks folders.
--
-- Decision (supersedes 0012): the admin types an email address and Indigo Iota
-- pulls from ALL of that mailbox's folders, minus the noise ones (Junk, Deleted
-- Items, Drafts). The folder list is re-discovered on every sync, so folders a
-- user adds or deletes are always reflected without any admin action. There is
-- therefore nothing for the admin to choose per folder, so the folder column on
-- capture_sources is dead weight — we drop it and key a source on mailbox alone.
--
-- The per-folder delta cursor is KEPT (capture_cursors stays keyed on
-- (mailbox, folder)): each discovered folder still needs its own sync position
-- because Graph's delta cursor is per folder. The "folder" stored there is now
-- the folder's Graph id, set by the sync at discovery time — this migration does
-- not touch capture_cursors.
-- ---------------------------------------------------------------------------

-- Collapse any same-mailbox rows 0012 allowed (one per folder) down to a single
-- row per mailbox, keeping the lowest id so a stable id survives.
DELETE FROM capture_sources a
      USING capture_sources b
      WHERE a.mailbox = b.mailbox
        AND a.id > b.id;

-- Drop the composite (mailbox, folder) UNIQUE from 0012 and the now-dead folder
-- column, then re-key the table on mailbox alone. All guarded for re-runs.
ALTER TABLE capture_sources
    DROP CONSTRAINT IF EXISTS capture_sources_mailbox_folder_key;

ALTER TABLE capture_sources DROP COLUMN IF EXISTS folder;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_mailbox_key'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources
            ADD CONSTRAINT capture_sources_mailbox_key UNIQUE (mailbox);
    END IF;
END $$;
