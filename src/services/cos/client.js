// ─────────────────────────────────────────────────────────────────────────────
// Chief of Staff (CoS) client — the ONLY door between Cedrus and the CoS
// Supabase project (ref kpzyzjhfvjfvxowhusir, a SEPARATE project from this
// backend's qjwbtlnwnjjuvrwblkzx).
//
// WHY THIS MODULE EXISTS AT ALL
// CoS was deliberately built to never act autonomously: its Edge Functions
// require an AAL2 (MFA-verified) JWT unconditionally, they explicitly refuse
// service_role, and nothing in that project is scheduled. We are NOT changing
// any of that. Cedrus reaches CoS's DATABASE directly with service_role and
// leaves every one of CoS's own guarantees intact — no CoS code is modified,
// no CoS Edge Function is invoked, no CoS migration is run.
//
// THE STRUCTURAL READ-ONLY GUARANTEE
// This module NEVER exports the raw Supabase client. It exports exactly two
// verbs:
//
//   cosSelect(table, build)     — read, and only from READABLE_TABLES
//   cosInsertTodayBrief(row)    — the single permitted write, hard-pinned to
//                                 the literal string 'today_briefs'
//
// There is no exported handle through which any other table could be written,
// no .rpc(), no .delete(), no .update(), and no way to pass a table name into
// the write path. Making this module write to a second table requires EDITING
// THIS FILE — it cannot be done from a caller. That is the structural claim,
// and Bundle 38 asserts it against the module's real export surface.
//
// DISARMED BY DEFAULT (Lesson 7)
// COS_SUPABASE_URL and COS_SERVICE_ROLE_KEY unset ⇒ DISARMED. Disarmed is a
// legitimate operating mode, never an error: the job announces the mode on
// EVERY run and does nothing. Silence must never read as "checked and fine",
// so both the armed and disarmed paths emit a mode line.
//
// NAMESPACE NOTE (Lesson 14): the vars are COS_-prefixed, not SUPABASE_-
// prefixed. This backend's own SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// required() at boot and point at the CEDRUS project; colliding on those names
// would silently aim CoS reads at the wrong database.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { logger } from '../../utils/logger.js';

// The eight tables the brief is allowed to read. A table not on this list
// cannot be reached through cosSelect at all — the guard throws rather than
// returning empty, because "silently read nothing" is the exact shape that
// produces a confidently wrong brief (Lesson 1).
export const READABLE_TABLES = Object.freeze([
  'workstreams',
  'open_loops',
  'decisions',
  'captures',
  'agent_runs',
  'email_messages',
  'email_ai_analyses',
  'today_briefs',
]);

// The single writable table. Pinned as a constant so the write path has no
// parameter a caller could influence.
export const WRITABLE_TABLE = 'today_briefs';

/**
 * Read the CoS credentials out of an env object.
 *
 * Both must be present to arm. One-of-two is treated as DISARMED and reported
 * as `partial`, because a half-configured integration is a misconfiguration a
 * human needs to see — not something to guess the intent of.
 */
export function cosEnv(env = process.env) {
  const url = (env.COS_SUPABASE_URL || '').trim();
  const key = (env.COS_SERVICE_ROLE_KEY || '').trim();
  const armed = Boolean(url && key);
  const partial = Boolean(url) !== Boolean(key);
  return { url, key, armed, partial };
}

/**
 * One line, every run, in both modes. Lesson 7: a guard that cannot say which
 * mode it ran in is indistinguishable from a guard that did not run.
 */
export function announceCosMode(env = process.env) {
  const { armed, partial, url } = cosEnv(env);
  if (armed) {
    logger.event('cos.mode', {
      outcome: 'armed',
      // Host only — never the key, never the full URL with any query.
      message: `CoS reader ARMED against ${safeHost(url)}`,
    });
    return { armed: true, partial: false };
  }
  logger.event('cos.mode', {
    outcome: 'disarmed',
    error_category: partial ? 'config' : null,
    message: partial
      ? 'CoS reader DISARMED — exactly one of COS_SUPABASE_URL / COS_SERVICE_ROLE_KEY is set. ' +
        'Both are required. Set the missing one, or unset both to disarm deliberately.'
      : 'CoS reader DISARMED — COS_SUPABASE_URL and COS_SERVICE_ROLE_KEY are unset. ' +
        'This is the default and is not an error: no CoS read, no brief, no send.',
  });
  return { armed: false, partial };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return 'unparseable-url'; }
}

