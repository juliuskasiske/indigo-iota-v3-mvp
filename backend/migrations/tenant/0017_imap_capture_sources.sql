-- 0017_imap_capture_sources.sql
-- ---------------------------------------------------------------------------
-- A capture source can now be IMAP, not just Microsoft Graph.
--
-- Until now every source was an Exchange mailbox read through Graph with the
-- tenant's app-only credentials (held in env / a mounted cert). To onboard
-- customers who are NOT on Microsoft, a source can now be a generic IMAP
-- mailbox: the connector logs in with a per-source host + username + app
-- password and pulls mail over IMAP instead.
--
-- This is purely ADDITIVE. Existing rows get provider='graph' and leave the new
-- imap_* columns null, so the Graph path is unchanged. Only provider='imap'
-- rows carry connection details.
--
-- The app password is a long-lived credential we must be able to replay (you
-- can't hash it — IMAP login needs the plaintext), so it is stored ENCRYPTED:
-- imap_secret_encrypted holds a Fernet token produced by src/secret_box.py
-- using IOTA_SECRET_KEY, which lives OUTSIDE the database. The DB never sees the
-- plaintext, and a DB leak alone can't unlock it.
-- ---------------------------------------------------------------------------

ALTER TABLE capture_sources
    ADD COLUMN IF NOT EXISTS provider              TEXT    NOT NULL DEFAULT 'graph',
    ADD COLUMN IF NOT EXISTS imap_host             TEXT,
    ADD COLUMN IF NOT EXISTS imap_port             INTEGER,
    ADD COLUMN IF NOT EXISTS imap_username         TEXT,
    ADD COLUMN IF NOT EXISTS imap_secret_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS imap_use_ssl          BOOLEAN NOT NULL DEFAULT TRUE;

-- Guard the provider values we understand.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_provider_check'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources
            ADD CONSTRAINT capture_sources_provider_check
            CHECK (provider IN ('graph', 'imap'));
    END IF;
END $$;

-- An IMAP source is unusable without host + username + the encrypted secret, so
-- require them at the row level (Graph rows are unaffected — the OR short-circuits).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'capture_sources_imap_fields_check'
          AND conrelid = 'capture_sources'::regclass
    ) THEN
        ALTER TABLE capture_sources
            ADD CONSTRAINT capture_sources_imap_fields_check
            CHECK (
                provider <> 'imap'
                OR (imap_host IS NOT NULL
                    AND imap_username IS NOT NULL
                    AND imap_secret_encrypted IS NOT NULL)
            );
    END IF;
END $$;
