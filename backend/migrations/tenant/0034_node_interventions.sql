-- 0034_node_interventions.sql
-- ---------------------------------------------------------------------------
-- Human steering of the hypothesis tree. Two things a reviewer can do to any
-- node, both of which make the agents go again on that part of the tree:
--
--   discard   "this is wrong, and here is why". The node and everything under
--             it are marked discarded — kept, not deleted, so the reasoning
--             stays auditable and the agents can be told what NOT to repeat —
--             and a replacement is generated as a sibling.
--
--   feedback  "this is roughly right, but…". The node is revised in place and
--             its subtree is rebuilt with the note in context. Nothing is
--             marked discarded here: the reviewer is steering, not rejecting,
--             and leaving the superseded children around as tombstones would
--             bury the tree in clutter.
--
-- One row per act of steering, so a node's review history reads back in order
-- and every regenerated branch can be traced to the sentence that caused it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS node_interventions (
    id                  bigserial   PRIMARY KEY,
    run_id              bigint      NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
    -- The node the reviewer acted on. Kept even after a discard, so the comment
    -- stays attached to the thing it was about.
    node_id             bigint      NOT NULL REFERENCES hypothesis_nodes(id) ON DELETE CASCADE,
    kind                text        NOT NULL,                 -- discard | feedback
    comment             text        NOT NULL,                 -- why: required, never blank
    actor               text        NOT NULL DEFAULT '',
    -- pending while the agents are redoing that part of the tree; the UI keeps
    -- polling on this rather than on the swarm's own running flag, because an
    -- intervention is not a full pass.
    status              text        NOT NULL DEFAULT 'pending', -- pending | applied | failed
    error               text        NOT NULL DEFAULT '',
    -- What the agents produced in response: the replacement node after a
    -- discard, or the revised node itself after feedback.
    replacement_node_id bigint      REFERENCES hypothesis_nodes(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    applied_at          timestamptz
);

CREATE INDEX IF NOT EXISTS node_interventions_node_idx
    ON node_interventions (node_id, id);

-- The UI polls "is anything still regenerating" per run, so index that path.
CREATE INDEX IF NOT EXISTS node_interventions_pending_idx
    ON node_interventions (run_id) WHERE status = 'pending';

-- Why a node was discarded, denormalised onto the node so the canvas can show
-- it without joining, and so the agents building a replacement can be handed
-- "do not repeat this, the reviewer rejected it because…" in one read.
ALTER TABLE hypothesis_nodes
    ADD COLUMN IF NOT EXISTS discard_reason text NOT NULL DEFAULT '';
