-- 0035_keep_intervention_history.sql
-- ---------------------------------------------------------------------------
-- Keep a reviewer's words after the node they were about has gone.
--
-- 0034 pointed node_interventions.node_id at hypothesis_nodes ON DELETE CASCADE.
-- That is wrong for this table: giving feedback on a branch rebuilds its whole
-- subtree, which DELETEs the children — and the cascade then silently destroyed
-- the record of every discard made further down. Requiring a reason for a
-- discard is pointless if a later edit upstream can erase it.
--
-- The intervention is now the durable thing and the node reference is the
-- disposable one: the row survives with the label of what it was about, so the
-- review history of a run still reads end to end.
-- ---------------------------------------------------------------------------

ALTER TABLE node_interventions
    DROP CONSTRAINT IF EXISTS node_interventions_node_id_fkey;

ALTER TABLE node_interventions
    ALTER COLUMN node_id DROP NOT NULL;

ALTER TABLE node_interventions
    ADD CONSTRAINT node_interventions_node_id_fkey
    FOREIGN KEY (node_id) REFERENCES hypothesis_nodes(id) ON DELETE SET NULL;

-- What the comment was about, captured at the time. Without this a surviving
-- row whose node is gone reads as a comment about nothing.
ALTER TABLE node_interventions
    ADD COLUMN IF NOT EXISTS node_label text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS node_kind  text NOT NULL DEFAULT '';

UPDATE node_interventions i
   SET node_label = n.label, node_kind = n.kind
  FROM hypothesis_nodes n
 WHERE n.id = i.node_id AND i.node_label = '';