// Lazily constructed so importing this module never touches the network and
// never throws on a machine with no CoS credentials (every test run, and the
// entire battery, imports it disarmed).
let cached = null;
let cachedKey = '';

function cosClient(env = process.env) {
  const { url, key, armed } = cosEnv(env);
  if (!armed) return null;
  const fingerprint = `${url}\u0000${key}`;
  if (cached && cachedKey === fingerprint) return cached;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedKey = fingerprint;
  return cached;
}

/** Test seam: drop the memoized client so an env change takes effect. */
export function resetCosClient() {
  cached = null;
  cachedKey = '';
}

/**
 * The read verb. `build` receives a PostgREST query builder already pinned to
 * `table` with .select() applied, and may narrow it further (.eq, .order,
 * .limit, .gte). It cannot widen it to another table.
 *
 * Returns { rows, error }. supabase-js resolves { data, error } rather than
 * throwing (Lesson 11 — the single most load-bearing fact in the doctrine), so
 * this binds `error` explicitly and every caller gets a two-state answer. A
 * read that failed returns rows: null, NOT an empty array — "couldn't read"
 * and "read, found nothing" must never collapse into the same value.
 */
export async function cosSelect(table, build, { env = process.env, columns = '*' } = {}) {
  if (!READABLE_TABLES.includes(table)) {
    throw new Error(
      `cosSelect refused: '${table}' is not in READABLE_TABLES. ` +
      `Add it to that list deliberately if a new table really is needed.`);
  }
  const client = cosClient(env);
  if (!client) return { rows: null, error: null, disarmed: true };

  try {
    let query = client.from(table).select(columns);
    if (typeof build === 'function') query = build(query) || query;
    const { data, error } = await query;
    if (error) {
      reportCosRead(table, error);
      return { rows: null, error, disarmed: false };
    }
    return { rows: data || [], error: null, disarmed: false };
  } catch (err) {
    reportCosRead(table, err);
    return { rows: null, error: err, disarmed: false };
  }
}

/**
 * The ONLY write. The table is the pinned constant, not an argument.
 *
 * Returns { id, error }. A failed insert is announced and returns id: null —
 * the caller decides what that means; this never pretends a write landed.
 */
export async function cosInsertTodayBrief(row, { env = process.env } = {}) {
  const client = cosClient(env);
  if (!client) return { id: null, error: null, disarmed: true };

  try {
    const { data, error } = await client
      .from(WRITABLE_TABLE)
      .insert(row)
      .select('id')
      .single();
    if (error) {
      logger.event('cos.write.failed', {
        level: 'error',
        error_category: 'db_error',
        error_code: error.code || 'unknown',
        message: `CoS today_briefs insert failed — the brief was NOT written back: ${error.message || String(error)}`,
      });
      return { id: null, error, disarmed: false };
    }
    return { id: (data && data.id) || null, error: null, disarmed: false };
  } catch (err) {
    logger.event('cos.write.failed', {
      level: 'error',
      error_category: 'db_error',
      error_code: (err && err.code) || 'unknown',
      message: `CoS today_briefs insert threw — the brief was NOT written back: ${(err && err.message) || String(err)}`,
    });
    return { id: null, error: err, disarmed: false };
  }
}

function reportCosRead(table, error) {
  logger.event('cos.read.failed', {
    level: 'error',
    error_category: 'db_error',
    error_code: (error && error.code) || 'unknown',
    outcome: 'fail_closed',
    message: `CoS ${table} unreadable — the brief cannot be composed from partial data: ` +
      (error ? (error.message || String(error)) : 'query returned no usable result'),
  });
}
