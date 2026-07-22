-- ============================================================================
-- DISCOVERY.proposed.sql   (PROPOSED — NOT EXECUTED, and NOT required)
--
-- Finding: the Discovery Planner (src/services/discovery.js) needs NO structural
-- schema change to function. Every datum it plans over already exists — interests
-- (interests.listInterests), open goals (user_goals via memory.getOpenGoals),
-- upcoming birthdays (people.birthday_month/day), and saved-item dates
-- (saved_items.event_date via v_agent_person_context). The planner already falls
-- back gracefully when a signal is missing, so there is nothing here the feature
-- DEPENDS on.
--
-- The two items below are OPTIONAL enhancements, not dependencies:
--
--   (1) app_users.home_location — a forward-looking column so a local lookup's
--       `near` can be localized from a stated home base, not only from a `place`
--       interest. discovery.js already reads it through an injectable location
--       hook (defaultUserLocation), so the day this column lands, `near`
--       resolution improves with a ONE-LINE change to that hook and zero change
--       to the planning core. Until then `near` falls back to a `place` interest
--       or null — never fabricated.
--
--   (2) idx_interests_active_by_user — a partial index matching the planner's
--       active-interest read predicate. A performance nicety only; add it if that
--       read gets hot on real data.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the Supabase
--     ceremony. Committed for review only; this worktree ran nothing.
--   * CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS are idempotent.
--     Consider CONCURRENTLY for the index in prod (cannot run inside a transaction
--     block; run each statement on its own).
--   * Confirm the referenced columns exist before running; adjust names to match
--     the live schema if they differ.
--   * A `place` here is a free-text label (e.g. "Miami"). No geocoding is implied
--     or required — the planner passes the string through to a later executor.
-- ============================================================================

-- (1) Forward-looking home base for local-lookup `near` resolution.
--     Optional: discovery.js resolves `near` from opts.location, then this
--     column, then the freshest `place` interest, then null.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS home_location text;

-- (2) discovery gather's interest read (interests.listInterests, active-only):
--       interests WHERE user_id = $1 AND surfacing_state = 'active'
--       ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_interests_active_by_user
  ON interests (user_id, created_at)
  WHERE surfacing_state = 'active';

-- ----------------------------------------------------------------------------
-- Explicitly NOT proposed here:
--   * No discovery_plans / lookup-cache table. Plans are computed on read and
--     are cheap + deterministic; persisting them is a future decision (it would
--     also mean deciding a retention policy for the derived plan), out of scope
--     for this inert planner. Flagged, not invented.
-- ----------------------------------------------------------------------------
