import { supabase } from '../lib/supabase.js';
import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as messages from '../services/messages.js';
import { localParts } from '../utils/time.js';
import { isInSuppressionWindow } from '../services/safetyFlags.js';
// NOTE: single-line import — the concat rigs' strip removes only lines that
// START with `import `, so a multi-line import leaves orphaned syntax behind.
import { hasActiveSuppression, countRecentSends, transitionCard, estimateSegments, CARD_WEEKLY_CAP, CARD_WINDOW_START, CARD_WINDOW_END } from '../services/cards.js';
import { OUTBOUND_REFUSED } from '../lib/smsAllowlist.js';

// ─────────────────────────────────────────────────────────────────────────────
// Card sender (night build 2026-07-28, item 2). Cron entry, every 15 min.
//
// Sends queued opportunity cards over the EXISTING SMS path, honoring
// BRIEF_DRY_RUN exactly like weeklyBrief.js:77 — under dry-run nothing touches
// Twilio; the card is recorded, linked to a messages row (provider_status
// 'dry_run'), and marked sent, so the whole rail is rehearsable end to end.
//
// Rails, in order, all announced (no silent caps — doctrine):
//   • opted-out user           → cards canceled (mirror reminders.js)
//   • §6 crisis cooldown       → user held this tick (cards are optional
//                                 playful content; isInSuppressionWindow is
//                                 read-only — Law 2, import-only like the six
//                                 existing consumers)
//   • daytime window 10–19 local (same constants as sweeps — a 3am card is a
//                                 product bug even in a "daytime" product)
//   • HARD CAP 3 sends / user / rolling 7 days (spec PART 3: 2–3 a week,
//                                 never daily). Cap unreadable → HOLD, not
//                                 send: cards are never urgent, so this one
//                                 fails CLOSED — the polite direction.
//   • suppression re-check at send time (NOT THEM/NEVER may have landed after
//                                 queueing; the send-time check is the promise)
//   • CAS claim queued→sending (reminders-style: a crash can never double-send)
//
// Budget kill switch: enforced upstream at the scheduler's outbound gate.
// ─────────────────────────────────────────────────────────────────────────────

export async function runCardSender(now = new Date()) {
  const jobId = `card-sender:${now.toISOString().slice(0, 16)}Z`;
  const { data: queued, error } = await supabase
    .from('opportunity_cards').select('*').eq('status', 'queued');
  if (error) {
    logger.event('card.query.failed', { level: 'error', job_id: jobId, error_category: 'db_error', error_code: error.code || 'unknown', message: error.message || String(error) });
    return;
  }
  const due = (queued || []).filter((c) => !c.send_after || new Date(c.send_after) <= now);
  if (!due.length) { logger.event('card.tick.empty', { job_id: jobId }); return; }

  const byUser = new Map();
  for (const c of due) {
    if (!byUser.has(c.user_id)) byUser.set(c.user_id, []);
    byUser.get(c.user_id).push(c);
  }
  logger.event('card.tick', { job_id: jobId, count: due.length });

  for (const [userId, cards] of byUser) {
    try { await sendForUser(userId, cards, now, jobId); }
    catch (err) {
      logger.event('card.send.failed', { level: 'error', job_id: jobId, error_category: 'internal', message: `user ${userId}: ${err?.message || String(err)}` });
    }
  }
}

