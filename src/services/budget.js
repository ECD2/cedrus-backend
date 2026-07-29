import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Budget guard primitives (night build 2026-07-28, item 1).
//
// The FIRST consumers of v_daily_token_usage / v_daily_sms_usage (doctrine
// flag 17: the cost views existed with zero readers). Both views are per-user /
// per-day rows with `day = date_trunc('day', …)` in UTC, and supabase-js
// returns their bigint sums as STRINGS — hence the Number() coercions below.
// Units (also documented on the env vars in config.js):
//   tokens       = sum(total_tokens)  across all users, current UTC day
//   sms segments = sum(sms_segments)  across all users, BOTH directions,
//                  current UTC day — segments are what Twilio bills for.
//
// Verdict storage is one system_flags row (key below). The hourly job
// (jobs/budgetGuard.js) recomputes and upserts it; the inbound pipeline and the
// scheduler's outbound gate only READ it — cheap, and the day rollover clears
// an over-budget state automatically on the next hourly check.
//
// Failure policy: every read here fails OPEN and says so (quota.read.failed,
// same event the per-user quota reads emit — one alertable name for "a spend
// guard could not check"). Failing closed on a DB blip would silence the whole
// product; the account-level OpenAI/Twilio caps are the backstop of last
// resort (doctrine flag 18).
// ─────────────────────────────────────────────────────────────────────────────

export const KILL_SWITCH_KEY = 'budget_kill_switch';

function reportQuotaRead(source, error) {
  logger.event('quota.read.failed', {
    level: 'error',
    error_category: 'db_error',
    error_code: (error && error.code) || 'unknown',
    outcome: 'fail_open',
    message: `${source} unreadable — the budget guard cannot see spend for this check: ` +
      (error ? (error.message || String(error)) : 'query returned no usable result'),
  });
}

// UTC start-of-day for the view's `day` column (date_trunc('day', …) in UTC).
export function utcDayStart(now = new Date()) {
  return now.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

// Read today's global usage from both views. A dimension that cannot be read
// comes back null (= unknowable, fail open), with quota.read.failed emitted.
export async function readDailyUsage(now = new Date()) {
  const dayStart = utcDayStart(now);
  let tokens = null;
  let smsSegments = null;

  try {
    const { data, error } = await supabase
      .from('v_daily_token_usage').select('total_tokens').gte('day', dayStart);
    if (error) reportQuotaRead('v_daily_token_usage', error);
    else tokens = (data || []).reduce((s, r) => s + (Number(r.total_tokens) || 0), 0);
  } catch (err) {
    reportQuotaRead('v_daily_token_usage', err);
  }

  try {
    const { data, error } = await supabase
      .from('v_daily_sms_usage').select('sms_segments').gte('day', dayStart);
    if (error) reportQuotaRead('v_daily_sms_usage', error);
    else smsSegments = (data || []).reduce((s, r) => s + (Number(r.sms_segments) || 0), 0);
  } catch (err) {
    reportQuotaRead('v_daily_sms_usage', err);
  }

  return { tokens, smsSegments };
}

// Pure verdict. A dimension is ARMED only when its budget is a positive finite
// number (config leaves it null otherwise). Usage `null` means "couldn't read"
// → that dimension fails OPEN. The trip is >= : at the budget line the
// allowance is spent, and stopping there beats stopping one message past it.
export function evaluateBudget({ tokens, smsSegments }, { tokenBudget, smsBudget }) {
  const over = [];
  if (tokenBudget != null && tokens != null && tokens >= tokenBudget) over.push('tokens');
  if (smsBudget != null && smsSegments != null && smsSegments >= smsBudget) over.push('sms');
  return { active: over.length > 0, reason: over[0] || null, over };
}

// Upsert the switch row. A failed write is announced (the guard can then not
// enforce anything new — readers keep acting on the previous row, which is the
// same fail-open posture as everywhere else here).
export async function writeKillSwitch(payload, now = new Date()) {
  try {
    const { error } = await supabase.from('system_flags').upsert(
      { key: KILL_SWITCH_KEY, value: payload, updated_at: now.toISOString() },
      { onConflict: 'key' },
    );
    if (error) {
      logger.event('budget.write.failed', {
        level: 'error', error_category: 'db_error', error_code: error.code || 'unknown',
        message: 'kill-switch row upsert failed — verdict not persisted: ' + (error.message || String(error)),
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.event('budget.write.failed', {
      level: 'error', error_category: 'db_error', error_code: (err && err.code) || 'unknown',
      message: 'kill-switch row upsert threw — verdict not persisted: ' + ((err && err.message) || String(err)),
    });
    return false;
  }
}

// The read side, used by the inbound pipeline (STAGE B3.5) and the scheduler's
// outbound-job gate. Missing table, missing row, error, throw → NOT paused
// (fail open); error/throw additionally announce themselves. "No row yet" is
// the legitimate state before the first hourly check ever ran, so it is silent.
export async function getBudgetGate() {
  try {
    const { data, error } = await supabase
      .from('system_flags').select('value').eq('key', KILL_SWITCH_KEY).maybeSingle();
    if (error) {
      reportQuotaRead('system_flags.' + KILL_SWITCH_KEY, error);
      return { paused: false, reason: null, degraded: true };
    }
    if (!data || !data.value) return { paused: false, reason: null, degraded: false };
    return { paused: data.value.active === true, reason: data.value.reason || null, degraded: false };
  } catch (err) {
    reportQuotaRead('system_flags.' + KILL_SWITCH_KEY, err);
    return { paused: false, reason: null, degraded: true };
  }
}

// One-line gate for the scheduler: outbound jobs skip while the switch is
// active, and the skip is a structured event per job per tick — never silent.
export async function shouldRunOutboundJob(jobName) {
  const gate = await getBudgetGate();
  if (gate.paused) {
    logger.event('budget.job.skipped', {
      job_id: jobName, reason: gate.reason || 'over_budget', outcome: 'skipped',
      message: `outbound job skipped: daily ${gate.reason || 'spend'} budget exhausted (kill switch active)`,
    });
    return false;
  }
  return true;
}
