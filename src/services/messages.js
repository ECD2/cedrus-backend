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

export async function logOutbound({ userId, body, messageType = 'reply', providerMessageId = null, segments = 1 }) {
  const { data, error } = await supabase.from('messages').insert({
    user_id: userId, direction: 'outbound', channel: 'sms', body, message_type: messageType,
    provider: 'twilio', provider_message_id: providerMessageId, sms_segments: segments,
    sent_at: new Date().toISOString(),
  }).select('*').single();
  if (error) throw error;
  return data;
}

// Everything the model needs to interpret an inbound message.
export async function buildContext(user) {
  const [peopleList, openPrompts, recentMessages] = await Promise.all([
    people.listForUser(user.id),
    getOpenPrompts(user.id),
    getRecentMessages(user.id, 6),
  ]);
  return { people: peopleList, openPrompts, recentMessages };
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
