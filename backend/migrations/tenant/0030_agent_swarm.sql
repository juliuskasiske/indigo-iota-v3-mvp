-- 0030_agent_swarm.sql
-- ---------------------------------------------------------------------------
-- The agent swarm: a startable/stoppable loop of agents that read the brain
-- and investigate where value is leaking. A `swarm_runs` row is one start→stop
-- session; `agent_events` is the append-only log of everything the agents do.
-- The Overview renders both a live event log and a hypothesis tree from these
-- events (kind='node' builds the tree, kind='fact' hangs evidence off a node,
-- every row carries a human-readable `message` for the log feed).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swarm_runs (
    id          bigserial PRIMARY KEY,
    status      text        NOT NULL DEFAULT 'running',   -- running | stopped
    started_at  timestamptz NOT NULL DEFAULT now(),
    stopped_at  timestamptz
);

CREATE TABLE IF NOT EXISTS agent_events (
    id         bigserial   PRIMARY KEY,
    run_id     bigint      NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
    ts         timestamptz NOT NULL DEFAULT now(),
    role       text        NOT NULL,          -- system|hypothesis|planning|validator|sizer|judge
    kind       text        NOT NULL,          -- log | node | fact
    message    text        NOT NULL,          -- human-readable log line (always set)
    node_id    text,                          -- stable id of a tree node (node/fact)
    parent_id  text,                          -- parent node id
    label      text,                          -- node label / fact text
    metric     text,                          -- number badge
    source     text,                          -- fact source
    status     text                           -- node status: investigating|supported|discarded|needs_evidence
);

CREATE INDEX IF NOT EXISTS agent_events_run_idx ON agent_events (run_id, id);
