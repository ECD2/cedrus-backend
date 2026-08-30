// ─────────────────────────────────────────────────────────────────────────────
// CoS reader — typed reads over the eight tables the daily brief may see.
//
// Every function here goes through forUser(userId).select(), which is pinned to
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
// EVERY READ FAILS CLOSED. The scoped select returns rows: null on error (distinct
// from []), and gatherCosInput() below turns any null into an aborted brief.
// Composing a "daily brief" from three of eight tables because five queries
// quietly errored is precisely the confident-false-success shape Lesson 1 is
// about. A brief built on partial data is worse than no brief.
//
// SCOPE: PER USER, ENFORCED STRUCTURALLY (rewritten 2026-08-30, multi-user).
// This comment used to read "single-owner ... these reads are not user-scoped
// in SQL — service_role sees every row and there is one owner's worth of
// rows." That was true of a one-person system and it was the justification for
// eight unscoped reads. It is now false and dangerous: with a second person,
// unscoped means every function here returns the other person's workstreams,
// decisions, captures and email excerpts.
//
// Every read below now takes an explicit `userId` and goes through
// forUser(userId).select(...), which applies .eq('user_id', userId) before the
// per-table narrowing. There is no longer an exported verb that can read
// without a user — see the isolation header in client.js.
// ─────────────────────────────────────────────────────────────────────────────

import { forUser } from './client.js';

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
// Matched to the cron cadence (0 11 * * * — every 24h). It was 36, which on a
// daily schedule re-shows a 12-hour band in two consecutive briefs: yesterday's
// evening mail appears again this morning as if it were new.
//
// Tightening it costs nothing, because the lookback NO LONGER DECIDES WHAT IS
// VISIBLE. It only defines the "arrived since the last brief" tier. Anything
// needing attention — unreviewed, action_needed, urgent, high — is selected
// regardless of age (see selectEmailMessages), so a message can no longer fall
// out of the brief simply by getting old. That was the real defect: all seven
// rows in CoS are 6 to 40 days old, so a 36-hour window showed the brief
// exactly zero email, every run, silently.
export const EMAIL_LOOKBACK_HOURS = 24;

/**
 * Action states meaning "the owner has already dealt with this". Never
 * surfaced — resurfacing dismissed mail is the system arguing with its owner,
 * the same reasoning readEmailAnalyses applies to dismissed analyses.
 */
export const SETTLED_ACTION_STATUS = Object.freeze(['dismissed', 'resolved']);

/**
 * The ONE spelling of "the owner has not looked at this yet".
 *
 * Exported because compose.js counts the same rows from the other end of the
 * pipeline. Two modules each filtering on their own string literal is one typo
 * away from a brief whose headline number disagrees with the selection that
 * produced it — and NOTHING WOULD THROW, because both spellings are valid
 * strings that simply match different rows. That is the Lesson 20 shape: two
 * pieces of code agreeing because one author wrote both, until one of them
 * changes. One constant, imported by both, makes the disagreement unwritable.
 */
export const UNREVIEWED_ACTION_STATUS = 'unreviewed';

/** Age-independent: these are selected however old they are. */
export const ATTENTION_ACTION_STATUS = Object.freeze(['action_needed', UNREVIEWED_ACTION_STATUS]);
export const ATTENTION_TRIAGE_PRIORITY = Object.freeze(['urgent', 'high']);

/**
 * How many candidate rows are pulled before ranking. Ranking cannot promote a
 * row it never saw, so this is deliberately an order of magnitude above the
 * 20-row output cap. If the eligible total ever exceeds it, the shortfall is
 * announced rather than hidden — see gatherCosInput's email_selection.
 */
export const EMAIL_CANDIDATE_POOL = 200;

const ACTION_RANK = { action_needed: 0, unreviewed: 1, waiting: 2, reviewed: 3 };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * Rank and cap. PURE — no I/O, so the ordering is unit-testable and
 * mutation-testable rather than buried in a PostgREST clause.
 *
 * Order, and why:
 *   1. action_status   what the owner still has to do beats what they have seen
 *   2. triage_priority urgent before normal within the same action state
 *   3. received_at     newest first, as the tie-break only
 *
 * Recency is LAST on purpose. It was previously first and only, which is how a
 * six-day-old unreviewed message lost to nothing at all.
 *
 * ── THE TWO FIGURES COUNTED OVER THE POOL, NOT THE SLICE ────────────────────
 * `unreviewedTotal` and `oldestUnreviewedReceivedAt` are computed over the FULL
 * eligible set, deliberately BEFORE `slice(0, limit)`. Counting them after the
 * cap would make the brief describe its own 20-row window and call it the
 * inbox: 25 unreviewed messages would be announced as 20, and — worse — the
 * "oldest" age would be read off the newest 20, because the ranking sorts
 * recency DESCENDING within a tier. The oldest unreviewed message is therefore
 * the single row most likely to have been cut, which is exactly the row the
 * owner most needs named.
 */
