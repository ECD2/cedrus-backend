-- ============================================================================
-- GOALS.proposed.sql   (PROPOSED — NOT EXECUTED)
--
-- INFRA-15 user-set goals (src/services/goals.js, src/routes/api/goals.js).
-- This EXTENDS the existing user_goals table — it does NOT create a second
-- goals store. Two populations share user_goals: the pipeline's weekly
-- reach-out INTENTIONS (origin='cedrus_inferred', status='open', written by
-- memory.addGoal) and the user's standing GOALS added here
-- (origin='user_set', status='active').
--
-- Unlike docs/INSIGHTS.proposed.sql, the column adds below are REQUIRED: the
-- goals route writes origin / priority / updated_at and inserts week_of=NULL,
-- and it stores status='active'. Until this runs, POST/PATCH /api/goals will
-- fail. The two INTENTION reads (memory.getOpenGoals / getOpenGoalsThisWeek)
-- are untouched — they filter status='open', so a user-set 'active' row is
-- invisible to them, and to the brief/insights/discovery that consume them.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the
--     Supabase ceremony. Committed for review only; this worktree ran nothing.
--   * ADD COLUMN IF NOT EXISTS and DROP NOT NULL are idempotent. Re-running is
--     safe. Confirm the live column/constraint names before running; adjust to
--     match if they differ.
--   * Apply this BEFORE the /api/goals router is mounted and serving traffic.
-- ============================================================================

-- ── 1. REQUIRED columns ─────────────────────────────────────────────────────
-- origin partitions the two populations. Existing rows default to
-- 'cedrus_inferred' (correct — they are the pipeline's intentions).
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'cedrus_inferred';

-- priority is the user's importance signal; the deterministic "vital few"
-- ranking leads on it (priority desc, then created_at asc, then id asc).
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

-- updated_at is stamped by the goals route on add + every edit.
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- ── 2. REQUIRED: week_of must be nullable ───────────────────────────────────
-- A user-set goal is a standing goal, not a weekly intention, so the route
-- inserts week_of = NULL. If week_of is currently NOT NULL, drop that. (If it
-- is already nullable this is a harmless no-op.)
ALTER TABLE user_goals
  ALTER COLUMN week_of DROP NOT NULL;

-- ── 3. REQUIRED-IF-PRESENT: status must allow 'active' ──────────────────────
-- User-set goals live at status='active' (deliberately NOT 'open', so the
-- weekly-intention reads exclude them by construction). If a CHECK constraint
-- currently restricts user_goals.status to ('open','completed'), widen it.
--
-- First find any such constraint's name:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'user_goals'::regclass AND contype = 'c'
--     AND pg_get_constraintdef(oid) ILIKE '%status%';
--
-- Then, IF one exists, drop it and add the widened one (adjust OLD_NAME to the
-- conname you found):
--
--   ALTER TABLE user_goals DROP CONSTRAINT IF EXISTS OLD_NAME;
--
-- Add the widened constraint idempotently (safe whether or not an old one
-- existed). 'active' and 'completed' are the user-set lifecycle; 'open' stays
-- for the inferred intentions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_goals'::regclass AND conname = 'user_goals_status_allowed'
  ) THEN
    ALTER TABLE user_goals
      ADD CONSTRAINT user_goals_status_allowed
      CHECK (status IN ('open', 'completed', 'active'));
  END IF;
END $$;

-- ── 4. OPTIONAL performance nicety (add only if the read gets hot) ───────────
-- listGoals() / getVitalFew():
--   user_goals WHERE user_id = $1 AND origin = 'user_set' [AND status = 'active']
-- A partial index matching the active user-set read. At beta scale this is not
-- needed; add it only if a user accrues many goals and the scan shows up.
CREATE INDEX IF NOT EXISTS idx_user_goals_user_set_active
  ON user_goals (user_id)
  WHERE origin = 'user_set' AND status = 'active';
