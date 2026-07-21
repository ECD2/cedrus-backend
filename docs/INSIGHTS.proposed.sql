-- ============================================================================
-- INSIGHTS.proposed.sql   (PROPOSED — NOT EXECUTED, and NOT required)
--
-- Finding: the Insight Engine (src/services/insights.js) needs NO structural
-- schema change. The "last touch" signal it ranks on already exists —
-- people.last_contact_at (freshened by the contact_events trigger) surfaced as
-- v_agent_person_context.days_since_contact, alongside relationship_health_score
-- — and every other signal (birthdays on people, saved_items.event_date,
-- facts.created_at, reminders, pending_prompts, user_goals) reads an existing
-- table/view. So there is nothing here the feature DEPENDS on.
--
-- The two statements below are an OPTIONAL performance nicety for the only two
-- NEW per-person reads the engine adds (getOpenRemindersForUser,
-- getOpenPromptsForUser). They are partial indexes matching those exact query
-- predicates. Add them only if those reads get hot on real data.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the
--     Supabase ceremony. Committed for review only; this worktree ran nothing.
--   * CREATE INDEX IF NOT EXISTS is idempotent. Consider CONCURRENTLY in prod
--     (cannot run inside a transaction block; run each statement on its own).
--   * Confirm the referenced columns exist before running; adjust names to match
--     the live schema if they differ.
-- ============================================================================

-- getOpenRemindersForUser():
--   reminders WHERE user_id = $1 AND status = 'pending' AND person_id IS NOT NULL
--   ORDER BY trigger_at
CREATE INDEX IF NOT EXISTS idx_reminders_open_by_user
  ON reminders (user_id, trigger_at)
  WHERE status = 'pending' AND person_id IS NOT NULL;

-- getOpenPromptsForUser():
--   pending_prompts WHERE user_id = $1 AND status = 'open' AND person_id IS NOT NULL
--   ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_pending_prompts_open_by_user
  ON pending_prompts (user_id, created_at)
  WHERE status = 'open' AND person_id IS NOT NULL;
