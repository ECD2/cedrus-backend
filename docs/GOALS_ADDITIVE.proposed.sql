-- ============================================================================
-- INFRA-15 goals foundation — ADDITIVE-ONLY schema for user-set goals.
--
-- This SUPERSEDES the wider docs/GOALS.proposed.sql from the station branch.
-- That file also dropped week_of's NOT NULL and swapped the status CHECK to
-- admit 'active'. Both were dropped after analysis: the isolation guarantee
-- they were meant to protect is enforced by `origin`, not by `status`
-- (goals.js scopes all six of its statements with .eq('origin','user_set')),
-- so widening a live CHECK bought a redundant second encoding. The code
-- conforms to the existing schema instead — see the conform commit.
--
-- ADDITIVE AND IDEMPOTENT:
--   * Two ADD COLUMN IF NOT EXISTS. Re-running is a no-op.
--   * No column is dropped, retyped, or made nullable.
--   * No constraint is dropped, added, or altered. user_goals_status_check
--     keeps its existing domain (open/completed/missed/canceled) untouched.
--   * No row is inserted, updated, or deleted. Existing rows acquire
--     origin='cedrus_inferred' from the DEFAULT, which is the correct label:
--     every pre-existing row is a pipeline-inferred weekly intention.
--   * On PostgreSQL 11+ (live: 17.6) ADD COLUMN ... NOT NULL DEFAULT stores
--     the default in the catalog rather than rewriting the table, so this is
--     fast and does not hold a long lock.
--
-- Nothing else in user_goals is touched: week_of stays NOT NULL (the route
-- populates it with the creation week, which also keeps a NULL week_of from
-- sorting first under getOpenGoals' `ORDER BY week_of DESC` — Postgres puts
-- NULLS FIRST on DESC).
-- ============================================================================

-- origin partitions the two populations: 'cedrus_inferred' (the pipeline's
-- weekly intentions, read by memory.getOpenGoals / getOpenGoalsThisWeek) and
-- 'user_set' (standing goals owned by the /api/goals route). This column is
-- the isolation boundary in BOTH directions.
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'cedrus_inferred';

-- priority is the user's importance signal; the deterministic "vital few"
-- ranking leads on it (priority desc, then created_at asc, then id asc).
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
