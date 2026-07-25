-- 0024_comprehend_settings.sql
-- ---------------------------------------------------------------------------
-- Per-tenant "Diligence" config for the comprehend pipeline. One singleton row
-- (id = TRUE), mirroring triage_settings.
--
-- Two dimensions, both of which drive cost:
--   1. relationship_diligence — how exhaustively the pairwise RelationshipAgent
--      evaluates entity pairs: 'anchored' (principal + 3rd-party spokes, linear),
--      'capped' (full pairwise only when few entities), 'exhaustive' (all pairs).
--   2. context_agents — which downstream per-email agents receive the 3rd-party
--      1-hop brain-page context (a JSON map agent->bool); context_max_neighbors
--      caps how many neighbour pages are pulled.
--
-- Editable from the Admin Center and the Control Tower. Idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comprehend_settings (
    id                    BOOLEAN PRIMARY KEY DEFAULT TRUE
                          CHECK (id),               -- single-row guard
    relationship_diligence TEXT NOT NULL DEFAULT 'anchored'
                          CHECK (relationship_diligence IN ('anchored', 'capped', 'exhaustive')),
    context_agents        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"identifier": true, ...}
    context_max_neighbors INTEGER NOT NULL DEFAULT 10,
    updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by            TEXT
);

-- Seed the single row so reads never have to special-case "no row yet".
INSERT INTO comprehend_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
