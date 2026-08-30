// ─────────────────────────────────────────────────────────────────────────────
// Send ledger — makes the daily brief idempotent, so a retry cannot double-send.
//
// ── WHY system_flags AND NOT A NEW TABLE ────────────────────────────────────
// A dedicated `cos_brief_sends` table would be the textbook choice. It would
// also require a MIGRATION, and applying one is a hard stop for this session.
// `system_flags` already exists in prod (added 2026-07-29 with the budget
// guard) and is exactly the right shape: `key text PRIMARY KEY, value jsonb,
// updated_at timestamptz`. One row per UTC day, keyed by date.
//
// This is not a workaround that costs correctness. The PRIMARY KEY on `key` is
// what makes the claim atomic, which is the entire mechanism — a purpose-built
// table would rely on the same guarantee.
//
// ── THE MECHANISM: CLAIM BEFORE SEND ────────────────────────────────────────
// A plain INSERT (never upsert) is the claim. If the row already exists
// Postgres raises 23505 and the second caller loses the race and does not send.
// Two ticks firing concurrently therefore produce exactly one send, decided by
// the database rather than by timing.
//
//   1. INSERT {status:'claimed'}   → 23505 means someone else owns today. STOP.
//   2. send through the transport
//   3. UPDATE to {status:'sent', provider_message_id}
//
// ── FAILING CLOSED ON AMBIGUITY, DELIBERATELY ───────────────────────────────
// If the process dies between step 2 and step 3 the row stays 'claimed'. The
// next tick sees 'claimed' and REFUSES to send, because we cannot tell "the
// email went out and we failed to record it" from "it never went out".
// Re-sending would risk a duplicate in the owner's inbox; refusing risks a
// missing brief. A duplicate is the worse failure, and a missing brief is
// visible (no email arrived) while a duplicate is not preventable after the
// fact.
//
// That refusal is announced at error level with the exact key to clear, so it
// is never a silent no-op (Lesson 1 / Lesson 7). Clearing one stuck row is a
// one-line delete a human can run; an unwanted duplicate cannot be recalled.
//
// ── FAIL OPEN vs FAIL CLOSED, THE OTHER DIRECTION ───────────────────────────
// If the ledger itself is UNREADABLE (table missing, DB error), this fails
// CLOSED — no send. That is the opposite of the budget guard's fail-open
// posture, and the difference is deliberate: the budget guard failing closed
// would silence the whole product, whereas this failing open would put
// unbounded duplicate email in the owner's inbox. Match the failure mode to
// what the failure costs.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';

export const LEDGER_KEY_PREFIX = 'cos_brief_send:';

/**
 * One claim per user per UTC day: `cos_brief_send:<user_id>:<YYYY-MM-DD>`.
 *
 * ── THE BUG THIS SHAPE FIXES (2026-08-30) ───────────────────────────────────
 * This returned `cos_brief_send:<date>` — one claim per DAY, globally. With one
 * owner that was correct. With two people the first brief composed claimed the
 * day and the second was refused `already_sent`.
 *
 * What made it dangerous rather than merely wrong: the refusal travels the
 * FAIL-CLOSED path, so in the logs it is byte-identical to correct duplicate
 * prevention. Dad's brief would never arrive, every run would look healthy, and
 * nothing anywhere would say otherwise. A silent stop is worse than a loud one.
 *
 * ── WHY userId IS REQUIRED, NOT DEFAULTED ───────────────────────────────────
 * A default would re-create the global key under a new name: every caller that
 * forgot to pass a user would share one slot again, and the same silent
 * suppression would return. Throwing means a caller that forgets fails on its
 * first tick, loudly, instead of quietly refusing to send someone's brief.
 *
 * The key survives logger.scrub() intact — a UUID and an ISO date are both
 * masked before the phone pass (Bundle 39), so the key can be quoted in log
 * lines without becoming `[phone:0830]`.
 */
export function ledgerKey({ userId, now = new Date() } = {}) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      'ledgerKey refused: a send claim requires an explicit user id. ' +
      'A day-only key is one claim for everyone, and the second user is ' +
      'silently refused as already_sent.');
  }
  return LEDGER_KEY_PREFIX + userId.trim() + ':' + now.toISOString().slice(0, 10);
}

/**
 * Split a key back into its parts, so a log line can name the day without the
 * uuid. `key.slice(LEDGER_KEY_PREFIX.length)` used to be the date; it is now
 * `<user_id>:<date>`, and a message built from it would read as if the user id
 * were the calendar day.
 */
export function ledgerKeyParts(key) {
  const rest = String(key).slice(LEDGER_KEY_PREFIX.length);
  const cut = rest.lastIndexOf(':');
  if (cut === -1) return { userId: null, date: rest };
  return { userId: rest.slice(0, cut), date: rest.slice(cut + 1) };
}

/**
 * A claim may only be settled by the user who took it.
 *
 * markSent() and releaseClaim() receive the key that claimSend() returned
 * rather than rebuilding it — the run may cross midnight between claiming and
 * sending, and rebuilding from a fresh `now` would settle the wrong day. But
 * taking the key as an opaque string means nothing checks that it is THIS
 * user's key, so a threading mistake in the iterating job (Session B) would
 * mark user A's day sent when user B's brief went out. This is that check.
 */