async function sendForUser(userId, cards, now, jobId) {
  const { data: user, error } = await supabase
    .from('app_users').select('id, phone, timezone, opted_out')
    .eq('id', userId).maybeSingle();
  if (error || !user) {
    logger.event('card.user.read_failed', { level: 'error', job_id: jobId, error_category: 'db_error', user_ref: 'u_' + userId, message: (error && error.message) || 'user row not found' });
    return;
  }

  if (user.opted_out) {
    for (const card of cards) await transitionCard(card.id, 'queued', { status: 'canceled' });
    logger.event('card.canceled', { job_id: jobId, user_ref: 'u_' + userId, reason: 'opted_out', count: cards.length, outcome: 'canceled', message: 'queued cards canceled: user has opted out' });
    return;
  }

  if (await isInSuppressionWindow(userId)) {
    logger.event('card.held', { job_id: jobId, user_ref: 'u_' + userId, reason: 'safety_suppression_window', count: cards.length, message: 'cards held this tick (§6 crisis cooldown)' });
    return;
  }

  const { hour } = localParts(user.timezone, now);
  if (hour < CARD_WINDOW_START || hour >= CARD_WINDOW_END) {
    logger.event('card.held', { job_id: jobId, user_ref: 'u_' + userId, reason: 'outside_daytime_window', count: cards.length, message: `cards held: local hour ${hour}` });
    return;
  }

  let sentCount = await countRecentSends(userId, now);
  if (sentCount == null) {
    // Cap unreadable → HOLD (fail closed). Cards are optional; over-sending is
    // the harm the cap exists to prevent, so doubt means don't.
    logger.event('card.held', { job_id: jobId, user_ref: 'u_' + userId, reason: 'cap_unreadable', count: cards.length, message: 'cards held: rolling-7d send count unreadable' });
    return;
  }

  for (const card of cards) {
    if (sentCount >= CARD_WEEKLY_CAP) {
      logger.event('card.cap.held', { job_id: jobId, user_ref: 'u_' + userId, reason: 'weekly_cap', count: sentCount, message: `card ${card.id} held: ${sentCount}/${CARD_WEEKLY_CAP} sends in rolling 7d` });
      continue;
    }

    // The promise re-checked at the last moment: NOT THEM/NEVER may have
    // landed after this card was queued.
    if (await hasActiveSuppression({ userId, personId: card.person_id, kind: card.kind })) {
      await transitionCard(card.id, 'queued', { status: 'suppressed' });
      logger.event('card.suppressed', { job_id: jobId, user_ref: 'u_' + userId, reason: 'suppressed_pairing', outcome: 'suppressed', message: `card ${card.id} suppressed at send time` });
      continue;
    }

    // CAS claim before any send attempt (no double-send, reminders-style).
    const claimed = await transitionCard(card.id, 'queued', { status: 'sending' });
    if (!claimed) continue;

    const segments = estimateSegments(card.body);
    if (config.briefDryRun) {
      // Never log the phone or the body (A8) — body_len only.
      const msg = await messages.logOutbound({ userId, body: card.body, messageType: 'card', providerStatus: 'dry_run', segments });
      await transitionCard(card.id, 'sending', { status: 'sent', sent_at: now.toISOString(), sent_message_id: msg.id });
      // outcome 'dry_run', not 'sent': a rehearsal that reports outcome:'sent' is
      // indistinguishable from a delivery in every log query.
      logger.event('card.dry_run', { job_id: jobId, user_ref: 'u_' + userId, message_type: 'card', body_len: card.body.length, segments, outcome: 'dry_run', message: `card ${card.id} rehearsed, not sent` });
      sentCount++;
      continue;
    }

    let sent;
    try {
      sent = await sendSms(user.phone, card.body);
    } catch (err) {
      if (err?.code === OUTBOUND_REFUSED) {
        // Permanent refusal → cancel, same as the opted-out branch. Requeuing
        // would retry a number we will never send to, on every tick.
        await transitionCard(card.id, 'sending', { status: 'canceled' });
        logger.event('card.canceled', { job_id: jobId, user_ref: 'u_' + userId, reason: 'not_allowlisted', outcome: 'canceled', message: `card ${card.id} canceled: recipient not on ALLOWED_PHONES` });
        continue;
      }
      // Provably not delivered → back to queued; the next tick retries.
      await transitionCard(card.id, 'sending', { status: 'queued' });
      logger.event('card.send.failed', { level: 'error', job_id: jobId, user_ref: 'u_' + userId, error_category: 'provider_error', outcome: 'error', message: `card ${card.id}: ${err?.message || String(err)} (reverted to queued)` });
      continue;
    }

    const msg = await messages.logOutbound({ userId, body: card.body, messageType: 'card', providerMessageId: sent?.sid || null, providerStatus: sent?.status || 'queued', segments });
    await transitionCard(card.id, 'sending', { status: 'sent', sent_at: now.toISOString(), sent_message_id: msg.id });
    logger.event('card.sent', { job_id: jobId, user_ref: 'u_' + userId, provider_message_id: sent?.sid || undefined, message_type: 'card', body_len: card.body.length, segments, outcome: 'sent', message: `card ${card.id}` });
    sentCount++;
  }
}
