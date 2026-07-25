-- 0004_processing_metadata.sql
-- ---------------------------------------------------------------------------
-- Per-item extraction metadata. One row per source_event that has been run
-- through the brain-filling pipeline, capturing the ACTUAL token/call fan-out
-- and the entity yield. This is the ground truth we use to harden the budget
-- estimate (src/billing/metering._pipeline_tokens) against the pilot's real
-- corpus over time — measured calls vs the modelled `1 + 4 x entities`.
--
-- Only in-scope items ever reach extraction: the scope gate (src/ingest/mail)
-- inserts ONLY included events into source_events; redzone/spam/out_of_scope
-- never become rows. So every processed_items row is, by construction, an
-- in-scope email/document — no extra filtering needed here.
--
-- No content is stored: we keep `body_chars` (a size proxy), not the body.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS processed_items (
    id               BIGSERIAL PRIMARY KEY,
    -- The item this measurement belongs to. UNIQUE makes recording idempotent:
    -- a re-processed event updates rather than duplicates. CASCADE so deleting
    -- a source_event takes its metadata with it.
    source_event_id  INTEGER NOT NULL UNIQUE
                       REFERENCES source_events(id) ON DELETE CASCADE,
    source           TEXT NOT NULL,          -- 'email' | 'file' (from source_events.source)

    -- Size proxy: character length of the rendered item text. ~4 chars/token
    -- gives a tokenizer-free body-token estimate without persisting content.
    body_chars       INTEGER NOT NULL DEFAULT 0,

    -- Entity yield from the identifier + canonicalizer (post-dedup), split by
    -- whether each entity created a new brain page or updated an existing one.
    entities_found   INTEGER NOT NULL DEFAULT 0,
    entities_created INTEGER NOT NULL DEFAULT 0,
    entities_updated INTEGER NOT NULL DEFAULT 0,

    -- ACTUAL pipeline fan-out for this item, snapshotted from the usage counter
    -- (delta across this item's serial process_text call).
    llm_calls        INTEGER NOT NULL DEFAULT 0,
    input_tokens     BIGINT  NOT NULL DEFAULT 0,
    output_tokens    BIGINT  NOT NULL DEFAULT 0,

    model            TEXT,                   -- LLM_BASE_MODEL the agents ran on
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_items_processed_at_idx
    ON processed_items (processed_at);
