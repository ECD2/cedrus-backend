-- Founding-member status (night build 2026-07-28, item 4; spec PART 4).
-- Additive + idempotent; unqualified table name (run-migration.mjs regex).
-- NOT APPLIED by the overnight session (Law 5). Apply at the morning ceremony.
--
-- ADD COLUMN with a DEFAULT fills EXISTING rows with 'founding' (Postgres 11+),
-- so "set for all existing users" is satisfied by this one additive DDL — no
-- data-write script, nothing for the runner to mis-verify. Every new signup in
-- V1 is also a Founding Member (that is the era we are in; PART 4), so the
-- default is correct for inserts too. The plan/billing columns are untouched.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS member_status text NOT NULL DEFAULT 'founding';
