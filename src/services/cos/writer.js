// ─────────────────────────────────────────────────────────────────────────────
// The writeback: one INSERT into CoS's today_briefs, so the CoS app renders
// this brief exactly as it renders its own.
//
// ── WHAT MAKES THE APP SHOW IT ──────────────────────────────────────────────
// CoS's frontend reads a stored brief with `latestStoredBrief()`:
//
//   .from("today_briefs").select("structured_output, model, generated_at, generation_mode")
//   .eq("generation_mode", "ai").order("generated_at", {ascending:false}).limit(1)
//
// So the row MUST have generation_mode='ai' or the app will never look at it,
// and it casts `structured_output` straight to its `TodayBrief` type with no
// runtime validation. Everything that makes the render correct therefore has
// to be correct before the insert — which is what validateBrief() is for.
//
// ── THE TABLE'S OWN CONSTRAINTS, WHICH WE SATISFY BY CONSTRUCTION ───────────
//   today_briefs_ai_is_complete   — generation_mode='ai' ⇒ structured_output
//                                   AND model both non-null
//   today_briefs_error_has_category — (status='error') = (error_category not null)
//   today_briefs_source_refs_is_array — source_refs must be a JSON array
//
// A violated CHECK returns 23514 through supabase-js as a normal `error`, not a
// throw, so cosInsertTodayBrief binds and announces it.
//
// ── WHAT IS NEVER WRITTEN ───────────────────────────────────────────────────
// No prompt. No raw model response. No message bodies. `structured_output` is
// the validated brief the owner sees and nothing else; `input_fingerprint` is a
// SHA-256 of the minimized payload — a hash, never content. This mirrors the
// stated intent of CoS's own migration comment on that table.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { cosSelectAcrossAllUsers, cosInsertTodayBrief } from './client.js';
import { readPersonSettings } from './personSettings.js';
import { BRIEF_SCHEMA_VERSION, collectSourceRefs } from './compose.js';
import { logger } from '../../utils/logger.js';

/** CoS's buckets, value-for-value. Divergence would make the two rows incomparable. */
export function latencyBucket(ms) {
  if (ms < 2_000) return '<2s';
  if (ms < 5_000) return '2-5s';
  if (ms < 15_000) return '5-15s';
  if (ms < 30_000) return '15-30s';
  return '>=30s';
}

export function tokenBucket(total) {
  if (total === null || total === undefined) return 'unknown';
  if (total < 1_000) return '<1k';
  if (total < 5_000) return '1-5k';
  if (total < 20_000) return '5-20k';
  return '>=20k';
}

