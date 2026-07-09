import { supabase } from '../lib/supabase.js';

export async function getMessageQuota(userId) {
  const { data } = await supabase.from('v_message_quota').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

export async function getNudgeUsage(userId) {
  const { data } = await supabase.from('v_weekly_nudge_usage').select('*').eq('user_id', userId).maybeSingle();
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
