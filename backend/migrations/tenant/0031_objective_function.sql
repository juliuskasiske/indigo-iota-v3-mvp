-- 0031_objective_function.sql
-- ---------------------------------------------------------------------------
-- The objective function set on the Objectives tab: the ranked balanced-scorecard
-- levers the agents optimize for, plus free-text context. One singleton row per
-- tenant brain. The agent swarm reads this to steer hypothesis generation,
-- sizing, and judgement.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS objective_function (
    id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    priorities  jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{id,label,bucket,rank}]
    context     text        NOT NULL DEFAULT '',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO objective_function (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
