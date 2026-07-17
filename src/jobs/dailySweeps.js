import { sendSms } from '../lib/twilio.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as messages from '../services/messages.js';
import * as people from '../services/people.js';
import * as rel from '../services/relationships.js';
import * as usage from '../services/usage.js';
import { getNudgeableUsers } from './sweeps/eligibility.js';
import { gatherNudgeCandidates } from './sweeps/candidates.js';
import { selectNudge } from './sweeps/select.js';
import { composeNudge } from './sweeps/compose.js';

// Cron entry (every 15 min). Sends at most one well-timed nudge per eligible user.
export async function runDailySweeps(now = new Date()) {
  const users = await getNudgeableUsers(now);
  if (!users.length) { logger.info('dailySweeps: no nudgeable users this tick'); return; }
  logger.info(`dailySweeps: ${users.length} candidate user(s)`);
  for (const user of users) {
    try { await nudgeUser(user, now); }
    catch (err) { logger.error(`dailySweeps failed for user ${user.id}`, err); }
  }
}

async function nudgeUser(user, now) {
  const cand = await gatherNudgeCandidates(user, now);
  const nudge = selectNudge(user, cand, now);
  if (!nudge) return; // nothing earned a nudge — silence is the right call

  // Create the nudge row first (this is what the weekly budget counts).
  const nudgeRow = await rel.createNudge({
    userId: user.id, personId: nudge.personId, nudgeType: nudge.type,
    reason: nudge.detail, priority: nudge.priority, goalId: nudge.goalId || null,
  });

  const t0 = Date.now();
  const composed = await composeNudge(nudge, user);
  await usage.logAgentRun({
    userId: user.id, runType: 'nudge_generation', model: composed.model,
    promptTokens: composed.usage?.prompt_tokens, completionTokens: composed.usage?.completion_tokens,
    latencyMs: Date.now() - t0, success: true,
  });

  let providerId = null;
  const segments = estimateSegments(composed.text);
  if (config.briefDryRun) {
    // Never log the phone or the composed body (A8). body_len only.
    logger.event('nudge.dry_run', {
      user_ref: 'u_' + user.id, message_type: 'nudge',
      body_len: composed.text.length, segments,
    });
  } else {
    const sent = await sendSms(user.phone, composed.text);
    providerId = sent?.sid || null;
  }

  const msg = await messages.logOutbound({
    userId: user.id, body: composed.text, messageType: 'nudge',
    providerMessageId: providerId, segments,
  });
  await rel.markNudgeSent({ nudgeId: nudgeRow.id, sentMessageId: msg.id });
  await people.markNudged(user.id, nudge.personId); // ownership-scoped (item 3)

  // Goal follow-ups ask a tracked question → open a pending prompt so the eventual
  // "yes" matches, fires the showing-up cascade, and completes the goal.
  if (nudge.isQuestion) {
    await rel.openPendingPrompt({
      userId: user.id, personId: nudge.personId, nudgeId: nudgeRow.id,
      promptType: 'goal_followup',
      questionText: `Did you get a chance to reach out to ${nudge.personName}?`,
      sentMessageId: msg.id,
    });
  }

  logger.info(`dailySweeps: nudged ${user.id} (${nudge.type}, tier ${nudge.planTier})`);
}

function estimateSegments(text) {
  const unicode = /[^\u0000-\u007F]/.test(text);
  const per = unicode ? 67 : 153;
  return Math.max(1, Math.ceil((text || '').length / per));
}
