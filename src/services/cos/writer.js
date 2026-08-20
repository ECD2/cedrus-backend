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
import { cosSelect, cosInsertTodayBrief } from './client.js';
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

let cachedUserId = null;

/** Test seam. */
export function resetCosUserId() { cachedUserId = null; }

/**
 * Whose brief this is.
 *
 * Preference order, and why:
 *   1. COS_USER_ID — explicit, and the only one that works on a CoS project
 *      with no briefs yet.
 *   2. The newest today_briefs row's user_id — CoS is single-owner
 *      (owner_session_ok() derives the subject from auth.uid() and there is one
 *      allow-listed owner), so any existing brief row names that owner. This
 *      exists so arming does not require hunting a uuid out of a dashboard.
 *
 * Which path was used is ANNOUNCED, because "derived it" and "was told it" are
 * different levels of confidence and the log should not blur them.
 */
export async function resolveCosUserId({ env = process.env } = {}) {
  const explicit = (env.COS_USER_ID || '').trim();
  if (explicit) return { userId: explicit, source: 'env' };
  if (cachedUserId) return { userId: cachedUserId, source: 'derived-cached' };

  const { rows, error, disarmed } = await cosSelect('today_briefs', (q) => q
    .order('generated_at', { ascending: false })
    .limit(1), { env, columns: 'user_id' });

  if (disarmed) return { userId: null, source: 'disarmed' };
  if (error || !rows || rows.length === 0 || !rows[0].user_id) {
    logger.event('cos.owner.unresolved', {
      level: 'error',
      error_category: 'config',
      message:
        'Cannot determine the CoS owner user_id: COS_USER_ID is unset and no existing today_briefs row ' +
        'could be read to derive it. Set COS_USER_ID to the owner uuid. The brief will not be written back.',
    });
    return { userId: null, source: 'unresolved' };
  }

  cachedUserId = String(rows[0].user_id);
  logger.event('cos.owner.derived', {
    outcome: 'derived',
    message: 'CoS owner user_id derived from the most recent today_briefs row (COS_USER_ID is unset). ' +
      'Set COS_USER_ID to pin it explicitly.',
  });
  return { userId: cachedUserId, source: 'derived' };
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
 */
export async function writeBriefToCos({
  brief, minimizedInput, model, latencyMs, tokens = null, env = process.env, now = new Date(),
}) {
  const { userId, source } = await resolveCosUserId({ env });
  if (!userId) {
    return { id: null, skipped: true, reason: source === 'disarmed' ? 'disarmed' : 'no_user_id' };
  }

  const row = buildBriefRow({ userId, brief, minimizedInput, model, latencyMs, tokens, now });
  const { id, error, disarmed } = await cosInsertTodayBrief(row, { env });
  if (disarmed) return { id: null, skipped: true, reason: 'disarmed' };
  if (error) return { id: null, skipped: true, reason: 'write_failed' };

  logger.event('cos.brief.written', {
    outcome: 'ok',
    message: `brief written back to CoS today_briefs (owner id source: ${source})`,
  });
  return { id, skipped: false, reason: null };
}