function assertKeyBelongsTo(key, userId, verb) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(`${verb} refused: a ledger settlement requires an explicit user id.`);
  }
  const expected = LEDGER_KEY_PREFIX + userId.trim() + ':';
  if (!String(key).startsWith(expected)) {
    throw new Error(
      `${verb} refused: ledger key '${key}' does not belong to the user settling it. ` +
      'Settling another user\'s claim would mark their day sent for a brief they never received.');
  }
}

/**
 * READ-ONLY: has today's brief already been sent, or already been claimed?
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────
 * It is a cost gate, not a lock. claimSend() below is still the only thing that
 * decides a race, and this CANNOT replace it: between this SELECT and that
 * INSERT another tick can claim the day, so a `blocked: false` here is a
 * statement about the past, not a reservation of the future. The claim stays
 * exactly where it is, and the 23505 path stays the mechanism.
 *
 * What it buys is the price of a run that was always going to be refused. The
 * old order gathered eight CoS tables and paid for a model call BEFORE the
 * ledger got a chance to say "already sent today" — so every retry, redeploy or
 * duplicate tick after a completed send cost a full billable compose to reach a
 * no. This asks the cheap question first.
 *
 * ── NO INSERT, NO UPDATE, AND THAT IS LOAD-BEARING ──────────────────────────
 * A single SELECT. If this ever wrote, it would consume the day's slot on a run
 * that has composed nothing and sent nothing — the exact stuck-'claimed' state
 * the module's header explains is unrecoverable without a human deleting a row.
 *
 * ── UNREADABLE FAILS **OPEN**, THE OPPOSITE OF claimSend ────────────────────
 * Deliberate, and safe only because of what comes after. A broken ledger here
 * returns { blocked: false, unavailable: true } and the run continues into
 * claimSend(), which reads the same table and fails CLOSED on the same error.
 * So the fail-closed guarantee is unchanged; failing closed HERE as well would
 * add nothing and would let one flaky read suppress a brief that the real guard
 * would have allowed.
 *
 * Returns one of:
 *   { blocked: false }
 *   { blocked: true,  reason: 'already_sent',    sentAt }
 *   { blocked: true,  reason: 'already_claimed', sentAt: null }
 *   { blocked: false, unavailable: true, errorCode, errorMessage }
 *
 * The error detail rides along on the unavailable shape rather than being
 * swallowed: this runs before the model call, so a run that dies at the model
 * would otherwise never reach claimSend's own diagnostic and the cause would be
 * invisible (Lesson 1, Lesson 17).
 */
export async function alreadySentToday({ userId, now = new Date(), db = supabase } = {}) {
  const key = ledgerKey({ userId, now });
  try {
    const { data, error } = await db
      .from('system_flags').select('value').eq('key', key).maybeSingle();
    if (error) {
      return {
        blocked: false,
        unavailable: true,
        errorCode: error.code || 'unknown',
        errorMessage: error.message || String(error),
      };
    }
    const value = data ? data.value : null;
    if (value && value.status === 'sent') {
      return { blocked: true, reason: 'already_sent', sentAt: value.sent_at || null };
    }
    // A row still 'claimed' means an earlier run took the day and did not
    // finish. claimSend() refuses that case as 'in_flight' and says so at error
    // level; naming it differently here keeps "the precheck saw it" and "the
    // claim saw it" distinguishable in the logs rather than blurring two
    // different moments into one word.
    if (value && value.status === 'claimed') {
      return { blocked: true, reason: 'already_claimed', sentAt: null };
    }
    return { blocked: false };
  } catch (err) {
    return {
      blocked: false,
      unavailable: true,
      errorCode: (err && err.code) || 'unknown',
      errorMessage: (err && err.message) || String(err),
    };
  }
}

/**
 * Attempt to claim today's send.
 *
 * Returns one of:
 *   { claimed: true,  key }
 *   { claimed: false, reason: 'already_sent',   key, sentAt }
 *   { claimed: false, reason: 'in_flight',      key }   — stuck 'claimed' row
 *   { claimed: false, reason: 'ledger_unreadable', key } — fail closed
 */