export function selectEmailMessages(rows, limit = COS_LIMITS.email_messages) {
  const eligible = (rows || []).filter((r) => !SETTLED_ACTION_STATUS.includes(r.action_status));
  const ranked = [...eligible].sort((a, b) => {
    const ar = (ACTION_RANK[a.action_status] ?? 9) - (ACTION_RANK[b.action_status] ?? 9);
    if (ar !== 0) return ar;
    const pr = (PRIORITY_RANK[a.triage_priority] ?? 9) - (PRIORITY_RANK[b.triage_priority] ?? 9);
    if (pr !== 0) return pr;
    return new Date(b.received_at || 0) - new Date(a.received_at || 0);
  });
  // From `eligible`, never from `ranked.slice(...)` below. See the note above.
  const unreviewed = eligible.filter((r) => r.action_status === UNREVIEWED_ACTION_STATUS);
  const dated = unreviewed
    .map((r) => ({ iso: r.received_at, t: Date.parse(r.received_at) }))
    .filter((x) => Number.isFinite(x.t));

  return {
    selected: ranked.slice(0, limit),
    eligibleTotal: ranked.length,
    unreviewedTotal: unreviewed.length,
    // The row's own value, not a re-serialization of it, so what the brief
    // reports is traceable back to a record rather than to arithmetic here.
    oldestUnreviewedReceivedAt: dated.length
      ? dated.reduce((a, b) => (b.t < a.t ? b : a)).iso
      : null,
  };
}

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
  // NOTE the triage columns, not classification_status / owner_review_status.
  // Those are an earlier generation and they are STALE: row 0f8ea600 in prod
  // carries classification='support', triage_priority='urgent' while its legacy
  // classification_status still reads 'unclassified'. The reader was reading the
  // stale pair, so even had the window found these rows, the brief would have
  // been told the wrong thing about every one of them.
  email_messages: Object.freeze(['id', 'subject', 'sender_name', 'sender_address', 'original_recipient', 'received_at', 'plain_text_excerpt', 'classification', 'triage_priority', 'action_status', 'has_attachments', 'is_demo']),
  email_ai_analyses: Object.freeze(['id', 'email_message_id', 'status', 'generation_mode', 'suggested_classification', 'suggested_priority', 'suggested_action_status', 'summary', 'suggested_next_action', 'suggested_promotion_type', 'risks_or_uncertainties', 'confidence', 'created_at']),
  today_briefs: Object.freeze(['id', 'schema_version', 'generation_mode', 'model', 'status', 'generated_at']),
});

export async function readWorkstreams({ userId, ...opts } = {}) {
  return forUser(userId).select('workstreams', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.workstreams), {
    ...opts,
    columns: READER_COLUMNS.workstreams.join(', '),
  });
}

export async function readOpenLoops({ userId, ...opts } = {}) {
  return forUser(userId).select('open_loops', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.open_loops), {
    ...opts,
    columns: READER_COLUMNS.open_loops.join(', '),
  });
}

export async function readDecisions({ userId, ...opts } = {}) {
  return forUser(userId).select('decisions', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.decisions), {
    ...opts,
    columns: READER_COLUMNS.decisions.join(', '),
  });
}

export async function readCaptures({ userId, ...opts } = {}) {
  return forUser(userId).select('captures', (q) => q
    .order('created_at', { ascending: false })
    .limit(COS_LIMITS.captures), {
    ...opts,
    columns: READER_COLUMNS.captures.join(', '),
  });
}

