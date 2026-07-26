import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quota reads. Both of these feed guards that FAIL OPEN on a nullish result:
// `checkRateLimit` returns { allowed: true } when the quota row is missing, and
// sweeps/eligibility.js skips its budget check entirely (`if (budget && ...)`).
//
// Failing open is the right call and is NOT being changed here — on the inbound
// path `checkRateLimit` sits at STAGE B3, *before* `understand()` runs the
// Priority 0 crisis gate, so a false "over quota" would answer a crisis message
// with the rate-limit template. Cost is worth less than that.
//
// What was wrong was that failing open was SILENT: the error was discarded
// without even being bound, so an unreadable quota view and a user comfortably
// under their cap produced the same `{ allowed: true }` and the same empty log.
// `checkRateLimit` is the ONLY per-user spend ceiling in the application and
// nothing reads v_daily_token_usage / v_daily_sms_usage, so there is no second
// place the loss would have shown up.
//
// Both abnormal outcomes now emit one structured, alertable event. The healthy
// path stays silent. Return contracts are unchanged, so no caller moves.
// ─────────────────────────────────────────────────────────────────────────────

// These views are defined as `... FROM app_users u`, so a row exists for every
// real user: "no row" means the id isn't a user, which is abnormal in itself.
function reportQuotaRead(view, userId, error) {
  logger.event('quota.read.failed', {
    level: 'error',
    error_category: 'db_error',
    error_code: (error && error.code) || 'no_row',
    user_ref: 'u_' + userId,
    outcome: 'fail_open',
    message: `${view} unreadable — the cap it backs is NOT being enforced for this call: ` +
      (error ? (error.message || String(error)) : 'query succeeded but returned no row'),
  });
}

export async function getMessageQuota(userId) {
  const { data, error } = await supabase.from('v_message_quota').select('*').eq('user_id', userId).maybeSingle();
  if (error || !data) { reportQuotaRead('v_message_quota', userId, error); return null; }
  return data;
}

export async function getNudgeUsage(userId) {
  const { data, error } = await supabase.from('v_weekly_nudge_usage').select('*').eq('user_id', userId).maybeSingle();
  if (error || !data) { reportQuotaRead('v_weekly_nudge_usage', userId, error); return null; }
  return data;
}

export async function logAgentRun({
  userId, runType, triggerMessageId = null, responseMessageId = null, model,
  promptTokens = 0, completionTokens = 0, latencyMs = null, success = true, errorMessage = null,
}) {
  await supabase.from('agent_runs').insert({
    user_id: userId, run_type: runType, trigger_message_id: triggerMessageId,
    response_message_id: responseMessageId, model, prompt_tokens: promptTokens || 0,
    completion_tokens: completionTokens || 0, latency_ms: latencyMs, success, error_message: errorMessage,
  });
}
