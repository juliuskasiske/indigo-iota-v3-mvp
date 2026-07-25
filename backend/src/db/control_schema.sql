-- Indigo Iota CONTROL PLANE schema.
--
-- This database is SHARED across all customers, but it holds *no* customer
-- brain data. It only holds the records needed to route a request to the right
-- place and to govern access:
--
--   organizations     — one row per customer (tenant)
--   tenant_databases  — the registry mapping each org to its own brain DB
--   users             — global identities (filled in from EntraID SSO)
--   memberships       — which user has which role in which org
--   audit_log         — provisioning + admin actions, for accountability
--
-- Each customer's actual knowledge lives in a SEPARATE per-tenant database
-- (see migrations/tenant/), never here. This file is idempotent.

CREATE TABLE IF NOT EXISTS organizations (
    id           SERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,        -- url-safe key; also drives the tenant db name
    name         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'provisioning'
                 CHECK (status IN ('provisioning', 'active', 'suspended')),
    data_region  TEXT NOT NULL DEFAULT 'EU',  -- where this org's data is hosted
    settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Hard credit ceiling for an org's LLM spend. NULL = no limit (uncapped).
-- When set, the metering chokepoint blocks any LLM call that would push spend
-- to/over this value BEFORE it fires (see metering.enforce_credit_limit) — so a
-- runaway backfill can never overshoot the budget. Spend is measured against
-- the price book (llm_usage_events.total_cost). Idempotent for existing DBs.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(20, 10);

-- Per-workspace customer markup: raw provider cost x this factor = what the
-- customer sees/pays (1 credit = $1). NULL = use the global default
-- (metering.CUSTOMER_MARKUP). Set by the platform owner in the Control Tower;
-- the markup lives only at the customer API boundary, so this scales every
-- customer-facing figure (Usage, Observability cost, credits balance/spend, the
-- add-credits conversion) for this org. Internal storage stays raw.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS markup_factor NUMERIC(12, 4);

-- How members of this org sign in. 'entra' = Microsoft SSO (the existing path);
-- 'native' = email + password + TOTP, for customers on a custom IMAP domain who
-- have no Microsoft tenant. The login page reads this to decide which form to
-- show. Defaults to 'entra' so every pre-existing org keeps its current flow.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'entra';
-- Converge legacy rows: this method was first shipped as 'local', renamed to
-- 'native' so it no longer collides with "local" in the infra/deployment sense.
-- Drop the old constraint, migrate the value, then add the constraint back.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_auth_method_chk;
UPDATE organizations SET auth_method = 'native' WHERE auth_method = 'local';
ALTER TABLE organizations
    ADD CONSTRAINT organizations_auth_method_chk
    CHECK (auth_method IN ('entra', 'native'));

-- Workspace deletion tombstone states. 'deleting' = erasure in progress (the
-- scheduler skips any non-'active' org, so sync stops the moment we flip it);
-- 'deleted' = erased — its tenant DB is dropped and every personal row is wiped,
-- but the org row itself survives as a financial tombstone so the billing ledger
-- (llm_usage_events, credit_entries, audit_log) stays attributable to it. The
-- inline CHECK is auto-named organizations_status_check; drop + re-add to widen.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations
    ADD CONSTRAINT organizations_status_check
    CHECK (status IN ('provisioning', 'active', 'suspended', 'deleting', 'deleted'));

-- One row per provisioned brain database. dsn = NULL means "derive the URL from
-- the control server" (the simple single-server setup); set dsn to pin a tenant
-- to its own database server later, without touching any code.
CREATE TABLE IF NOT EXISTS tenant_databases (
    id             SERIAL PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    db_name        TEXT NOT NULL UNIQUE,
    dsn            TEXT,
    schema_version TEXT,                       -- head migration currently applied
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended', 'deleting')),
    provisioned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Global identity. One person = one row, even if they belong to several orgs.
-- entra_oid / entra_tenant_id are filled in at first EntraID SSO login.
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    entra_oid       TEXT UNIQUE,
    entra_tenant_id TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- When the user proved control of their inbox by following an emailed link.
-- NULL for SSO users (Microsoft already vouches for the address) and for local
-- users who haven't accepted their invite yet. Idempotent for existing DBs.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Role within an org. The role decides which Admin Center panels and options a
-- user sees, and (later) what they can do.
CREATE TABLE IF NOT EXISTS memberships (
    id         SERIAL PRIMARY KEY,
    org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'consultant'
               CHECK (role IN ('admin', 'consultant', 'viewer')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS memberships_org_idx  ON memberships (org_id);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

-- Per-organization EntraID (OIDC) single sign-on configuration. One row per org.
-- Uses the delegated OIDC code flow (users sign in) against the customer's own
-- tenant authority. Only the per-customer facts live here: their tenant_id, the
-- Login app's client_id (public — it appears in the browser sign-in URL), the
-- redirect_uri, and an enable flag.
--
-- The Login app's CLIENT SECRET is deliberately NOT stored here. It is a single
-- shared value for the one multi-tenant Login app, supplied at runtime via the
-- SSO_CLIENT_SECRET environment variable (a secrets manager in prod). Keeping it
-- out of the application database means a DB dump/backup can never leak the live
-- SSO credential, and the secret is rotated in one place, not once per tenant row.
CREATE TABLE IF NOT EXISTS sso_connections (
    id            SERIAL PRIMARY KEY,
    org_id        INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL DEFAULT 'entra' CHECK (provider IN ('entra')),
    tenant_id     TEXT NOT NULL,              -- Entra directory (tenant) id
    client_id     TEXT NOT NULL,              -- Login app application (client) id (public)
    redirect_uri  TEXT NOT NULL,              -- must match the app registration
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Converge databases provisioned before the secret moved to runtime config:
-- drop the legacy column if it is still present (idempotent, runs every init).
ALTER TABLE sso_connections DROP COLUMN IF EXISTS client_secret;

-- ============================================================================
-- Local password authentication + TOTP MFA
-- ----------------------------------------------------------------------------
-- For organizations with auth_method = 'native' (no Microsoft SSO). Sign-in is
-- email + password + a 6-digit authenticator code. Onboarding never emails a
-- password: an admin invites a member, who receives a single-use link (a token
-- whose HASH is stored here, never the token itself) to verify their inbox and
-- set their own password, then must enrol an authenticator app before the
-- account is usable. All secrets are hashed (passwords, backup codes) or
-- encrypted at rest (the TOTP seed, via secret_box / IOTA_SECRET_KEY) — a DB
-- dump alone reveals no usable credential.
-- ============================================================================

-- One row per local user. password_hash is argon2id. failed_attempts +
-- locked_until back a lockout/backoff so the password can't be brute-forced.
CREATE TABLE IF NOT EXISTS local_credentials (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash   TEXT NOT NULL,                 -- argon2id
    password_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-use, short-lived links for invite (set first password + verify email)
-- and password reset. Only the SHA-256 hash of the raw token is stored; the raw
-- token lives only in the emailed URL. A token is spent the moment it is used
-- (consumed_at) and is worthless after expires_at.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
    token_hash  TEXT NOT NULL UNIQUE,              -- sha256 hex of the raw token
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- The authenticator-app seed, one per local user. secret_encrypted is the base32
-- TOTP seed encrypted with secret_box (Fernet); confirmed_at is set only once the
-- user has proved enrolment by entering a live code, so a half-finished setup
-- never counts as MFA.
CREATE TABLE IF NOT EXISTS totp_secrets (
    user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,                -- secret_box(base32 seed)
    confirmed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time recovery codes for when the authenticator device is lost. Stored as
-- argon2id hashes; used_at marks a code as spent (single use).
CREATE TABLE IF NOT EXISTS totp_backup_codes (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,                       -- argon2id of the backup code
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS totp_backup_codes_user_idx ON totp_backup_codes (user_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id         SERIAL PRIMARY KEY,
    org_id     INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    actor      TEXT,                           -- who/what performed the action
    action     TEXT NOT NULL,
    detail     JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_org_idx ON audit_log (org_id, created_at DESC);

-- ============================================================================
-- LLM metering + billing
-- ----------------------------------------------------------------------------
-- The whole point: measure cost accurately. Every LLM API call is one immutable
-- row in llm_usage_events, with input and output tokens kept SEPARATE (their
-- prices differ) and the price that applied AT THE TIME snapshotted into the
-- row. That makes historical cost permanent: changing a price later never
-- rewrites the past. Prices live in an effective-dated price book; the price in
-- effect at instant T for a model is the row with the latest effective_from <= T.
-- ============================================================================

-- Effective-dated price book. One row per (model, effective_from). Prices are
-- per 1,000,000 tokens so they read like vendor price sheets; input and output
-- are separate because providers (incl. LLMBase) charge them differently.
CREATE TABLE IF NOT EXISTS llm_model_prices (
    id                    SERIAL PRIMARY KEY,
    model                 TEXT NOT NULL,                 -- e.g. 'openai/gpt-oss-120b'
    currency              TEXT NOT NULL DEFAULT 'USD',
    input_price_per_mtok  NUMERIC(20, 10) NOT NULL,      -- price per 1M input (prompt) tokens
    output_price_per_mtok NUMERIC(20, 10) NOT NULL,      -- price per 1M output (completion) tokens
    effective_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note                  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model, effective_from)
);

CREATE INDEX IF NOT EXISTS llm_model_prices_lookup_idx
    ON llm_model_prices (model, effective_from DESC);

-- The ledger: one row per LLM API call. Append-only and self-contained — the
-- price columns are a frozen snapshot, so a row's cost is correct forever even
-- if llm_model_prices changes afterwards. price_id keeps the audit trail back to
-- the price book row that was applied (NULL = call recorded before any matching
-- price existed; recost can fill it in later).
CREATE TABLE IF NOT EXISTS llm_usage_events (
    id                    BIGSERIAL PRIMARY KEY,
    org_id                INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    model                 TEXT NOT NULL,                 -- model actually used for this call
    request_kind          TEXT,                          -- 'comprehension' | 'qa' | 'page_update' | ...
    prompt_tokens         INTEGER NOT NULL DEFAULT 0,    -- input tokens
    completion_tokens     INTEGER NOT NULL DEFAULT 0,    -- output tokens
    total_tokens          INTEGER NOT NULL DEFAULT 0,
    -- price snapshot (point-in-time, frozen at write):
    price_id              INTEGER REFERENCES llm_model_prices(id) ON DELETE SET NULL,
    currency              TEXT NOT NULL DEFAULT 'USD',
    input_price_per_mtok  NUMERIC(20, 10) NOT NULL DEFAULT 0,
    output_price_per_mtok NUMERIC(20, 10) NOT NULL DEFAULT 0,
    -- computed cost from the price book, frozen at write time:
    input_cost            NUMERIC(20, 10) NOT NULL DEFAULT 0,
    output_cost           NUMERIC(20, 10) NOT NULL DEFAULT 0,
    total_cost            NUMERIC(20, 10) NOT NULL DEFAULT 0,
    meta                  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- response model, request id, raw usage, flags
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLMBase returns no per-request cost (verified 2026-06-01: only token counts,
-- no cost in body or headers, and no pricing API to sync from). So cost is the
-- price-book computation only; drop the never-populated vendor-cost columns from
-- any control DB created before this cleanup. (Drop the dependent view first so
-- the column drop isn't blocked; it's recreated below.)
DROP VIEW IF EXISTS org_credit_balance;
ALTER TABLE llm_usage_events DROP COLUMN IF EXISTS vendor_cost;
ALTER TABLE llm_usage_events DROP COLUMN IF EXISTS vendor_currency;

-- Which agent class fired the call (e.g. 'IdentifierAgent', 'TranslatorAgent',
-- 'AnswerAgent'). NULL for calls recorded before this column existed.
ALTER TABLE llm_usage_events
    ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Which user triggered the call. NULL for scheduled/system usage.
-- Populated for Q&A requests (the user who asked) and admin-triggered backfills
-- (the admin who hit the button). Foreign-keyed to users; set NULL on user delete
-- so the cost history survives even if the user is removed.
ALTER TABLE llm_usage_events
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS llm_usage_events_org_idx   ON llm_usage_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_events_model_idx ON llm_usage_events (model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_events_agent_idx ON llm_usage_events (agent_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_events_user_idx  ON llm_usage_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_events_unpriced_idx
    ON llm_usage_events (occurred_at) WHERE price_id IS NULL;

-- Credit top-ups: setup fee, monthly grants, manual adjustments. Consumption is
-- NOT duplicated here — it is summed from llm_usage_events.total_cost so the
-- usage ledger stays the single source of truth for spend. Balance = grants - spend.
CREATE TABLE IF NOT EXISTS credit_entries (
    id          BIGSERIAL PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind        TEXT NOT NULL CHECK (kind IN ('grant', 'setup', 'adjustment')),
    amount      NUMERIC(20, 10) NOT NULL,      -- positive adds credit; negative claws back
    currency    TEXT NOT NULL DEFAULT 'USD',
    actor       TEXT,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_entries_org_idx ON credit_entries (org_id, occurred_at DESC);

-- Running credit balance per org: total granted minus total spent on LLM usage.
-- Spend = the price-book cost frozen into each usage event.
CREATE OR REPLACE VIEW org_credit_balance AS
SELECT o.id                                  AS org_id,
       o.slug                                AS slug,
       COALESCE(g.granted, 0)                AS credits_granted,
       COALESCE(u.spent, 0)                  AS credits_spent,
       COALESCE(g.granted, 0) - COALESCE(u.spent, 0) AS balance
FROM organizations o
LEFT JOIN (
    SELECT org_id, SUM(amount) AS granted FROM credit_entries GROUP BY org_id
) g ON g.org_id = o.id
LEFT JOIN (
    SELECT org_id, SUM(total_cost) AS spent
    FROM llm_usage_events GROUP BY org_id
) u ON u.org_id = o.id;

-- ============================================================================
-- MCP access tokens (remote Model Context Protocol connectors)
-- ----------------------------------------------------------------------------
-- A bearer token that lets an external MCP client (Claude, ChatGPT) read ONE
-- workspace's brain on behalf of ONE member. Only the SHA-256 HASH of the raw
-- token is stored — the raw value is shown once at creation and never again, so
-- a DB dump reveals no usable credential. The row binds (user_id, org_id): the
-- user is who LLM spend is attributed to, the org is the single tenant whose
-- brain the token may read. ``scopes`` gates which tools it may call
-- (e.g. 'brain:read' for retrieval, 'brain:ask' for the credit-costing Q&A).
-- Phase 1 mints these directly as personal access tokens; the Phase 2 OAuth
-- flow will issue rows in this same shape (hence the generic name).
-- ============================================================================
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,              -- sha256 hex of the raw bearer
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL DEFAULT '{}',      -- e.g. {brain:read, brain:ask}
    label        TEXT,                              -- human label, e.g. 'Claude desktop'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,                       -- NULL = never expires
    revoked_at   TIMESTAMPTZ                        -- non-NULL = revoked, no longer valid
);

CREATE INDEX IF NOT EXISTS mcp_tokens_org_idx  ON mcp_tokens (org_id);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_id);

-- ============================================================================
-- OAuth 2.1 for the remote MCP server (Phase 2)
-- ----------------------------------------------------------------------------
-- Indigo Iota is its own OAuth Authorization Server for the /mcp resource, so
-- Claude / ChatGPT can do the one-click "Add connector" flow (Dynamic Client
-- Registration + authorization-code + PKCE). The human-auth step reuses the
-- existing iota_session; these tables hold only the OAuth bookkeeping.
--
-- Secrets are never stored in the clear: client secrets are encrypted at rest
-- (secret_box / IOTA_SECRET_KEY) and every issued code/token is stored only as
-- its SHA-256 hash. Access + refresh tokens carry the SAME (user_id, org_id) as
-- a Phase 1 personal access token, so the rest of the server treats both alike.
-- ============================================================================

-- Dynamically-registered OAuth clients (one row per connector registration).
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id                  TEXT PRIMARY KEY,         -- uuid, generated by the SDK
    client_secret_encrypted    TEXT,                     -- secret_box(secret); NULL for public (PKCE-only) clients
    redirect_uris              TEXT[] NOT NULL DEFAULT '{}',
    client_name                TEXT,
    scope                      TEXT,                     -- space-delimited default scope
    grant_types                TEXT[] NOT NULL DEFAULT '{authorization_code,refresh_token}',
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post',
    metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full client info (no secret) for faithful reconstruction
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time authorization codes (PKCE). Bound to the member + workspace the user
-- chose on the consent screen. Short-lived and single-use (consumed_at).
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    code             TEXT PRIMARY KEY,                   -- sha256 hex of the issued code
    client_id        TEXT NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    scopes           TEXT[] NOT NULL DEFAULT '{}',
    code_challenge   TEXT NOT NULL,                      -- PKCE S256 challenge
    redirect_uri     TEXT NOT NULL,
    redirect_uri_provided_explicitly BOOLEAN NOT NULL DEFAULT TRUE,
    resource         TEXT,                               -- RFC 8707 resource indicator
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Issued access + refresh tokens (hash-only). access + its refresh share a
-- grant_id, so revoking either revokes the whole grant.
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,                   -- sha256 hex of the raw token
    kind         TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    grant_id     TEXT NOT NULL,                          -- links an access token to its refresh token
    client_id    TEXT NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx  ON oauth_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_org_idx   ON oauth_tokens (org_id);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_expiry_idx ON oauth_auth_codes (expires_at);
