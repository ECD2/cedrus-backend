import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { readDailyUsage, evaluateBudget, writeKillSwitch } from '../services/budget.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hourly budget guard (night build 2026-07-28, item 1; doctrine flag 17).
//
// Reads today's global spend from the two cost views, compares against the env
// budgets DAILY_TOKEN_BUDGET / DAILY_SMS_BUDGET, and upserts the kill-switch
// row that the inbound pipeline (STAGE B3.5) and the scheduler's outbound gate
// read. Over budget → active:true (inbound gets one polite template, outbound
// jobs skip). Back under (in practice: the UTC day rolls over) → active:false
// on the next hourly check, so recovery is automatic.
//
// Lesson 7: the guard announces WHICH MODE IT RAN IN every single run —
// armed/DISARMED, the numbers it saw, and 'unreadable' for a dimension it
// could not check. Silence never means "checked and fine" here.
//
// Worst-case detection lag is one hour. Inside that hour the per-user caps
// (v_message_quota, STAGE B3) still bound model spend; the account-level
// OpenAI/Twilio caps are the outer backstop (set by hand — see SESSION_NOTES).
// ─────────────────────────────────────────────────────────────────────────────

export async function runBudgetGuard(now = new Date()) {
  const tokenBudget = config.dailyTokenBudget;
  const smsBudget = config.dailySmsBudget;
  const armed = tokenBudget != null || smsBudget != null;

  const usage = await readDailyUsage(now);
  const verdict = armed
    ? evaluateBudget(usage, { tokenBudget, smsBudget })
    : { active: false, reason: null, over: [] };

  const payload = {
    active: verdict.active,
    reason: verdict.reason,
    over: verdict.over,
    mode: armed ? 'armed' : 'disarmed',
    tokens_used: usage.tokens,          // null = unreadable this check (failed open)
    token_budget: tokenBudget,
    sms_segments_used: usage.smsSegments,
    sms_budget: smsBudget,
    checked_at: now.toISOString(),
  };
  const persisted = await writeKillSwitch(payload, now);

  logger.event('budget.check', {
    outcome: verdict.active ? 'paused' : 'ok',
    reason: verdict.reason || (armed ? 'under_budget' : 'disarmed'),
    message:
      `mode=${armed ? 'armed' : 'DISARMED (set DAILY_TOKEN_BUDGET / DAILY_SMS_BUDGET)'} ` +
      `tokens=${usage.tokens ?? 'unreadable'}/${tokenBudget ?? 'unset'} ` +
      `sms_segments=${usage.smsSegments ?? 'unreadable'}/${smsBudget ?? 'unset'} ` +
      `persisted=${persisted}`,
  });

  return { ...verdict, armed, persisted };
}
