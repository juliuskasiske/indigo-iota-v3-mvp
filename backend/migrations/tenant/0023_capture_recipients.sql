-- 0023_capture_recipients.sql
-- ---------------------------------------------------------------------------
-- Preserve To and CC recipients separately on captured_events.
--
-- Capture flattened sender + To + CC into one `participants` array, losing the
-- distinction. The reworked comprehend pipeline wants the full envelope (who was
-- addressed directly vs CC'd) to build email context and detect the third party.
-- Add two JSONB arrays of addresses; keep `participants` for back-compat.
--
-- BCC is never present in inbound headers, so it is intentionally not modelled.
--
-- Backfill: Graph rows keep the full message in `raw`, so To/CC are recoverable
-- from raw->'toRecipients' / raw->'ccRecipients'. IMAP's compact `raw` does NOT
-- carry recipients, so historical IMAP rows stay NULL (only the merged
-- `participants` survives for them); going forward both connectors populate the
-- columns. Idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE captured_events ADD COLUMN IF NOT EXISTS recipients_to JSONB;
ALTER TABLE captured_events ADD COLUMN IF NOT EXISTS recipients_cc JSONB;

-- Backfill Graph-captured rows from the preserved raw message payload.
UPDATE captured_events
SET recipients_to = (
    SELECT jsonb_agg(addr)
    FROM (
        SELECT elem->'emailAddress'->>'address' AS addr
        FROM jsonb_array_elements(raw->'toRecipients') elem
    ) s
    WHERE s.addr IS NOT NULL
)
WHERE recipients_to IS NULL AND jsonb_typeof(raw->'toRecipients') = 'array';

UPDATE captured_events
SET recipients_cc = (
    SELECT jsonb_agg(addr)
    FROM (
        SELECT elem->'emailAddress'->>'address' AS addr
        FROM jsonb_array_elements(raw->'ccRecipients') elem
    ) s
    WHERE s.addr IS NOT NULL
)
WHERE recipients_cc IS NULL AND jsonb_typeof(raw->'ccRecipients') = 'array';
