-- Budget guard kill switch (night build 2026-07-28, item 1).
-- Additive + idempotent; table name unqualified (run-migration.mjs regex).
-- Runner-verifiable: declares one CREATE TABLE, nothing the runner can't check.
--
-- One row per operational flag. The budget guard owns key='budget_kill_switch';
-- value is the guard's full verdict payload (active, reason, usage, budgets,
-- checked_at) so Emil can read WHY it tripped straight from the row.
--
-- NOT APPLIED by the overnight session (doctrine Law 5: no migrations without
-- explicit go). Apply through the runner at the morning ceremony, BEFORE the
-- code merge deploys (Lesson 6: schema before code). The code fails open with
-- quota.read.failed logging if this table is missing, so ordering the other way
-- degrades loudly rather than breaking — but do it schema-first anyway.

CREATE TABLE IF NOT EXISTS system_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
