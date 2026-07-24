import { supabase } from '../lib/supabase.js';
import * as people from './people.js';

// True if this user has never had a single message logged - true for a real
// brand-new account, and also true right after an admin reset (which wipes
// messages but deliberately keeps the account row itself).
export async function hasNoHistory(userId) {
  const { count } = await supabase.from('messages')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return !count;
}

export async function logInbound({ userId, body, messageSid, numSegments }) {
  // Idempotency: a retried Twilio webhook carries the same MessageSid.
  if (messageSid) {
    const { data: dup } = await supabase.from('messages')
      .select('id').eq('provider', 'twilio').eq('provider_message_id', messageSid).maybeSingle();
    if (dup) return { message: dup, duplicate: true };
  }
  const { data, error } = await supabase.from('messages').insert({
    user_id: userId, direction: 'inbound', channel: 'sms', body,
    provider: 'twilio', provider_message_id: messageSid || null,
    sms_segments: numSegments || 1, received_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;
  return { message: data, duplicate: false };
}

export async function logOutbound({ userId, body, messageType = 'reply', providerMessageId = null, segments = 1, providerStatus = null }) {
  const { data, error } = await supabase.from('messages').insert({
    user_id: userId, direction: 'outbound', channel: 'sms', body, message_type: messageType,
    provider: 'twilio', provider_message_id: providerMessageId, provider_status: providerStatus,
    sms_segments: segments, sent_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;
  return data;
}

// Record a Twilio delivery-status callback (item 8) against the outbound row
// with this provider SID. Scoped to outbound so an inbound SID can never be
// mutated. Returns the updated row (or null if we have no record of that SID —
// e.g. a callback for a message sent before this code shipped).
export async function recordDeliveryStatus({ providerMessageId, status, errorCode = null, raw = null }) {
  if (!providerMessageId || !status) return null;
  const patch = { provider_status: status };
  if (raw) {
    patch.provider_payload = {
      last_status: status, error_code: errorCode || null,
      updated_at: new Date().toISOString(),
    };
  }
  const { data } = await supabase.from('messages')
    .update(patch)
    .eq('provider', 'twilio').eq('provider_message_id', providerMessageId).eq('direction', 'outbound')
    .select('id, user_id, message_type, provider_status');
  return (data && data[0]) || null;
}

// Everything the model needs to interpret an inbound message.
export async function buildContext(user) {
  const [peopleList, openPrompts, recentMessages] = await Promise.all([
    people.listForUser(user.id),
    getOpenPrompts(user.id),
    getRecentMessages(user.id, 6),
  ]);
  // Phase 2b (docs §3): attach a collision-aware display_name so the model's KNOWN
  // PEOPLE block distinguishes same-first-name people ("Luca C." vs "Luca M.") and
  // resolves a mention to the right id. The canonical `name` is left untouched.
  const withDisplay = (peopleList || []).map((p) => ({ ...p, display_name: people.displayName(p, peopleList) }));
  return { people: withDisplay, openPrompts, recentMessages };
}

async function getOpenPrompts(userId) {
  const { data } = await supabase.from('pending_prompts')
    .select('id, question_text, person_id')
    .eq('user_id', userId).eq('status', 'open')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return (data || []).map(p => ({ id: p.id, question: p.question_text, about_person_id: p.person_id }));
}

async function getRecentMessages(userId, n) {
  const { data } = await supabase.from('messages')
    .select('direction, body, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(n);
  return (data || []).reverse();
}
