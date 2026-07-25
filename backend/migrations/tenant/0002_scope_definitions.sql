-- 0002_scope_definitions.sql
-- ---------------------------------------------------------------------------
-- Per-tenant, admin-editable email scope classification.
--
-- The four buckets (in_scope / redzone / spam / out_of_scope) and the POLICY
-- (only in_scope is ever ingested) are fixed in code and cannot be changed from
-- the Admin Center — an admin can never make "redzone" include, by design.
--
-- What the customer admin DOES edit, per engagement, is:
--   * each bucket's natural-language `description`,
--   * its example `anchors` (short phrases), and
--   * the Layer-2 security `margin`.
--
-- Defaults are seeded from backend/classification.yaml on first read
-- (src/ingest/scope_store.seed_if_empty), so the canonical starter text lives
-- in exactly one place and the admin sees it ready to edit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scope_buckets (
    bucket       TEXT PRIMARY KEY,
    action       TEXT NOT NULL CHECK (action IN ('include', 'exclude')),
    description  TEXT NOT NULL DEFAULT '',
    anchors      JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT
);

-- Single-row table holding the Layer-2 security margin for this tenant.
CREATE TABLE IF NOT EXISTS scope_settings (
    id         BOOLEAN PRIMARY KEY DEFAULT TRUE,
    margin     NUMERIC(6,4) NOT NULL DEFAULT 0.0300,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT,
    CONSTRAINT scope_settings_singleton CHECK (id)
);
