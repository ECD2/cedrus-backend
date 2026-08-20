// ─────────────────────────────────────────────────────────────────────────────
// CoS reader — typed reads over the eight tables the daily brief may see.
//
// Every function here goes through cosSelect(), which is pinned to
// READABLE_TABLES and exposes no write verb. This module imports NOTHING that
// can write except the single today_briefs insert re-exported by writer.js,
// which is a separate module on purpose.
//
// COLUMN LISTS ARE EXPLICIT, NEVER '*'. Two reasons, both load-bearing:
//   1. The brief must not pull body content it has no right to. email_messages
//      carries `plain_text_excerpt` (already sanitized and bounded to 2000
//      chars by CoS) and we take only that — never raw MIME, never HTML, and
//      the column list makes that auditable at a glance.
//   2. A '*' read silently acquires every column a future CoS migration adds.
//      Naming them means new columns arrive when someone decides they should.
//
// EVERY READ FAILS CLOSED. cosSelect returns rows: null on error (distinct
// from []), and gatherCosInput() below turns any null into an aborted brief.
// Composing a "daily brief" from three of eight tables because five queries
// quietly errored is precisely the confident-false-success shape Lesson 1 is
// about. A brief built on partial data is worse than no brief.
//
// SCOPE: single-owner. CoS is a one-owner app (owner_session_ok() derives the
// subject from auth.uid() and there is exactly one allow-listed owner), so
// these reads are not user-scoped in SQL — service_role sees every row and
// there is one owner's worth of rows. COS_USER_ID, when set, narrows the
// writeback to that owner's uuid; see writer.js.
// ─────────────────────────────────────────────────────────────────────────────

import { cosSelect } from './client.js';

// Mirrors CoS's own LIMITS (supabase/functions/_shared/brief.ts). Deliberately
// the SAME numbers: this brief is meant to be the same brief, composed
// elsewhere, so the evidence window must not silently differ.
export const COS_LIMITS = Object.freeze({
  workstreams: 25,
  open_loops: 50,
  decisions: 25,
  captures: 15,
  agent_runs: 10,
  // Cedrus-only, because CoS's brief reads no email at all. Sized to sit
  // inside the same 24k total budget after the five CoS arrays have taken
  // their share; email is trimmed FIRST when the budget bites (see compose.js).
  email_messages: 20,
  email_ai_analyses: 20,
});

// How far back the email window reaches. A "daily" brief that surfaced a
// three-week-old message would be lying about its own name.
export const EMAIL_LOOKBACK_HOURS = 36;

/**
 * EVERY column this reader asks CoS for, as DATA rather than eight inline
 * strings.
 *
 * Made introspectable on 2026-08-20 after the reader requested
 * agent_runs.report_body — a column CoS does not have (it is original_body) —
 * and every read of that table failed with 42703 the first time rung 1 ran
 * against production. The suite could not have caught it: the reader, the
 * composer and the test fixture were all written from the same reading of CoS,
 * so all three agreed with each other and all three were wrong.
 *
 * A local test cannot detect that class of error. Only a comparison against the
 * real schema can, which is what test/cos-schema-check.mjs does with this map.
 */
export const READER_COLUMNS = Object.freeze({
  workstreams: Object.freeze(['id', 'name', 'status', 'priority', 'health', 'objective', 'current_stage', 'next_action', 'target_date', 'archived_at', 'created_at']),
  open_loops: Object.freeze(['id', 'title', 'status', 'priority', 'waiting_on', 'next_action', 'due_at', 'workstream_id', 'created_at']),
  decisions: Object.freeze(['id', 'question', 'status', 'recommendation', 'recommendation_source', 'decided_at', 'workstream_id', 'created_at']),
  captures: Object.freeze(['id', 'original_text', 'proposed_type', 'proposed_priority', 'proposed_workstream', 'decision_candidate', 'open_loop_candidate', 'created_at']),
  agent_runs: Object.freeze(['id', 'agent', 'model', 'objective', 'verification_state', 'unresolved_findings', 'recommended_next_action', 'original_body', 'created_at']),
  email_messages: Object.freeze(['id', 'subject', 'sender_name', 'sender_address', 'original_recipient', 'received_at', 'plain_text_excerpt', 'classification_status', 'owner_review_status', 'has_attachments', 'is_demo']),
  email_ai_analyses: Object.freeze(['id', 'email_message_id', 'status', 'generation_mode', 'suggested_classification', 'suggested_priority', 'suggested_action_status', 'summary', 'suggested_next_action', 'suggested_promotion_type', 'risks_or_uncertainties', 'confidence', 'created_at']),
  today_briefs: Object.freeze(['id', 'schema_version', 'generation_mode', 'model', 'status', 'generated_at']),
});

