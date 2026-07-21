-- ============================================================================
-- REL_STATUS_RECONCILE.proposed.sql   (PROPOSED — NOT EXECUTED)
--
-- Purpose
--   Collapse pre-existing SPLIT / CONTRADICTORY person facts that were written
--   before the canonical fact-slot registry landed in src/services/memory.js.
--   Symptom in production: one person carries TWO current facts about the same
--   real-world attribute under different keys — e.g.
--       relationship        = 'girlfriend'     (is_current = true)
--       relationship_status  = 'ex-girlfriend'  (is_current = true)
--   Contradictory memory undermines the product ("the one who remembers").
--
--   New writes can no longer create this: memory.addFact() canonicalizes the
--   key and retires prior values for single-valued slots, and the historical
--   import path shares the SAME registry (memory.SINGLE_VALUED_KEYS). This
--   script is a ONE-TIME cleanup of rows that predate that guarantee.
--
-- Canonical registry (MUST mirror src/services/memory.js — the single source
-- of truth). If you extend FACT_KEY_ALIASES / SINGLE_VALUED_KEYS in code, mirror
-- the change in the two CASE blocks and the single-valued list below.
--   ALIASES  -> canonical (kept in lockstep with FACT_KEY_ALIASES in code):
--     relationship_status, relationship_type, relationship_to_user,
--     relationship_to_me, status                                   -> relationship
--     location, home, lives_in, residence                          -> city
--     work, employer, career, occupation, profession, workplace,
--     company                                                      -> job
--   SINGLE-VALUED canonical slots (one current value per person):
--     relationship, job, city, mood
--   NOTE: 'status' is the one mildly generic alias — the extraction prompt uses
--   it ONLY for relationship, but eyeball the section-0 pre-flight before running
--   in case a legacy row filed something else under 'status'.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the
--     Supabase ceremony. This file is committed for review only.
--   * IDEMPOTENT: re-running is a no-op once reconciled (every guard below only
--     touches rows that are still split / still aliased / still out of sync).
--   * Wrapped in a single transaction so it is all-or-nothing.
--   * Recency signal is facts.created_at (with id DESC as a stable tie-break).
--     Confirm facts.created_at exists in your schema before running; if it does
--     not, substitute the correct timestamp column in the ORDER BY.
--   * Assumes columns:
--       facts(id, user_id, person_id, fact_key, fact_value,
--             is_current, ended_at, ended_reason, created_at)
--       people(id, user_id, relationship)
--   * "Latest stated value wins": among the split current rows, the most
--     recently created survives; the rest are retired (never deleted), so the
--     audit trail is preserved exactly as memory.addFact() would leave it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PRE-FLIGHT (READ-ONLY): how many people still hold a split single-valued
--    slot? Run this first; expect the count to drop to 0 after the migration.
-- ----------------------------------------------------------------------------
-- WITH canon AS (
--   SELECT user_id, person_id,
--     CASE lower(btrim(fact_key))
--       WHEN 'relationship_status'  THEN 'relationship'
--       WHEN 'relationship_type'    THEN 'relationship'
--       WHEN 'relationship_to_user' THEN 'relationship'
--       WHEN 'relationship_to_me'   THEN 'relationship'
--       WHEN 'status'               THEN 'relationship'
--       WHEN 'location'   THEN 'city'
--       WHEN 'home'       THEN 'city'
--       WHEN 'lives_in'   THEN 'city'
--       WHEN 'residence'  THEN 'city'
--       WHEN 'work'       THEN 'job'
--       WHEN 'employer'   THEN 'job'
--       WHEN 'career'     THEN 'job'
--       WHEN 'occupation' THEN 'job'
--       WHEN 'profession' THEN 'job'
--       WHEN 'workplace'  THEN 'job'
--       WHEN 'company'    THEN 'job'
--       ELSE lower(btrim(fact_key))
--     END AS canonical_key
--   FROM facts
--   WHERE is_current = true
-- )
-- SELECT canonical_key, count(*) AS split_groups
-- FROM (
--   SELECT user_id, person_id, canonical_key
--   FROM canon
--   WHERE canonical_key IN ('relationship','job','city','mood')
--   GROUP BY user_id, person_id, canonical_key
--   HAVING count(*) > 1
-- ) g
-- GROUP BY canonical_key
-- ORDER BY canonical_key;

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RETIRE the losers. For every (user, person, canonical single-valued slot)
--    that has more than one current row, keep the most recent and retire the
--    rest — exactly what memory.addFact() does on write. Grouping is done on the
--    CANONICAL key, so a 'relationship' row and a 'relationship_status' row are
--    recognized as the same slot even though their stored keys differ.
-- ----------------------------------------------------------------------------
WITH canon AS (
  SELECT
    id, user_id, person_id, created_at,
    CASE lower(btrim(fact_key))
      WHEN 'relationship_status'  THEN 'relationship'
      WHEN 'relationship_type'    THEN 'relationship'
      WHEN 'relationship_to_user' THEN 'relationship'
      WHEN 'relationship_to_me'   THEN 'relationship'
      WHEN 'status'               THEN 'relationship'
      WHEN 'location'   THEN 'city'
      WHEN 'home'       THEN 'city'
      WHEN 'lives_in'   THEN 'city'
      WHEN 'residence'  THEN 'city'
      WHEN 'work'       THEN 'job'
      WHEN 'employer'   THEN 'job'
      WHEN 'career'     THEN 'job'
      WHEN 'occupation' THEN 'job'
      WHEN 'profession' THEN 'job'
      WHEN 'workplace'  THEN 'job'
      WHEN 'company'    THEN 'job'
      ELSE lower(btrim(fact_key))
    END AS canonical_key
  FROM facts
  WHERE is_current = true
),
ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, person_id, canonical_key
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM canon
  WHERE canonical_key IN ('relationship', 'job', 'city', 'mood')
)
UPDATE facts f
SET is_current  = false,
    ended_at    = COALESCE(f.ended_at, now()),
    ended_reason = COALESCE(f.ended_reason, 'superseded_backfill')
