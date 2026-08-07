-- 0033_run_objective_snapshot.sql
-- ---------------------------------------------------------------------------
-- Freeze the objective a run was scored against, onto the run itself.
--
-- The coverage bar ("initiatives sized at X of the Y target") divides by the
-- program's goal. If that denominator is read live from objective_function,
-- editing the target silently rewrites what a COMPLETED run is claimed to have
-- covered — the same tree suddenly covers 40% instead of 60% because someone
-- moved the goalpost afterwards. Snapshotting the objective at run start keeps a
-- finished run's arithmetic true to the program it was actually run against.
-- ---------------------------------------------------------------------------

ALTER TABLE swarm_runs
    ADD COLUMN IF NOT EXISTS objective_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
