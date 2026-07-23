-- ============================================================================
-- ENTITY_RESOLUTION_CLARIFICATIONS.proposed.sql   (PROPOSED — NOT EXECUTED)
--
-- Phase 2a of docs/ENTITY_RESOLUTION_V2.md — the ask-first clarification loop.
-- Creates the pending_clarifications table that HOLDS an ambiguous person
-- mention's writes while Cedrus asks one candidate-listing question over SMS,
-- instead of silently guessing a merge. This is the ONLY schema Phase 2a needs;
-- last-initial display is a separate migration (Phase 2b, ENTITY_RESOLUTION_
-- LAST_INITIAL.proposed.sql).
--
-- Column contract mirrors docs/ENTITY_RESOLUTION_V2.md §2.1.
--
-- Safety / operating notes
--   * DO NOT RUN AS PART OF DEPLOY. Emil runs all migrations through the Supabase
--     ceremony. Committed for review only; this worktree ran nothing.
--   * gen_random_uuid() is Supabase/pgcrypto default on PG13+. If this project
--     seeds uuids with uuid_generate_v4() (uuid-ossp), swap it to match.
--   * FK targets assume app_users(id), messages(id), people(id). Confirm those
--     table/column names against the live schema before running; adjust if they
--     differ.
--   * IF NOT EXISTS makes the table + indexes idempotent (safe to re-run).
--     For a large existing table consider CREATE INDEX CONCURRENTLY (cannot run
--     inside a txn block; run each such statement on its own). A brand-new table
--     is empty, so plain CREATE INDEX is fine here.
--   * Ownership is enforced IN CODE (services/clarifications.js, user-scoped
--     reads/writes through the existing people/memory guards), the same pattern
--     the rest of the backend uses via the service role. No RLS policy is added
--     here by default; add one only if/when the project adopts RLS broadly (see
--     "Explicitly NOT proposed here").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pending_clarifications — one held "which person did you mean?" per row.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_clarifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

  -- lifecycle: pending (queued) -> active (question outstanding) -> resolved
  --            | expired | cancelled
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','active','resolved','expired','cancelled')),
  -- extensible to other confirmations later; only person_dedup for now
  kind                  text NOT NULL DEFAULT 'person_dedup'
                          CHECK (kind IN ('person_dedup')),

  -- the new mention, as parsed
  mention_text          text,
  proposed_name         text,
  proposed_relationship text,

  -- the owned existing person(s) the mention might be. Every id is verified
  -- (user_id, person_id)-owned in code before it can become a merge target.
  candidate_person_ids  uuid[] NOT NULL DEFAULT '{}',

  -- the held writes: facts / saved_items / reminders / goals / birthday /
  -- contact-signal that reference this mention, plus source_message_id.
  -- Applied verbatim through the user-scoped writers on resolution.
  held_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- the exact authored (voice-guarded, EN/ES) question that was sent
  question_text         text,
  asked_message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  answered_message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,

  -- at most one gentle re-ask (docs §2.3); cap enforced here and in code
  reask_count           int  NOT NULL DEFAULT 0 CHECK (reask_count BETWEEN 0 AND 1),

  -- how it ended, and where the held writes landed
  resolution            text CHECK (resolution IN ('same','different','expired_default_new','cancelled')),
  resolved_person_id    uuid REFERENCES people(id) ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  expires_at            timestamptz,   -- TTL horizon (propose 72h; set in code)
  resolved_at           timestamptz
);

-- (1) THE one-active invariant (docs decision 6): at most one outstanding
--     question per user, so a reply never stacks two dedup questions. A partial
--     UNIQUE index is the structural enforcement — code cannot violate it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_clarifications_one_active
  ON pending_clarifications (user_id)
  WHERE status = 'active';

-- (2) FIFO pickup of the next queued item for a user (activate-next after the
--     active one resolves/expires).
CREATE INDEX IF NOT EXISTS idx_pending_clarifications_user_queue
  ON pending_clarifications (user_id, created_at)
  WHERE status = 'pending';

-- (3) Expiry sweep scan (~15-min job): active|pending rows past expires_at.
CREATE INDEX IF NOT EXISTS idx_pending_clarifications_sweep
  ON pending_clarifications (status, expires_at);

-- ----------------------------------------------------------------------------
-- Explicitly NOT proposed here:
--   * No person_not_duplicates table. The "different" answer must be remembered
--     so Cedrus never re-asks the same Luca-vs-Lucas pair, but whether that
--     reuses the web person_merges "keep separate" record or a new table is an
--     open decision with the web-merge owner (docs §5.4 / §7). No DDL until then.
--   * No RLS policy. Ownership is enforced in code via the service role, matching
--     the rest of the backend. Add a `user_id = auth.uid()` policy only if the
--     project moves to RLS broadly.
--   * No auto-expire trigger. Expiry is handled by the sweep job (default ->
--     CREATE), which also honors the post-crisis safety suppression window
--     (docs §2.3, decision 5) for any user-facing note.
--   * No people.last_initial here — that is Phase 2b
--     (ENTITY_RESOLUTION_LAST_INITIAL.proposed.sql).
-- ----------------------------------------------------------------------------