export async function readAgentRuns({ userId, ...opts } = {}) {
  return forUser(userId).select('agent_runs', (q) => q
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
/**
 * Eligible = not already settled by the owner, AND (needs attention OR arrived
 * since the last brief). The attention half is age-independent, which is what
 * stops an old unreviewed message from silently vanishing.
 *
 * Returns { rows, error, disarmed, eligibleTotal, unreviewedTotal,
 * oldestUnreviewedReceivedAt, poolTruncated } so the caller can say how much it
 * did NOT look at — and how much of what it did not look at still needs the
 * owner.
 */
export async function readEmailMessages({ now = new Date(), userId, ...opts } = {}) {
  const since = new Date(now.getTime() - EMAIL_LOOKBACK_HOURS * 3600_000).toISOString();
  const settled = `(${SETTLED_ACTION_STATUS.join(',')})`;
  const eligible = [
    `action_status.in.(${ATTENTION_ACTION_STATUS.join(',')})`,
    `triage_priority.in.(${ATTENTION_TRIAGE_PRIORITY.join(',')})`,
    `received_at.gte.${since}`,
  ].join(',');

  const narrow = (q) => q.not('action_status', 'in', settled).or(eligible);

  const res = await forUser(userId).select('email_messages', (q) => narrow(q)
    .order('received_at', { ascending: false })
    .limit(EMAIL_CANDIDATE_POOL), {
    ...opts,
    columns: READER_COLUMNS.email_messages.join(', '),
  });
  // NULL, never 0. A failed read knows nothing about the pool, and a zero here
  // would be a confident "no unreviewed mail" composed out of an error.
  if (res.disarmed || res.error || !res.rows) {
    return {
      ...res,
      eligibleTotal: null,
      unreviewedTotal: null,
      oldestUnreviewedReceivedAt: null,
      poolTruncated: false,
    };
  }

  const {
    selected, eligibleTotal, unreviewedTotal, oldestUnreviewedReceivedAt,
  } = selectEmailMessages(res.rows, COS_LIMITS.email_messages);
  return {
    ...res,
    rows: selected,
    eligibleTotal,
    unreviewedTotal,
    oldestUnreviewedReceivedAt,
    // The candidate pool itself filled up, so `eligibleTotal` is a floor, not a
    // count. Announced separately rather than quietly reported as exact.
    poolTruncated: res.rows.length >= EMAIL_CANDIDATE_POOL,
  };
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
export async function readEmailAnalyses({ userId, ...opts } = {}) {
  return forUser(userId).select('email_ai_analyses', (q) => q
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
export async function readRecentBriefs({ limit = 5, userId, ...opts } = {}) {
  return forUser(userId).select('today_briefs', (q) => q
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
export async function gatherCosInput({ now = new Date(), env = process.env, userId } = {}) {
  // Threaded, never defaulted. A default here would reintroduce exactly the
  // singleton this session removed: every caller would silently gather the same
  // person's data and the second user's brief would be composed from the
  // first's records. forUser() throws on a missing id, so a caller that forgets
  // fails loudly on the first read rather than quietly composing a wrong brief.
  const opts = { env, userId };
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
    email_selection: buildEmailSelection(emailMessages),
  };
}

/**
 * The email read, turned into the record compose.js consumes.
 *
 * PURE, and exported, for one reason: it is the only place the reader's field
 * names (`eligibleTotal`, `unreviewedTotal`, …) are translated into the
 * composer's (`total`, `unreviewed_total`, …). Left inline in gatherCosInput it
 * would be untestable without live CoS credentials, and the suite would have to
 * hand-build the record instead — which is Lesson 20 exactly: a fixture written
 * from the same reading as the code proves they agree with each other, not that
 * either is right. One implementation, driven by both prod and the suite.
 *
 * How much email was NOT looked at. Selecting 20 of 63 and saying nothing is
 * blindness at 68% presented as a complete brief — Lesson 7 in a new place, so
 * the shortfall travels with the data instead of being dropped here.
 */
export function buildEmailSelection(emailRead) {
  const considered = (emailRead.rows || []).length;
  const total = emailRead.eligibleTotal;
  return {
    considered,
    total: total === null ? considered : total,
    truncated: total !== null && total > considered,
    // eligibleTotal is a floor rather than a count when the candidate pool
    // itself filled; said plainly so "63" is never read as exact when it isn't.
    // It qualifies unreviewed_total for the SAME reason: that count is drawn
    // from the same truncated pool, so it is a floor whenever this is.
    total_is_floor: Boolean(emailRead.poolTruncated),
    // The unreviewed headline, over the whole eligible pool rather than the 20
    // rows that fitted. `truncated` already discloses that the brief did not
    // read everything; this is the same disclosure one level in — how much of
    // what it did not read is still waiting on the owner.
    //
    // NULL means "not known", not "none". compose.js reads null as an
    // instruction to fall back to counting the rows it actually has AND to say
    // that is what it did, rather than to print a zero it cannot support.
    unreviewed_total: emailRead.unreviewedTotal ?? null,
    // The oldest of those, by received_at, from that same pool. Deriving this
    // from the selected slice systematically UNDER-reports it: the ranker sorts
    // newest-first inside a tier, so the oldest unreviewed row is the likeliest
    // one to have been cut by the cap.
    oldest_unreviewed_received_at: emailRead.oldestUnreviewedReceivedAt ?? null,
  };
}