FROM ranked r
WHERE f.id = r.id
  AND r.rn > 1;          -- keep rn = 1 (latest); retire everything older

-- ----------------------------------------------------------------------------
-- 2. CANONICALIZE the survivor. Any still-current row written under an alias key
--    is rewritten to its canonical key, so every current fact sits under the one
--    canonical slot. Step 1 already guaranteed at most one current row per
--    (user, person, canonical slot), so this rename cannot collide.
-- ----------------------------------------------------------------------------
UPDATE facts
SET fact_key = CASE lower(btrim(fact_key))
      WHEN 'relationship_status'  THEN 'relationship'
      WHEN 'relationship_type'    THEN 'relationship'
      WHEN 'relationship_to_user' THEN 'relationship'
      WHEN 'relationship_to_me'   THEN 'relationship'
      WHEN 'status'               THEN 'relationship'
      WHEN 'location'   THEN 'city'
      WHEN 'home'       THEN 'city'
      WHEN 'lives_in'   THEN 'city'
      WHEN 'residence'  THEN 'city'
      WHEN 'work'       THEN 'job'
      WHEN 'employer'   THEN 'job'
      WHEN 'career'     THEN 'job'
      WHEN 'occupation' THEN 'job'
      WHEN 'profession' THEN 'job'
      WHEN 'workplace'  THEN 'job'
      WHEN 'company'    THEN 'job'
      ELSE fact_key
    END
WHERE is_current = true
  AND lower(btrim(fact_key)) IN (
    'relationship_status', 'relationship_type', 'relationship_to_user',
    'relationship_to_me', 'status',
    'location', 'home', 'lives_in', 'residence',
    'work', 'employer', 'career', 'occupation', 'profession', 'workplace', 'company'
  );

-- ----------------------------------------------------------------------------
-- 3. SYNC the people.relationship column to the one surviving current
--    relationship fact — the same column write persist.js performs on a live
--    correction, so the KNOWN PEOPLE context / dashboard label match the fact.
--    IS DISTINCT FROM keeps this idempotent (only rows actually out of sync are
--    touched) and null-safe. People with no current relationship fact keep their
--    existing column value untouched.
-- ----------------------------------------------------------------------------
UPDATE people p
SET relationship = f.fact_value
FROM facts f
WHERE f.person_id = p.id
  AND f.user_id   = p.user_id
  AND f.is_current = true
  AND f.fact_key  = 'relationship'
  AND p.relationship IS DISTINCT FROM f.fact_value;

COMMIT;

-- ----------------------------------------------------------------------------
-- 4. POST-CHECK (READ-ONLY): re-run the section 0 query — split_groups must be
--    empty. Spot-check a known person:
--      SELECT fact_key, fact_value, is_current, ended_reason
--      FROM facts
--      WHERE person_id = '<person-uuid>'
--        AND lower(btrim(fact_key)) IN (
--          'relationship','relationship_status','relationship_type','relationship_to_user'
--        )
--      ORDER BY is_current DESC, created_at DESC;
--    Expect exactly ONE is_current = true row, key 'relationship', latest value.
-- ============================================================================
