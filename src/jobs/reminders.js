import { supabase } from '../lib/supabase.js';
import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as messages from '../services/messages.js';

// ─────────────────────────────────────────────────────────────────────────
// Reminder dispatch (WS-A item 1 — the double-send fix)
//
// The old flow sent the SMS FIRST, then flipped status to 'sent'. A crash or a
// failed status update after the send re-selected the still-'pending' row next
// tick and RE-SENT it. Fix: an atomic compare-and-swap CLAIM that moves the row
// out of 'pending' BEFORE the Twilio call, so a crash or retry can never
// re-send the same reminder.
//
// State machine mapped onto the reminder status values the schema allows
// (CHECK constraint: pending | sent | snoozed | canceled — a dedicated
// `sending`/`failed` status needs a migration, flagged to WS-C):
//   pending  → not yet dispatched
//   snoozed  → CLAIMED / in-flight (transient: held only during the Twilio
//              call). Reused as the "sending" lane because the schema forbids a
//              new value AND nothing in the product uses `snoozed` today.
//   sent     → confirmed sent (set ONLY after Twilio accepts / dry-run)
//   canceled → user opted out (never send)
//
// Guarantees:
//   • No double-send: the CAS claim (pending→snoozed) is atomic; only one tick
//     can win it, and a crash mid-send leaves the row 'snoozed' (NOT re-selected
//     because dispatch only picks 'pending').
//   • Retryable failure: if Twilio throws BEFORE returning a SID (the send
//     provably did not happen), we revert snoozed→pending so the next tick
//     retries — safe, because nothing was delivered.
//   • `sent` is truthful: only set after a real acceptance (or dry-run).
//
// Residual gap (flagged to WS-C): a crash in the ~1s window between claim and
// Twilio-accept leaves a row stuck at 'snoozed'. Recovering it automatically
// would risk a double-send (we can't tell "crashed before send" from "crashed
// after Twilio accepted"), so we DON'T — the durable fix is a real `sending`
// state + `attempts`/`claimed_at` columns + a lease reaper. Until then such a
// row is visible (delivery callback + this log) rather than silently re-sent.
// ─────────────────────────────────────────────────────────────────────────

// Cron entry (every 5 min, see scheduler.js).
export async function runReminderDispatch(now = new Date()) {
  const jobId = `reminder-dispatch:${now.toISOString().slice(0, 16)}Z`;
  const { data: due, error } = await supabase.from('reminders')
    .select('id, user_id, person_id, title, note, reminder_type')
    .eq('status', 'pending')
    .lte('trigger_at', now.toISOString())
    .order('trigger_at', { ascending: true }) // A10: deterministic, no starvation
    .limit(50);
  if (error) { logger.event('reminder.query.failed', { level: 'error', job_id: jobId, error_category: 'db_error', message: error.message }); return; }
  if (!due || !due.length) { logger.event('reminder.tick.empty', { job_id: jobId }); return; }

  logger.event('reminder.tick', { job_id: jobId, count: due.length });
  for (const r of due) {
    try { await dispatchOne(r, jobId); }
    catch (err) { logger.event('reminder.dispatch.failed', { level: 'error', job_id: jobId, reminder_id: r.id, error_category: 'internal', message: err?.message || String(err) }); }
  }
}

// Atomic claim: move exactly this reminder out of 'pending'. Returns true iff
// THIS call won the row (0 rows ⇒ another tick already claimed it ⇒ skip).
async function claim(reminderId) {
  const { data, error } = await supabase.from('reminders')
    .update({ status: 'snoozed', updated_at: new Date().toISOString() })
    .eq('id', reminderId).eq('status', 'pending')
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

async function setStatus(reminderId, status, extra = {}) {
  await supabase.from('reminders').update({ status, ...extra }).eq('id', reminderId);
}

async function dispatchOne(reminder, jobId) {
  // 1) CLAIM before anything else. This is the idempotency guard.
  const won = await claim(reminder.id);
  if (!won) {
    logger.event('reminder.claim.skipped', { level: 'warn', job_id: jobId, reminder_id: reminder.id, error_category: 'idempotent_skip', outcome: 'duplicate' });
    return;
  }

  const { data: user } = await supabase.from('app_users')
    .select('id, phone, opted_out').eq('id', reminder.user_id).maybeSingle();

  // A reminder for an opted-out (or deleted) user is canceled, never sent —
  // respecting an opt-out always wins over a pending reminder.
  if (!user || user.opted_out) {
    await setStatus(reminder.id, 'canceled');
    logger.event('reminder.canceled', { job_id: jobId, reminder_id: reminder.id, user_ref: 'u_' + reminder.user_id, reason: user ? 'opted_out' : 'no_user', outcome: 'skipped' });
    return;
  }

  const text = `Reminder: ${reminder.title}${reminder.note ? ' - ' + reminder.note : ''}`;
  const userRef = 'u_' + user.id;

  // 2) DRY-RUN: no Twilio. Treat as a successful send so it isn't re-dispatched.
  if (config.briefDryRun) {
    const msg = await messages.logOutbound({
      userId: user.id, body: text, messageType: 'reminder', providerStatus: 'dry_run',
    });
    await setStatus(reminder.id, 'sent', { sent_message_id: msg.id });
    logger.event('reminder.dry_run', { job_id: jobId, reminder_id: reminder.id, user_ref: userRef, message_type: 'reminder', body_len: text.length, outcome: 'sent' });
    return;
  }

  // 3) REAL SEND. Only after Twilio accepts do we mark 'sent'.
  let sent;
  try {
    sent = await sendSms(user.phone, text);
  } catch (err) {
    // Twilio threw before returning a SID ⇒ nothing was delivered ⇒ it is safe
    // to revert to 'pending' and retry next tick. This never double-sends.
    await setStatus(reminder.id, 'pending');
    logger.event('reminder.send.failed', {
      level: 'error', job_id: jobId, reminder_id: reminder.id, user_ref: userRef,
      provider_id: 'twilio', error_category: 'provider_error',
      error_code: err?.code ? String(err.code) : undefined,
      outcome: 'error', message: 'send failed; reverted to pending (retryable)',
    });
    return;
  }

  const providerId = sent?.sid || null;
  const msg = await messages.logOutbound({
    userId: user.id, body: text, messageType: 'reminder',
    providerMessageId: providerId, providerStatus: sent?.status || 'queued',
  });
  await setStatus(reminder.id, 'sent', { sent_message_id: msg.id });
  logger.event('reminder.sent', {
    job_id: jobId, reminder_id: reminder.id, user_ref: userRef, provider_id: 'twilio',
    provider_message_id: providerId || undefined, message_type: 'reminder',
    body_len: text.length, outcome: 'sent',
  });
}
