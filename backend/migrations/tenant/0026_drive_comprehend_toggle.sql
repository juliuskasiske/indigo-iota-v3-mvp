-- 0026_drive_comprehend_toggle.sql
-- ---------------------------------------------------------------------------
-- Per-workspace toggle: should the comprehend agents run over Google Drive
-- DOCUMENTS (extracting entities/relationships into brain pages + the graph), or
-- not?
--
-- Documents are ALWAYS chunked + embedded for retrieval (that's local + free).
-- This flag only gates the metered LLM enrichment, so it defaults to FALSE —
-- a workspace opts in once it's happy to spend credits comprehending its files.
-- Surfaced to both the workspace admin and the operator (Control Tower) via the
-- existing comprehend-settings plumbing (added in 0024).
-- ---------------------------------------------------------------------------

ALTER TABLE comprehend_settings
    ADD COLUMN IF NOT EXISTS drive_comprehend_enabled BOOLEAN NOT NULL DEFAULT FALSE;