export async function readWorkstreams(opts = {}) {
  return cosSelect('workstreams', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.workstreams), {
    ...opts,
    columns: READER_COLUMNS.workstreams.join(', '),
  });
}

export async function readOpenLoops(opts = {}) {
  return cosSelect('open_loops', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.open_loops), {
    ...opts,
    columns: READER_COLUMNS.open_loops.join(', '),
  });
}

export async function readDecisions(opts = {}) {
  return cosSelect('decisions', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.decisions), {
    ...opts,
    columns: READER_COLUMNS.decisions.join(', '),
  });
}

export async function readCaptures(opts = {}) {
  return cosSelect('captures', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.captures), {
    ...opts,
    columns: READER_COLUMNS.captures.join(', '),
  });
}

export async function readAgentRuns(opts = {}) {
  return cosSelect('agent_runs', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.agent_runs), {
    ...opts,
    columns: READER_COLUMNS.agent_runs.join(', '),
  });
}

/**
 * Recent ingested mail. `plain_text_excerpt` is CoS's own sanitized, bounded
 * body column — the only body content that table ever stores. We never read
 * attachment_metadata, recipient_addresses, or thread_references: none of them
 * can change a priority, and each is a needless copy of personal data.
 */
export async function readEmailMessages({ now = new Date(), ...opts } = {}) {
  const since = new Date(now.getTime() - EMAIL_LOOKBACK_HOURS * 3600_000).toISOString();
  return cosSelect('email_messages', (q) => q
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(COS_LIMITS.email_messages), {
    ...opts,
    columns: READER_COLUMNS.email_messages.join(', '),
  });
}

/**
 * CoS's own AI read of those messages. Taken because it is already-computed,
 * already-owner-visible judgement — reusing it means the daily brief agrees
 * with what the inbox screen says rather than forming a second opinion.
 *
 * Only `completed` and `accepted` rows: `failed` carries no judgement, and
 * `dismissed` is the owner having explicitly rejected it. Surfacing a dismissed
 * suggestion in tomorrow's brief would be the system arguing with its owner.
 */
export async function readEmailAnalyses(opts = {}) {
  return cosSelect('email_ai_analyses', (q) => q
    .in('status', ['completed', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.email_ai_analyses), {
    ...opts,
    columns: READER_COLUMNS.email_ai_analyses.join(', '),
  });
}

/**
 * Prior briefs. Read for one reason only: to know whether a brief already
 * exists for today, so a re-run is visible rather than producing a duplicate
 * row. This is a READ of today_briefs; the write lives in writer.js.
 */
export async function readRecentBriefs({ limit = 5, ...opts } = {}) {
  return cosSelect('today_briefs', (q) => q
    .order('generated_at', { ascending: false })
    .limit(limit), {
    ...opts,
    columns: READER_COLUMNS.today_briefs.join(', '),
  });
}

/**
 * Gather everything, in parallel, and fail closed if ANY table could not be
 * read.
 *
 * Returns:
 *   { ok: true,  data: {...} }
 *   { ok: false, reason: 'disarmed' }              — no credentials, not an error
 *   { ok: false, reason: 'read_failed', tables }   — names the tables that failed
 *
 * The `tables` list matters: "the brief did not run" is not actionable, and
 * "the brief did not run because email_ai_analyses returned 42P01" is.
 */
export async function gatherCosInput({ now = new Date(), env = process.env } = {}) {
  const opts = { env };
  const [
    workstreams, openLoops, decisions, captures, agentRuns, emailMessages, emailAnalyses,
  ] = await Promise.all([
    readWorkstreams(opts),
    readOpenLoops(opts),
    readDecisions(opts),
    readCaptures(opts),
    readAgentRuns(opts),
    readEmailMessages({ now, ...opts }),
    readEmailAnalyses(opts),
  ]);

  const named = {
    workstreams, open_loops: openLoops, decisions, captures,
    agent_runs: agentRuns, email_messages: emailMessages, email_ai_analyses: emailAnalyses,
  };

  if (Object.values(named).some((r) => r.disarmed)) {
    return { ok: false, reason: 'disarmed' };
  }

  const failed = Object.entries(named).filter(([, r]) => r.rows === null).map(([name]) => name);
  if (failed.length > 0) {
    return { ok: false, reason: 'read_failed', tables: failed };
  }

  return {
    ok: true,
    data: Object.fromEntries(Object.entries(named).map(([name, r]) => [name, r.rows])),
  };
}