export async function claimSend({ userId, now = new Date(), db = supabase } = {}) {
  const key = ledgerKey({ userId, now });

  // Read first: gives a precise reason for the common "already done today"
  // case instead of a bare constraint violation.
  let existing = null;
  try {
    const { data, error } = await db
      .from('system_flags').select('value').eq('key', key).maybeSingle();
    if (error) {
      logger.event('cos.ledger.unreadable', {
        level: 'error',
        error_category: 'db_error',
        error_code: error.code || 'unknown',
        outcome: 'fail_closed',
        message: `send ledger unreadable (${key}) — refusing to send rather than risk a duplicate: ` +
          (error.message || String(error)),
      });
      return { claimed: false, reason: 'ledger_unreadable', key };
    }
    existing = data ? data.value : null;
  } catch (err) {
    logger.event('cos.ledger.unreadable', {
      level: 'error',
      error_category: 'db_error',
      error_code: (err && err.code) || 'unknown',
      outcome: 'fail_closed',
      message: `send ledger threw (${key}) — refusing to send rather than risk a duplicate: ` +
        ((err && err.message) || String(err)),
    });
    return { claimed: false, reason: 'ledger_unreadable', key };
  }

  if (existing && existing.status === 'sent') {
    logger.event('cos.send.skipped', {
      outcome: 'already_sent',
      message: `brief already sent for ${ledgerKeyParts(key).date} — not sending again`,
    });
    return { claimed: false, reason: 'already_sent', key, sentAt: existing.sent_at || null };
  }

  if (existing && existing.status === 'claimed') {
    logger.event('cos.send.stuck', {
      level: 'error',
      error_category: 'internal',
      outcome: 'fail_closed',
      message:
        `send ledger row '${key}' is still 'claimed' from an earlier run that did not finish. ` +
        'REFUSING to send: we cannot tell whether that email went out. ' +
        `If no brief arrived, clear the row (delete from system_flags where key = '${key}') and the next tick will send.`,
    });
    return { claimed: false, reason: 'in_flight', key };
  }

  // The claim itself. INSERT, never upsert — the PK collision IS the lock.
  try {
    const { error } = await db.from('system_flags').insert({
      key,
      value: { status: 'claimed', claimed_at: now.toISOString() },
      updated_at: now.toISOString(),
    });
    if (error) {
      if (error.code === '23505') {
        logger.event('cos.send.skipped', {
          outcome: 'lost_race',
          message: `another run claimed ${key} first — not sending again`,
        });
        return { claimed: false, reason: 'already_sent', key, sentAt: null };
      }
      logger.event('cos.ledger.unreadable', {
        level: 'error',
        error_category: 'db_error',
        error_code: error.code || 'unknown',
        outcome: 'fail_closed',
        message: `send ledger claim failed (${key}) — refusing to send: ${error.message || String(error)}`,
      });
      return { claimed: false, reason: 'ledger_unreadable', key };
    }
    return { claimed: true, key };
  } catch (err) {
    logger.event('cos.ledger.unreadable', {
      level: 'error',
      error_category: 'db_error',
      error_code: (err && err.code) || 'unknown',
      outcome: 'fail_closed',
      message: `send ledger claim threw (${key}) — refusing to send: ${(err && err.message) || String(err)}`,
    });
    return { claimed: false, reason: 'ledger_unreadable', key };
  }
}

/**
 * Mark the claim delivered. Called only after the transport confirms.
 *
 * A failure here is announced but does NOT undo the send — the email really
 * went out, and the honest record of that is a loud log line plus a row stuck
 * in 'claimed', which the next run refuses to send past. That is the safe
 * direction of ambiguity.
 */
export async function markSent({ key, userId, providerMessageId = null, provider = null, briefId = null, now = new Date(), db = supabase } = {}) {
  assertKeyBelongsTo(key, userId, 'markSent');
  const value = {
    status: 'sent',
    sent_at: now.toISOString(),
    provider,
    provider_message_id: providerMessageId,
    cos_brief_id: briefId,
  };
  try {
    const { error } = await db.from('system_flags')
      .update({ value, updated_at: now.toISOString() })
      .eq('key', key);
    if (error) {
      logger.event('cos.ledger.mark_failed', {
        level: 'error',
        error_category: 'db_error',
        error_code: error.code || 'unknown',
        message: `THE BRIEF WAS SENT but the ledger row '${key}' could not be marked sent: ` +
          `${error.message || String(error)}. The row stays 'claimed', so no further send will occur today.`,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.event('cos.ledger.mark_failed', {
      level: 'error',
      error_category: 'db_error',
      error_code: (err && err.code) || 'unknown',
      message: `THE BRIEF WAS SENT but marking the ledger row '${key}' threw: ${(err && err.message) || String(err)}`,
    });
    return false;
  }
}

/**
 * Release a claim taken for a send that provably never happened (the transport
 * refused before any network call). Lets a transient config error retry on the
 * next tick instead of blocking the whole day.
 *
 * Only ever called when we KNOW nothing was transmitted.
 */
export async function releaseClaim({ key, userId, now = new Date(), db = supabase } = {}) {
  assertKeyBelongsTo(key, userId, 'releaseClaim');
  try {
    const { error } = await db.from('system_flags').delete().eq('key', key);
    if (error) {
      logger.event('cos.ledger.release_failed', {
        level: 'error',
        error_category: 'db_error',
        error_code: error.code || 'unknown',
        message: `could not release unused claim '${key}': ${error.message || String(error)}. ` +
          'Nothing was sent; today\'s brief will be skipped until the row is cleared.',
      });
      return false;
    }
    void now;
    return true;
  } catch (err) {
    logger.event('cos.ledger.release_failed', {
      level: 'error',
      error_category: 'db_error',
      error_code: (err && err.code) || 'unknown',
      message: `releasing unused claim '${key}' threw: ${(err && err.message) || String(err)}`,
    });
    return false;
  }
}
