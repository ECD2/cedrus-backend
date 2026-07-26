-- ============================================================================
-- INTERESTS.proposed.sql   (PROPOSED — NOT EXECUTED)
--
-- Finding: the interests read-path is BLOCKED in prod because the `interests`
-- table does not exist. The contract calls it the N5 table created by migration
-- 20260719120002_interests_foundation.sql "already live" (docs/INTERESTS_CONTRACT
-- .md §preamble; docs/MOUNT_SOURCES.md), but that migration is NOT in this repo
-- and the table is absent in prod, so every read through interests.listInterests
-- (the /api/interests GET, and the discovery gather) errors on a missing relation.
--
-- This file reconstructs that foundation table from the two sources that DO
-- pin its shape exactly:
--   * src/services/interests.js — the only writer/reader; the CHECK vocabularies,
--     the (user_id, category, lower(label)) unique identity the re-affirm/race
--     path depends on (23505 handling), the label 1..200 rule it calls
--     `interests_label_length`, the server-owned `confidence` column, and the
--     insert whose values it documents as "identical to the DB defaults".
--   * docs/INTERESTS_CONTRACT.md — the public Interest type, the seven-value
--     category vocabulary ("the live N5 CHECK constraint"), the three
--     surfacing_states, the two provenances, and the browser-read posture.
--
-- REQUIRED vs OPTIONAL in this file:
--   * REQUIRED (the backend genuinely depends on these to stop erroring): the
--     table, its column CHECKs, and the UNIQUE (user_id, category, lower(label))
--     index. Create these and the read-path works.
--   * SECURITY (browser-facing): RLS + a column-scoped grant, because unlike the
--     backend-only tables (e.g. pending_clarifications) the contract promises the
--     browser's own Supabase client can READ this table (its own rows only) and
--     must NOT see `confidence`. Reconstructed here; the row-ownership expression
--     needs one confirmation against the live identity model — see notes.
--   * OPTIONAL: the active-interest read index (also proposed, identically and
--     idempotently, in docs/DISCOVERY.proposed.sql).
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the Supabase
--     ceremony. Committed for review only; this worktree ran nothing.
--   * gen_random_uuid() is the Supabase/pgcrypto default on PG13+. If this
--     project seeds uuids with uuid_generate_v4() (uuid-ossp), swap it to match.
--   * IF NOT EXISTS makes the table + indexes idempotent (safe to re-run). A
--     brand-new table is empty, so plain CREATE INDEX is fine (no CONCURRENTLY
--     needed). The policy uses DROP POLICY IF EXISTS + CREATE so the RLS block is
--     re-runnable too.
--   * FK target assumes app_users(id). Confirm that table/column against the live
--     schema before running; adjust if it differs.
--   * RECONSTRUCTED, NOT COPIED: no original migration file exists to diff
--     against. If a prior definition of `interests` ever shipped to any
--     environment, reconcile column/constraint NAMES with it before running so a
--     future ceremony does not fork on constraint identity.
--   * IDENTITY (load-bearing for the RLS policy): interests.user_id is the Cedrus
--     account id = app_users.id, which is NOT the Supabase auth uid. requireUser
--     maps the JWT via app_users.auth_user_id (src/routes/api/auth.js). So the
--     row-ownership predicate must reach through app_users — a bare
--     `user_id = auth.uid()` would match nothing and silently empty every browser
--     read. Mirror whatever the existing browser-readable tables (facts, people,
--     dunbar_tier) already use; the through-app_users form below is written to
--     that identity model, but confirm it matches the live policies at the
--     ceremony.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- interests — one row per interest the user has confirmed (teams, shows,
-- hobbies, places, food, freeform). A row exists only after a confirming action
-- (confirmed-only rule); an explicit add through /api/interests IS that
-- confirmation and writes provenance='user_stated'. Identity is
-- (user_id, category, lower(label)); a re-stated interest re-affirms in place
-- rather than duplicating.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

  -- Closed vocabulary. Mirrors interests.INTEREST_CATEGORIES exactly; the
  -- contract calls this "the live N5 CHECK constraint". Widen only by migration.
  category          text NOT NULL
                      CONSTRAINT interests_category_check
                      CHECK (category IN (
                        'sports_team', 'hobby', 'media_show', 'media_music',
                        'food', 'place', 'other_freeform'
                      )),

  -- Display string. The API trims then enforces 1..200 chars (MAX_LABEL_CHARS);
  -- the CHECK re-states that on the trimmed value as a DB-level backstop, and is
  -- named to match the code comment (`interests_label_length`).
  label             text NOT NULL
                      CONSTRAINT interests_label_length
                      CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),

  -- user_stated = told Cedrus directly (every add via this API); inferred_confirmed
  -- = Cedrus guessed and the user confirmed via the capture flow. Default matches
  -- the API insert (interests.js documents its inserts as equal to the DB defaults).
  provenance        text NOT NULL DEFAULT 'user_stated'
                      CONSTRAINT interests_provenance_check
                      CHECK (provenance IN ('user_stated', 'inferred_confirmed')),

  -- Internal ranking signal only. NEVER serialized (toPublic omits it) and hidden
  -- from authenticated SELECT by the grant below. The API only ever writes 1.0;
  -- the codebase clamps confidence to [0,1] everywhere (clamp01), so the range
  -- CHECK matches that convention — relax it if the live column was unconstrained.
  confidence        real NOT NULL DEFAULT 1.0
                      CONSTRAINT interests_confidence_range
                      CHECK (confidence >= 0 AND confidence <= 1),

  -- active = surfacing; off = user silenced it (kept, not deleted); resting =
  -- reserved for a future quiet-retirement sweep (schema-legal, never written by
  -- the API). list() returns active-only unless asked, so consumers honor the
  -- opt-out by construction.
  surfacing_state   text NOT NULL DEFAULT 'active'
                      CONSTRAINT interests_surfacing_state_check
                      CHECK (surfacing_state IN ('active', 'resting', 'off')),

  last_affirmed_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- (1) REQUIRED — the (user, category, lower(label)) identity. This is the index
