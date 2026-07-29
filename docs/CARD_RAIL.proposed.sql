-- Card rail schema (night build 2026-07-28, item 2; spec PART 2/PART 3).
-- Additive + idempotent; unqualified table names (run-migration.mjs regex).
-- Runner-verifiable objects only: CREATE TABLE / ADD COLUMN / CREATE INDEX.
--
-- NOT APPLIED by the overnight session (Law 5). Apply at the morning ceremony
-- BEFORE the code deploy (Lesson 6), after BUDGET_KILL_SWITCH.proposed.sql.
--
-- opportunity_cards state machine (CHECK below):
--   queued → sending → sent                (sender job; CAS claim, reminders-style)
--   queued → suppressed | canceled         (suppression hit at send time / opted out)
--   sent   → accepted (YES) | skipped (SKIP) | later (LATER)
--          | not_them (NOT THEM) | never (NEVER)
--   accepted → followup_sending → followup_sent          (3 days post-YES)
--   followup_sent → met_confirmed (YES) | met_no (NO)
-- met_confirmed is THE only tree-advancing event (spec PART 2 step 5).

CREATE TABLE IF NOT EXISTS opportunity_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind text NOT NULL,                -- 'coffee' | 'walk' | 'lunch' | ... (Emil's vocabulary)
  occasion text,                     -- the specific reason/context shown to the user
  body text NOT NULL,                -- the card SMS copy (Emil-authored in V1)
  invite_text text NOT NULL,         -- forwardable invite, user's voice (spec PART 3)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','accepted','skipped','later','not_them',
                      'never','followup_sending','followup_sent','met_confirmed','met_no',
                      'suppressed','canceled')),
  created_by text NOT NULL DEFAULT 'admin',
  send_after timestamptz,            -- optional schedule; NULL = next eligible tick
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  sent_message_id uuid REFERENCES messages(id),
  replied_at timestamptz,
  reply_token text,                  -- the matched vocabulary token, not the raw body
  followup_due_at timestamptz,
  followup_sent_at timestamptz,
  followup_message_id uuid REFERENCES messages(id),
  met_confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_cards_user_status ON opportunity_cards (user_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunity_cards_status_due ON opportunity_cards (status, followup_due_at);
CREATE INDEX IF NOT EXISTS idx_opportunity_cards_user_sent ON opportunity_cards (user_id, sent_at);

-- NOT THEM writes (person, card.kind); NEVER writes (person, kind NULL = every
-- kind). NEVER is permanent until the user reverses it (revoked_at) — nothing
-- decays it (spec PART 3). Checked at queue time (admin 409) AND send time.
CREATE TABLE IF NOT EXISTS suppressed_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind text,                         -- NULL = all kinds (the NEVER row)
  reason text NOT NULL CHECK (reason IN ('not_them','never')),
  source_card_id uuid REFERENCES opportunity_cards(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz             -- only the user reverses NEVER
);
CREATE INDEX IF NOT EXISTS idx_suppressed_pairings_user_person ON suppressed_pairings (user_id, person_id);

-- The garden's raw material: confirmed in-person time, per person. Written by
-- exactly one event — a YES to the "did it happen?" follow-up.
ALTER TABLE people ADD COLUMN IF NOT EXISTS met_confirmed_count integer NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_met_confirmed_at timestamptz;
