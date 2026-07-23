-- ============================================================================
-- ENTITY_RESOLUTION_LAST_INITIAL.proposed.sql   (PROPOSED — NOT EXECUTED)
--
-- Phase 2b of docs/ENTITY_RESOLUTION_V2.md — same-first-name disambiguation.
-- Adds people.last_initial: a nullable, short disambiguating label ("N." for a
-- stated surname, else a short context tag) rendered by people.displayName as
-- "Luca N." ONLY when the user has a first-name collision. The canonical
-- people.name is NEVER mutated — this column is display/matching metadata.
--
-- Assigned LAZILY, on collision (docs §3 / decision 4): the day a second same-
-- first-name person is created, both twins get a last_initial; single-"Luca"
-- users have it null forever. This migration only opens the column; the
-- derivation lives in code (people.js).
--
-- Independent of Phase 2a: bare-name disambiguation already works without this
-- column (it falls back to relationship tags); the column makes those questions
-- and every name render read cleaner. Ship after 2a.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the Supabase
--     ceremony. Committed for review only; this worktree ran nothing.
--   * ADD COLUMN IF NOT EXISTS is idempotent; adding a nullable column is a
--     metadata-only change (no table rewrite, no default backfill).
--   * Confirm people(user_id, name, is_self) exist as referenced before running;
--     adjust names to match the live schema if they differ.
--   * If the project has an "active person" flag/status, add it to the optional
--     index predicate below (the collision check reads active, non-self people).
-- ============================================================================

-- (1) The disambiguator. Normally a single letter + '.', but text (not char(2))
--     so the §3 fallback can store a short context tag when no surname is known.
--     The light length guard keeps it label-sized, never a second name.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS last_initial text
    CONSTRAINT people_last_initial_len
    CHECK (last_initial IS NULL OR char_length(last_initial) <= 24);

-- (2) OPTIONAL — speed up the first-name collision check that displayName and the
--     lazy-assignment path run (the user's active, non-self people by normalized
--     name). Add only if that read gets hot on real data.
--     If people has an is-active/status column, AND it into the predicate.
CREATE INDEX IF NOT EXISTS idx_people_user_firstname
  ON people (user_id, lower(name))
  WHERE is_self = false;

-- ----------------------------------------------------------------------------
-- Explicitly NOT proposed here:
--   * No backfill. Labels are derived lazily on the next collision (docs §3);
--     existing single-name people correctly stay unlabeled. A one-time backfill
--     for users who ALREADY have two same-first-name people is an optional
--     follow-up script, not a migration.
--   * No change to people.name. The real name is authoritative and untouched;
--     last_initial is display/matching metadata only.
--   * No people.birthday_year (out of scope; the engines use month/day, which
--     already exist and are populated in Phase 1).
-- ----------------------------------------------------------------------------