--     the service's re-affirm path and its raced-insert recovery both rely on
--     (Postgres 23505 → treat as a re-affirmation). Functional (lower(label)),
--     matching interests.findByLoweredLabel + the unique-violation handling.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interests_user_category_label
  ON interests (user_id, category, lower(label));

-- (2) OPTIONAL — the active-only list read (listInterests default, and the
--     discovery gather): interests WHERE user_id = $1 AND surfacing_state =
--     'active' ORDER BY created_at. Identical statement to the one in
--     docs/DISCOVERY.proposed.sql; both are IF NOT EXISTS so running either or
--     both is safe. Add if that read gets hot on real data.
CREATE INDEX IF NOT EXISTS idx_interests_active_by_user
  ON interests (user_id, created_at)
  WHERE surfacing_state = 'active';

-- ----------------------------------------------------------------------------
-- Row-level security + grants (browser-facing table).
--
-- The backend writes/reads with the service role, which BYPASSES RLS, so none
-- of this is needed for /api/interests to function. It exists to make the
-- contract's promise true and safe: the browser's own Supabase client may READ
-- this table (its OWN rows only) and must never see `confidence`. Without RLS a
-- direct anon/authenticated query would expose every user's interests; without
-- the column grant it would expose the internal confidence signal.
--
-- Ownership predicate: see the IDENTITY note in the header. interests.user_id =
-- app_users.id, mapped from the JWT via app_users.auth_user_id — NOT auth.uid()
-- directly. CONFIRMED against the live schema (2026-07-25): public.facts and
-- public.people both express exactly this mapping through the house helper
-- public.user_owns_app_user(uuid) — a STABLE SECURITY DEFINER function that does
-- `exists (select 1 from app_users u where u.id = $1 and u.auth_user_id = auth.uid())`.
-- We reuse the helper rather than an inline subquery: being SECURITY DEFINER it
-- resolves the mapping without requiring the authenticated role to read app_users
-- under its own RLS, and it keeps one definition of ownership across all tables.
-- (facts/people scope theirs FOR ALL; ours is deliberately FOR SELECT only.)
-- ----------------------------------------------------------------------------
ALTER TABLE interests ENABLE ROW LEVEL SECURITY;

-- Read-your-own only. No INSERT/UPDATE/DELETE policy by design: all writes go
-- through the service role (contract §preamble, "browser ... is read-only").
DROP POLICY IF EXISTS interests_select_own ON interests;
CREATE POLICY interests_select_own ON interests
  FOR SELECT
  TO authenticated
  USING (
    user_owns_app_user(user_id)
  );

-- Hide `confidence` from the browser: grant column-scoped SELECT on everything
-- BUT confidence. (RLS still restricts WHICH rows; this restricts WHICH columns.)
REVOKE ALL ON interests FROM authenticated;
GRANT SELECT (
  id, user_id, category, label, provenance,
  surfacing_state, last_affirmed_at, created_at, updated_at
) ON interests TO authenticated;

-- ----------------------------------------------------------------------------
-- Explicitly NOT proposed here:
--   * No updated_at trigger. The service sets updated_at on every insert/update
--     explicitly, and the browser cannot write, so there is no un-stamped write
--     path today. Add a moddatetime/BEFORE UPDATE trigger only if a non-service
--     writer is ever introduced.
--   * No INSERT/UPDATE/DELETE grant or policy to authenticated. Writes are
--     service-role only, by contract. A future "let the browser write directly"
--     decision would add those; it is out of scope for restoring the read-path.
--   * No seed/backfill. The table starts empty; the warm empty state ("tell
--     Cedrus your teams") is the product surface's to render.
--   * No app_users.home_location and no broader/covering index — those live in
--     docs/DISCOVERY.proposed.sql (the location hook + the active-read index),
--     not duplicated here beyond the one shared active-read index above.
--   * No change to interests.js. The service already matches this schema; the
--     only read-path code change this cycle is the discovery gather degrading
--     gracefully when this table is still absent (see docs/INTERESTS_READPATH_
--     AUDIT.md) — a call-site catch, not a schema dependency.
-- ----------------------------------------------------------------------------
