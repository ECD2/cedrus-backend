// ─────────────────────────────────────────────────────────────────────────────
// Per-person settings — the ONE place the brief reads `user_settings`.
//
// `user_settings` is the table that retires the per-person environment
// variables (supabase/migrations/20260830120000_multiuser_foundation.sql):
//
//   cos_user_id    ← COS_USER_ID              this person's id INSIDE Chief of
//                                             Staff (a different id space from
//                                             app_users.id — never assume they
//                                             match)
//   usage_user_id  ← COS_BRIEF_USAGE_USER_ID  the Cedrus app_users id whose
//                                             agent_runs row records the spend
//
// Both are IDENTITY: whose CoS records are gathered, whose ledger slot is
// claimed, whose today_briefs row is written, whose account is billed. The
// delivery columns (brief_email, brief_enabled, brief_hour_utc, timezone) are
// deliberately NOT read here yet — B2.1 widens this read when the brief is
// driven from rows end to end. Tonight is identity only (P1.4).
//
// ── TWO RULES ───────────────────────────────────────────────────────────────
// 1. Every read is scoped to ONE named person, except the one listing below,
//    which reads a single non-personal column (`user_id`) and exists only to
//    answer "who holds a CoS identity at all". There is no "read the settings"
//    verb without a person, and no way to reach another person's row from a
//    call that named this one.
// 2. NOTHING IS CACHED HERE. `resolveCosUserId()` once memoized a single owner
//    id in a process-global slot, and with two users iterating in one process
//    user B would have been handed A's id (CEDRUS.md II.5, the resolveCosUserId
//    cache bullet). A module that holds no state cannot repeat that: every
//    call goes to the table, and a result can only describe the id it was
//    asked about. Bundle 46 proves it by resolving A then B in one process and
//    by reintroducing a global slot as a mutation.
//
// ── "COULD NOT READ" IS NEVER "NO ROW" ──────────────────────────────────────
// A read error THROWS; an absent row returns null. supabase-js resolves
// { data, error } rather than throwing (II.4 Lesson 11), so the error is bound
// here and re-thrown carrying its SQLSTATE. Returning null on an error would
// make a broken read look like a person with no settings — and after P1.4 "no
// settings" is a refusal the log attributes to the person, which would then be
// a lie about them (Lesson 1: a swallowed error becomes confident false state).
//
// This reads the CEDRUS project (lib/supabase.js, service role) — the table
// lives beside app_users — NOT the CoS project. `db` is a test seam only.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../lib/supabase.js';

/**
 * The identity columns, named rather than `*`: a renamed column then fails the
 * read loudly (42703) instead of arriving as `undefined` and reading as NULL.
 */
export const IDENTITY_COLUMNS = 'user_id, cos_user_id, usage_user_id';

function readError(where, error) {
  const e = new Error(`user_settings unreadable (${where}): ${(error && error.message) || String(error)}`);
  e.code = (error && error.code) || 'unknown';
  return e;
}

/**
 * ONE scoped read of `user_settings` for this person.
 *
 * @param {string} userId  the person — app_users.id, which is user_settings' key
 * @returns {Promise<{ user_id: string, cos_user_id: string|null, usage_user_id: string|null } | null>}
 *   the row, or null when this person has no row
 * @throws on a read error (never null — see the header), and on a missing or
 *   blank id: an unscoped read is unexpressible, not merely discouraged.
 */
export async function readPersonSettings(userId, { db = supabase } = {}) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      'readPersonSettings refused: a person id (app_users.id) is required. ' +
      `Received: ${userId === undefined ? 'undefined' : JSON.stringify(userId)}`);
  }
  const id = userId.trim();
  const { data, error } = await db
    .from('user_settings')
    .select(IDENTITY_COLUMNS)
    .eq('user_id', id)
    .maybeSingle();
  if (error) throw readError(`person ${id}`, error);
  return data || null;
}

/**
 * Who holds a CoS identity: the user_ids whose row carries a non-NULL
 * cos_user_id. Reads ONE non-personal column.
 *
 * This is how the brief finds its person now that no environment variable
 * names one. It serves one person per tick until B2.2 iterates; the job
 * refuses when this returns more than one (choosing between two people is
 * the guess A9 forbids) and announces when it returns none (B2.3).
 *
 * @returns {Promise<string[]>} user_ids, possibly empty
 * @throws on a read error
 */
export async function listCosIdentityHolders({ db = supabase } = {}) {
  const { data, error } = await db
    .from('user_settings')
    .select('user_id')
    .not('cos_user_id', 'is', null);
  if (error) throw readError('listing CoS identity holders', error);
  return (Array.isArray(data) ? data : []).map((r) => String(r.user_id));
}
