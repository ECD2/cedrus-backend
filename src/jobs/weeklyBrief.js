import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { localWeekOf } from '../utils/time.js';
import * as briefs from '../services/briefs.js';
import * as messages from '../services/messages.js';
import * as usersSvc from '../services/users.js';
import * as rel from '../services/relationships.js';
import * as usage from '../services/usage.js';
import { getUsersDueForBrief } from './brief/eligibility.js';
import { gatherCandidates } from './brief/gather.js';
import { selectBriefItems } from './brief/select.js';
import { composeBrief } from './brief/compose.js';

// Cron entry (hourly). Sends to every user whose local brief time is now.
export async function runWeeklyBriefs(now = new Date()) {
  const due = await getUsersDueForBrief(now);
  if (!due.length) { logger.info('weeklyBrief: no users due this hour'); return; }
  logger.info(`weeklyBrief: ${due.length} user(s) due`);
  for (const user of due) {
    try { await sendBriefTo(user, now); }
    catch (err) { logger.error(`weeklyBrief failed for user ${user.id}`, err); }
  }
}

// Compose + record + send one user's brief. The briefs row doubles as the
// idempotency lock (eligibility already skips users who have one this week).
export async function sendBriefTo(user, now = new Date()) {
  const weekOf = user._weekOf || localWeekOf(user.timezone, now);
  const brief = await briefs.createBrief({ userId: user.id, weekOf });

  const candidates = await gatherCandidates(user);
  const plan = selectBriefItems(user, candidates);

  const t0 = Date.now();
  const composed = await composeBrief(plan, user);
  await usage.logAgentRun({
    userId: user.id, runType: 'brief_generation', model: composed.model,
    promptTokens: composed.usage?.prompt_tokens, completionTokens: composed.usage?.completion_tokens,
    latencyMs: Date.now() - t0, success: true,
  });

  // Record what went into the brief (incl. the locked teaser, for analytics).
  // Clear first so an H3 retry doesn't duplicate items.
  await briefs.clearBriefItems(brief.id);
  const recordable = [...(plan.goalFollowup ? [{ type: 'goal_followup', personId: null, detail: plan.goalFollowup.goalText, priority: 50 }] : []), ...plan.items];
  for (const it of recordable) {
    await briefs.addBriefItem({
      briefId: brief.id, userId: user.id, personId: it.personId || null,
      itemType: it.type, body: it.detail, priority: it.priority || 50,
    });
  }
  if (plan.teaser) {
    await briefs.addBriefItem({
      briefId: brief.id, userId: user.id, itemType: 'pro_teaser', isProLocked: true, priority: 30,
      body: `${plan.teaser.count} outside circle slipping: ${plan.teaser.names.join(', ')}`,
    });
  }

  // ── Item 2: SEND FIRST, mark sent only after a confirmed success ──
  // The old order called markSent() BEFORE sendSms(): a crash (or a Twilio
  // failure) after markSent left the brief flagged 'sent' but never delivered,
  // and eligibility skips 'sent' briefs forever → a silently missed brief.
  // Now a failed send throws out of here; the briefs row stays 'generated' and
  // the next hourly tick retries it (clearBriefItems above prevents dup items).
  let providerId = null;
  let providerStatus = 'dry_run';
  const segments = estimateSegments(composed.text);
  if (config.briefDryRun) {
    // Never log the phone or the composed body (A8). body_len only.
    logger.event('brief.dry_run', {
      brief_id: brief.id, user_ref: 'u_' + user.id, message_type: 'weekly_brief',
      body_len: composed.text.length, segments,
    });
  } else {
    const sent = await sendSms(user.phone, composed.text); // throws on failure ⇒ stays 'generated'
    providerId = sent?.sid || null;
    providerStatus = sent?.status || 'queued';
  }

  // Send confirmed (or dry-run). NOW it's safe to mark the brief sent.
  await briefs.markSent({ briefId: brief.id, summary: composed.text });

  const msg = await messages.logOutbound({
    userId: user.id, body: composed.text, messageType: 'weekly_brief',
    providerMessageId: providerId, segments, providerStatus,
  });
  logger.event('brief.sent', {
    brief_id: brief.id, user_ref: 'u_' + user.id, provider_id: 'twilio',
    provider_message_id: providerId || undefined, message_type: 'weekly_brief',
    body_len: composed.text.length, segments, outcome: 'sent',
  });

  // ONE pending prompt for the closing question — keeps the reply matchable, and
  // when they name someone, the inbound extraction turns it into a user_goal. The
  // mid-week sweep follows up on that goal and is what fires the showing-up cascade.
  await rel.openPendingPrompt({
    userId: user.id, promptType: 'brief_goal',
    questionText: plan.closingQuestion, sentMessageId: msg.id,
  });

  await usersSvc.recordBriefSent(user.id);
  // (terminal outcome already logged above as brief.sent — one per unit of work)
}

// Side-effect-free: gather → select → compose, return the text. For tuning the
// brief on a real user WITHOUT sending, recording, or needing Twilio.
export async function previewBrief(user) {
  const candidates = await gatherCandidates(user);
  const plan = selectBriefItems(user, candidates);
  const composed = await composeBrief(plan, user);
  return { plan, text: composed.text };
}

// Concatenated-SMS segment estimate (GSM-7 vs UCS-2 multipart sizes).
function estimateSegments(text) {
  const unicode = /[^\u0000-\u007F]/.test(text);
  const per = unicode ? 67 : 153;
  return Math.max(1, Math.ceil((text || '').length / per));
}
