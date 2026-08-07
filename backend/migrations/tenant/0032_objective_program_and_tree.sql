-- 0032_objective_program_and_tree.sql
-- ---------------------------------------------------------------------------
-- Two changes that belong together, because the second is only meaningful once
-- the first exists.
--
-- 1. The objective function becomes a PROGRAM: not just which levers matter and
--    in what order, but in what unit the impact is measured (revenue / EBIT /
--    …), whether it is a recurring run-rate or a one-time gain, the run-rate
--    year it must hold in, the date the program ends, and how often it is
--    reviewed. Plus the one-sentence `headline` the agents compress all of that
--    into — the sentence that heads the whole diagnosis.
--
-- 2. The hypothesis tree becomes FIRST-CLASS ROWS instead of something re-derived
--    from the agent event log on every read. The log (agent_events) was fine for
--    a flat list of hypotheses rendered as text, but the tree now carries a
--    decomposition layer with its own rationale, evidence attached per node, and
--    a full initiative card at each leaf — none of which fits in a log line.
--    agent_events is UNCHANGED and still backs the Activity feed.
-- ---------------------------------------------------------------------------

-- --- 1. the objective becomes a time-bound, measurable program --------------

ALTER TABLE objective_function
    -- What the impact is measured in. 'custom' defers to impact_metric_label.
    ADD COLUMN IF NOT EXISTS impact_metric       text    NOT NULL DEFAULT 'revenue',
    ADD COLUMN IF NOT EXISTS impact_metric_label text    NOT NULL DEFAULT '',
    -- A recurring run-rate change, or a one-time gain. Decides how the Sizer
    -- must express every initiative's value.
    ADD COLUMN IF NOT EXISTS impact_type         text    NOT NULL DEFAULT 'recurring',
    ADD COLUMN IF NOT EXISTS currency            text    NOT NULL DEFAULT 'EUR',
    -- Where we are today, and where we want to be. target_amount is read
    -- against target_basis: 'absolute' = the goal itself, 'percent' = +N% on the
    -- baseline, 'multiple' = N x the baseline.
    ADD COLUMN IF NOT EXISTS baseline_amount     numeric,
    ADD COLUMN IF NOT EXISTS target_basis        text    NOT NULL DEFAULT 'absolute',
    ADD COLUMN IF NOT EXISTS target_amount       numeric,
    -- The transformation window. program_end_date is the deadline by which the
    -- run-rate impact has to be achieved; run_rate_year is the fiscal year that
    -- run rate is measured in (defaults to the end date's year in the UI).
    ADD COLUMN IF NOT EXISTS program_start_date  date,
    ADD COLUMN IF NOT EXISTS program_end_date    date,
    ADD COLUMN IF NOT EXISTS run_rate_year       integer,
    -- How often impact is measured and reported.
    ADD COLUMN IF NOT EXISTS reporting_cadence   text    NOT NULL DEFAULT 'monthly',
    -- The agent-compressed one-sentence objective. This is the root node of
    -- every hypothesis tree, so it is stored (and editable) rather than being
    -- regenerated per run: the user gets to approve the sentence the whole
    -- diagnosis hangs off before any agent time is spent on it.
    ADD COLUMN IF NOT EXISTS headline            text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS headline_source     text    NOT NULL DEFAULT 'agent',
    ADD COLUMN IF NOT EXISTS headline_at         timestamptz;

-- Values are validated in the API layer (Pydantic enums) rather than by CHECK
-- constraints, so adding a metric or a cadence later is a code change and not a
-- migration on every tenant database.


-- --- 2. the hypothesis tree as first-class rows ------------------------------

-- One node of one run's tree. Three kinds, in strict depth order:
--   objective   the root - the one-sentence objective (exactly one per run)
--   branch      a decomposition step: a MECE lever bucket. May nest.
--   initiative  a leaf - a concrete thing to do, with a card hanging off it.
CREATE TABLE IF NOT EXISTS hypothesis_nodes (
    id         bigserial   PRIMARY KEY,
    run_id     bigint      NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
    parent_id  bigint      REFERENCES hypothesis_nodes(id) ON DELETE CASCADE,
    kind       text        NOT NULL,                       -- objective | branch | initiative
    label      text        NOT NULL,                       -- the box caption
    -- Why this node exists at all. On a branch this is the chain-of-thought the
    -- tree is meant to make visible.
    rationale  text        NOT NULL DEFAULT '',
    -- Set on a PARENT: why its children are collectively exhaustive. Lives on
    -- the parent because exhaustiveness is a property of the whole split, not
    -- of any one child.
    mece_note  text        NOT NULL DEFAULT '',
    status     text        NOT NULL DEFAULT 'investigating', -- investigating | supported | needs_evidence | discarded
    sort_order integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hypothesis_nodes_run_idx
    ON hypothesis_nodes (run_id, parent_id, sort_order);

-- The facts a node stands on. `kind='objective'` rows record the program
-- parameters the root was derived from, so even the root's detail panel shows
-- its reasoning rather than appearing out of thin air.
CREATE TABLE IF NOT EXISTS hypothesis_evidence (
    id        bigserial PRIMARY KEY,
    node_id   bigint    NOT NULL REFERENCES hypothesis_nodes(id) ON DELETE CASCADE,
    text      text      NOT NULL,
    source    text,                                       -- display label, e.g. a filename
    page_path text,                                       -- links the fact back into the brain
    kind      text      NOT NULL DEFAULT 'fact'           -- fact | objective | assumption
);

CREATE INDEX IF NOT EXISTS hypothesis_evidence_node_idx
    ON hypothesis_evidence (node_id);

-- The card behind an initiative leaf. The five fields the card renders are:
-- the node's own `label` (name), plus context, sizing_approach,
-- what_must_be_true and next_steps here.
--
-- value_amount is a REAL NUMBER, not the pre-formatted "EUR 0.6M (est.)" string
-- the sizer used to emit — that is what lets initiatives be totalled against the
-- objective's target and shown as coverage.
CREATE TABLE IF NOT EXISTS initiative_cards (
    node_id           bigint      PRIMARY KEY REFERENCES hypothesis_nodes(id) ON DELETE CASCADE,
    context           text        NOT NULL DEFAULT '',    -- what is actually meant by this initiative
    sizing_approach   text        NOT NULL DEFAULT '',    -- how you would size it properly
    what_must_be_true jsonb       NOT NULL DEFAULT '[]'::jsonb,
    next_steps        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    value_amount      numeric,
    value_currency    text        NOT NULL DEFAULT 'EUR',
    value_type        text,                               -- recurring | one_time
    value_year        integer,                            -- the run-rate year the value holds in
    value_basis       text        NOT NULL DEFAULT '',    -- one sentence defending the number
    confidence        text,                               -- low | medium | high
    feasible_by_end   boolean,                            -- can it land before program_end_date
    updated_at        timestamptz NOT NULL DEFAULT now()
);
