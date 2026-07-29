-- Admin broadcasts (night build 2026-07-28, item 3).
-- Additive + idempotent; unqualified table name (run-migration.mjs regex).
-- NOT APPLIED by the overnight session (Law 5). Apply at the morning ceremony
-- BEFORE the code deploy (Lesson 6), after CARD_RAIL.proposed.sql.
--
-- State machine: draft → approved → sent.
--   draft    — POST /admin/broadcasts creates ONLY this. Nothing sends it.
--   approved — transient in-flight claim taken by the explicit approve call
--              (CAS draft→approved beats a double-click double-send). A row
--              stuck here means a send loop died mid-way: check the logs;
--              it is deliberately NOT auto-retried (never auto-send).
--   sent     — done. Web: published to the feed. SMS: loop completed.

CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment text NOT NULL DEFAULT 'all' CHECK (segment IN ('all','founding')),
  channel text NOT NULL CHECK (channel IN ('web','sms')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  sent_at timestamptz,
  recipient_count integer,
  expires_at timestamptz,            -- web feed TTL; defaulted to sent_at+7d at approve time
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_channel_status ON broadcasts (channel, status);
