import * as usage from '../services/usage.js';

// Reads the v_message_quota view (rolling 24h inbound count vs the user's plan limit).
export async function checkRateLimit(userId) {
  const q = await usage.getMessageQuota(userId);
  if (!q) return { allowed: true, quota: null };
  return { allowed: q.inbound_last_24h < q.daily_limit, quota: q };
}