/** SHA-256 of the exact minimized payload. CoS stores the same shape of value. */
export function fingerprint(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** How long the CoS app should consider this brief current. CoS uses 12 hours. */
export const BRIEF_TTL_MS = 12 * 3600_000;

// ── NO PROCESS-GLOBAL OWNER SLOT ────────────────────────────────────────────
//
// This module once held `let cachedUserId = null` — one value for the whole
// process. With N users iterating inside one process user A would resolve
// first and populate it, and user B's writeback would read A's id out of it:
// B's brief inserted into CoS attributed to A, appearing in the wrong person's
// app and vanishing from the right one's (CEDRUS.md II.5).
//
// It became a Map keyed by CoS project, which only the DERIVE path below still
// uses. The settings path (P1.4) caches NOTHING: every resolution for a named
// person is a fresh scoped read of that person's row, so the only id it can
// return is the one stored under the id it was asked about. Bundle 46 proves
// it by resolving A then B in one process, and by reintroducing a global slot
// as a mutation.
const cachedUserIds = new Map();

/** Test seam. */
export function resetCosUserId() { cachedUserIds.clear(); }

/**
 * Whose brief this is.
 *
 * Preference order, and why:
 *   1. `cosUserId` — an id THE CALLER already resolved. When a user is named,
 *      this returns that id and nothing else is consulted: no row, no env var,
 *      no cache, no derivation. The label for this branch is whatever the
 *      caller declared in `cosUserSource` (the job passes its own resolved
 *      source) and 'caller' when it declared nothing. It is NEVER 'settings'
 *      on this module's say-so. Until 2026-09-04 this branch returned
 *      source:'settings' for ANY supplied id while nothing in src/ read the
 *      user_settings table, so every cos.brief.written line from 2026-08-30
 *      claimed a provenance the system had not earned.
 *   2. `personId` → THAT PERSON'S OWN user_settings ROW (P1.4, 2026-09-09).
 *      One scoped read (personSettings.js) of user_settings.cos_user_id, and
 *      usage_user_id rides along from the same row. Source 'settings' — the
 *      label this module reserved for exactly this, now true for the first
 *      time. A missing row or a NULL id is ANNOUNCED before anything else
 *      happens (cos.owner.settings_missing, warn, naming the person — B2.3:
 *      absence announces itself); an unreadable row is announced as
 *      cos.owner.settings_unreadable at error. Either then falls through to
 *      3 — and that fall-through exists ONLY until the P1.3 backfill has
 *      populated cos_user_id for every active user. The commit after this one
 *      removes 3 and 4 for a named person and refuses instead.
 *   3. COS_USER_ID — the single-owner deploy. Still supported because it is
 *      what production runs on until the backfill; P1.4's second commit
 *      removes it.
 *   4. The newest today_briefs row's user_id — a BOOTSTRAP convenience so
 *      arming did not require hunting a uuid out of a dashboard.
 *
 * ── WHY 4 IS ONLY REACHABLE WHEN NOBODY NAMED A USER ────────────────────────
 * "The newest brief row" identifies the owner only while there is exactly one
 * owner. With N people it names whoever ran most recently, which is an
 * arbitrary user, and it would announce success while doing it. So the
 * derivation is unreachable once a caller names a user: if you asked for a
 * specific person, you get that person or nothing.
 *
 * The derive path reads across users by necessity — it is asking "who owns
 * this project?", which cannot be scoped to an answer it does not yet have.
 * That makes it the second legitimate cross-user read in the system, so it
 * goes through cosSelectAcrossAllUsers and says so in the log every time.
 *
 * Which path was used is ANNOUNCED, because "read it from the person's row",
 * "was told it", "took it from the environment" and "derived it" are
 * different levels of confidence and the log should not blur them.
 *
 * `db` is the test seam for the settings read; production reads the Cedrus
 * service client. Returns { userId, source, usageUserId } — usageUserId is
 * non-null only when the settings path supplied it.
 */
export async function resolveCosUserId({ env = process.env, personId = null, cosUserId = null, cosUserSource = null, db = undefined } = {}) {
  if (typeof cosUserId === 'string' && cosUserId.trim() !== '') {
    // "A caller told me." Carry the caller's own resolved source through; do
    // not invent one. This line used to read source: 'settings' (see header).
    const declared = typeof cosUserSource === 'string' && cosUserSource.trim() !== '' ? cosUserSource.trim() : 'caller';
    return { userId: cosUserId.trim(), source: declared, usageUserId: null };
  }

  // The person's own row. Settings come AHEAD of the environment: a variable
  // that names a person is the condition P1.4 exists to remove, so it is
  // consulted only when the row cannot answer, and that is announced.
  if (typeof personId === 'string' && personId.trim() !== '') {
    const fromRow = await settingsIdentity(personId.trim(), db);
    if (fromRow.userId) return fromRow;
    // Announced inside settingsIdentity. Fall through — until the backfill.
  }

  const explicit = (env.COS_USER_ID || '').trim();
  if (explicit) return { userId: explicit, source: 'env', usageUserId: null };

  // Keyed by the CoS project, because that is honestly what a derived owner is
  // a property of. The old single `cachedUserId` slot was keyed by nothing,
  // which is how it could hand user A's id to a lookup for user B.
  const projectKey = (env.COS_SUPABASE_URL || '').trim();
  if (cachedUserIds.has(projectKey)) {
    return { userId: cachedUserIds.get(projectKey), source: 'derived-cached', usageUserId: null };
  }

  const { rows, error, disarmed } = await cosSelectAcrossAllUsers('today_briefs', (q) => q
    .order('generated_at', { ascending: false })
    .limit(1), {
    env,
    columns: 'user_id',
    reason: 'bootstrap: deriving the single CoS owner because no user was named and COS_USER_ID is unset',
  });

  if (disarmed) return { userId: null, source: 'disarmed', usageUserId: null };
  if (error || !rows || rows.length === 0 || !rows[0].user_id) {
    logger.event('cos.owner.unresolved', {
      level: 'error',
      error_category: 'config',
      message:
        'Cannot determine the CoS owner user_id: no user was named, COS_USER_ID is unset, and no existing ' +
        'today_briefs row could be read to derive it. Set user_settings.cos_user_id for this person ' +
        '(or COS_USER_ID for a single-owner deploy). The brief will not be written back.',
    });
    return { userId: null, source: 'unresolved', usageUserId: null };
  }

  const derived = String(rows[0].user_id);
  cachedUserIds.set(projectKey, derived);
  logger.event('cos.owner.derived', {
    outcome: 'derived',
    message: 'CoS owner user_id derived from the most recent today_briefs row (no user named, COS_USER_ID unset). ' +
      'This is single-owner behaviour: set user_settings.cos_user_id per person before adding a second user.',
  });
  return { userId: derived, source: 'derived', usageUserId: null };
}

/**
 * The settings path: this person's row, read once, right now.
 *
 * Returns { userId, source: 'settings', usageUserId } when the row carries a
 * cos_user_id. Otherwise it says WHY — in the log, naming the person, and in
 * `source` — and returns userId: null:
 *
 *   'settings_missing'     no row, or a row whose cos_user_id is NULL. Warn
 *                          level tonight because the caller still falls back
 *                          to COS_USER_ID; it becomes the reason the run
 *                          aborts once that fallback is removed.
 *   'settings_unreadable'  the read threw. Error level, with the SQLSTATE.
 *                          Never folded into 'missing': "could not read" and
 *                          "read, found nothing" must never collapse into one
 *                          value (Lesson 1), and after P1.4 'missing' is a
 *                          statement about the person.
 *
 * No cache. Nothing is remembered between calls, so a call for B cannot be
 * answered from a call for A.
 */
async function settingsIdentity(personId, db) {
  let row;
  try {
    row = await readPersonSettings(personId, db ? { db } : {});
  } catch (err) {
    const code = (err && err.code) || 'unknown';
    logger.event('cos.owner.settings_unreadable', {
      level: 'error', error_category: 'db_error', error_code: code, outcome: 'fallback',
      message:
        `user_settings could not be read for person ${personId} (${code}: ${(err && err.message) || String(err)}) — ` +
        'the brief cannot be resolved from settings for this person; falling back to COS_USER_ID.',
    });
    return { userId: null, source: 'settings_unreadable', usageUserId: null };
  }
  if (!row || !row.cos_user_id) {
    logger.event('cos.owner.settings_missing', {
      level: 'warn', outcome: row ? 'null_id' : 'no_row',
      message:
        (row
          ? `person ${personId} has a user_settings row but its cos_user_id is NULL`
          : `person ${personId} has no user_settings row`) +
        ' — the brief cannot be resolved from settings for this person; falling back to COS_USER_ID ' +
        'until the P1.3 backfill populates user_settings.cos_user_id (B2.3: absence announces itself).',
    });
    return { userId: null, source: 'settings_missing', usageUserId: null };
  }
  return {
    userId: String(row.cos_user_id),
    source: 'settings',
    usageUserId: row.usage_user_id ? String(row.usage_user_id) : null,
  };
}

/**
 * The exact row inserted into CoS's today_briefs. Pure and exported so the
 * suite asserts on the real object rather than on source text — an earlier pin
 * in this file's history grepped source and broke the moment a comment
 * mentioned the thing it pinned.
 *
 * This field list is a CONTRACT with CoS's own persist(): the same columns with
 * the same meanings, so a row written here is indistinguishable from one CoS
 * wrote itself.
 *
 * generated_at is DELIBERATELY ABSENT. CoS omits it and lets the column default
 * to now() on the CoS database. Setting it from this runtime's clock put a
 * measurable falsehood in the data: the 2026-08-20 row carried
 * generated_at 19:17:56 against created_at 19:17:36, because the machine
 * running the job is ~29 seconds AHEAD of CoS's database — the same skew behind
 * the intermittent PGRST303 "JWT issued at future". The brief was stamped in
 * CoS's future, and latestStoredBrief() ORDERS BY that column.
 *
 * expires_at deliberately DOES use this clock, because CoS computes it the same
 * way (Date.now() + 12h in its own runtime). Matching CoS's behaviour matters
 * more here than matching CoS's database.
 */
export function buildBriefRow({ userId, brief, minimizedInput, model, latencyMs, tokens = null, now = new Date() }) {
  return {
    user_id: userId,
    schema_version: BRIEF_SCHEMA_VERSION,
    // Required for CoS's reader to select it at all.
    generation_mode: 'ai',
    model,
    input_fingerprint: fingerprint(minimizedInput),
    structured_output: brief,
    source_refs: collectSourceRefs(brief),
    status: 'ok',
    // status='ok' ⇒ error_category MUST stay null (today_briefs_error_has_category).
    latency_bucket: latencyBucket(latencyMs),
    token_bucket: tokenBucket(tokens),
    expires_at: new Date(now.getTime() + BRIEF_TTL_MS).toISOString(),
  };
}

/**
 * Insert the brief. Returns { id, skipped, reason }.
 *
 * A writeback failure is NOT treated as a failure of the whole job: the email
 * is the delivery, the row is the mirror. The caller reports both outcomes
 * separately so "you got the brief but the app won't show it" is legible
 * rather than being flattened into one word.
 *
 * `cosUserSource` is the caller's own resolved source for `cosUserId`, and it
 * is what the cos.brief.written line announces. `deps.insert` is a test seam
 * so the announcement can be driven without a CoS project.
 */
export async function writeBriefToCos({
  brief, minimizedInput, model, latencyMs, tokens = null, env = process.env, now = new Date(),
  cosUserId = null, cosUserSource = null, deps = {},
}) {
  const { insert = cosInsertTodayBrief } = deps;
  const { userId, source } = await resolveCosUserId({ env, cosUserId, cosUserSource });
  if (!userId) {
    return { id: null, skipped: true, reason: source === 'disarmed' ? 'disarmed' : 'no_user_id' };
  }

  const row = buildBriefRow({ userId, brief, minimizedInput, model, latencyMs, tokens, now });
  const { id, error, disarmed } = await insert(row, { env });
  if (disarmed) return { id: null, skipped: true, reason: 'disarmed' };
  if (error) return { id: null, skipped: true, reason: 'write_failed' };

  logger.event('cos.brief.written', {
    outcome: 'ok',
    message: `brief written back to CoS today_briefs (owner id source: ${source})`,
  });
  return { id, skipped: false, reason: null };
}
