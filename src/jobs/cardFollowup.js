import { supabase } from '../lib/supabase.js';
import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as messages from '../services/messages.js';
import { localParts } from '../utils/time.js';
import { isInSuppressionWindow } from '../services/safetyFlags.js';
import { transitionCard, estimateSegments, CARD_WINDOW_START, CARD_WINDOW_END } from '../services/cards.js';

// ─────────────────────────────────────────────────────────────────────────────
// Card follow-up (night build 2026-07-28, item 2). Cron entry, hourly.
//
// Three days after a YES, ask whether the time together actually happened —
// spec PART 2 step 4, the hinge of the whole loop. Only the user's answer
// advances a tree; this job only ASKS. Same rails as the sender: dry-run
// exactly like weeklyBrief.js:77, daytime window, §6 cooldown, CAS claim,
// opted-out cancel. Budget kill switch enforced at the scheduler gate.
// ─────────────────────────────────────────────────────────────────────────────

export async function runCardFollowup(now = new Date()) {
  const jobId = `card-followup:${now.toISOString().slice(0, 16)}Z`;
  const { data: due, error } = await supabase
    .from('opportunity_cards').select('*')
    .eq('status', 'accepted')
    .lte('followup_due_at', now.toISOString());
  if (error) {
    logger.event('card.followup.query.failed', { level: 'error', job_id: jobId, error_category: 'db_error', error_code: error.code || 'unknown', message: error.message || String(error) });
    return;
  }
  if (!due || !due.length) { logger.event('card.followup.tick.empty', { job_id: jobId }); return; }
  logger.event('card.followup.tick', { job_id: jobId, count: due.length });

  for (const card of due) {
    try { await followupOne(card, now, jobId); }
    catch (err) {
      logger.event('card.followup.send.failed', { level: 'error', job_id: jobId, error_category: 'internal', message: `card ${card.id}: ${err?.message || String(err)}` });
    }
  }
}

async function followupOne(card, now, jobId) {
  const { data: user, error } = await supabase
    .from('app_users').select('id, phone, timezone, opted_out')
    .eq('id', card.user_id).maybeSingle();
  if (error || !user) {
    logger.event('card.user.read_failed', { level: 'error', job_id: jobId, error_category: 'db_error', user_ref: 'u_' + card.user_id, message: (error && error.message) || 'user row not found' });
    return;
  }

  if (user.opted_out) {
    await transitionCard(card.id, 'accepted', { status: 'canceled' });
    logger.event('card.canceled', { job_id: jobId, user_ref: 'u_' + user.id, reason: 'opted_out', outcome: 'canceled', message: `follow-up for card ${card.id} canceled: user opted out` });
    return;
  }

  if (await isInSuppressionWindow(user.id)) {
    logger.event('card.held', { job_id: jobId, user_ref: 'u_' + user.id, reason: 'safety_suppression_window', message: `follow-up for card ${card.id} held this tick (§6 cooldown)` });
    return;
  }

  const { hour } = localParts(user.timezone, now);
  if (hour < CARD_WINDOW_START || hour >= CARD_WINDOW_END) {
    logger.event('card.held', { job_id: jobId, user_ref: 'u_' + user.id, reason: 'outside_daytime_window', message: `follow-up for card ${card.id} held: local hour ${hour}` });
    return;
  }

  // Person's first name makes the question concrete; fall back gracefully.
  let first = null;
  const { data: person } = await supabase
    .from('people').select('name').eq('id', card.person_id).eq('user_id', user.id).maybeSingle();
  if (person && person.name) first = String(person.name).trim().split(/\s+/)[0];
  const text = first
    ? `Quick one - did you and ${first} end up getting together? YES if you did, NO if it didn't happen.`
    : "Quick one - did that get-together end up happening? YES if it did, NO if it didn't.";

  // CAS claim so a slow tick can never double-ask.
  const claimed = await transitionCard(card.id, 'accepted', { status: 'followup_sending' });
  if (!claimed) return;

  const segments = estimateSegments(text);
  if (config.briefDryRun) {
    const msg = await messages.logOutbound({ userId: user.id, body: text, messageType: 'card_followup', providerStatus: 'dry_run', segments });
    await transitionCard(card.id, 'followup_sending', { status: 'followup_sent', followup_sent_at: now.toISOString(), followup_message_id: msg.id });
    logger.event('card.followup.dry_run', { job_id: jobId, user_ref: 'u_' + user.id, message_type: 'card_followup', body_len: text.length, segments, outcome: 'sent', message: `card ${card.id}` });
    return;
  }

  let sent;
  try {
    sent = await sendSms(user.phone, text);
  } catch (err) {
    await transitionCard(card.id, 'followup_sending', { status: 'accepted' }); // provably unsent → retry next tick
    logger.event('card.followup.send.failed', { level: 'error', job_id: jobId, user_ref: 'u_' + user.id, error_category: 'provider_error', outcome: 'error', message: `card ${card.id}: ${err?.message || String(err)} (reverted to accepted)` });
    return;
  }

  const msg = await messages.logOutbound({ userId: user.id, body: text, messageType: 'card_followup', providerMessageId: sent?.sid || null, providerStatus: sent?.status || 'queued', segments });
  await transitionCard(card.id, 'followup_sending', { status: 'followup_sent', followup_sent_at: now.toISOString(), followup_message_id: msg.id });
  logger.event('card.followup.sent', { job_id: jobId, user_ref: 'u_' + user.id, provider_message_id: sent?.sid || undefined, message_type: 'card_followup', body_len: text.length, segments, outcome: 'sent', message: `card ${card.id}` });
}
