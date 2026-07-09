import { supabase } from '../lib/supabase.js';

export async function linkMessagePerson({ messageId, userId, personId, mentionText, contactSignal, sentiment, confidence }) {
  await supabase.from('message_people').upsert({
    message_id: messageId, user_id: userId, person_id: personId, mention_text: mentionText,
    contact_signal: contactSignal || 'none', sentiment: sentiment || null, confidence,
  }, { onConflict: 'message_id,person_id', ignoreDuplicates: true });
}

// Inserting a contact_event trips the DB trigger that freshens people.last_contact_at.
export async function logContact({ userId, personId, source = 'inferred', sourceMessageId = null, contactType = 'unknown' }) {
  await supabase.from('contact_events').insert({
    user_id: userId, person_id: personId, source, source_message_id: sourceMessageId, contact_type: contactType,
  });
}

// Open a question Cedrus expects an answer to (called when a nudge/brief asks something).
export async function openPendingPrompt({ userId, personId = null, nudgeId = null, promptType, questionText, sentMessageId = null }) {
  const { data, error } = await supabase.from('pending_prompts').insert({
    user_id: userId, person_id: personId, nudge_id: nudgeId,
    prompt_type: promptType, question_text: questionText, sent_message_id: sentMessageId,
  }).select('id').single();
  if (error) throw error;
  return data;
}

// Close a prompt and, on "yes", run the rest of the self-healing cascade.
// Returns true only if the prompt was real, ours, and still open (Fix H1b).
export async function resolvePendingPrompt({ promptId, userId, answeredMessageId, interpreted, detail }) {
  const { data: prompt } = await supabase.from('pending_prompts')
    .select('id, person_id, nudge_id, prompt_type')
    .eq('id', promptId).eq('user_id', userId).eq('status', 'open').maybeSingle();
  if (!prompt) return false;

  await supabase.from('pending_prompts').update({
    status: 'answered', answered_message_id: answeredMessageId,
    interpreted_answer: { interpreted, detail: detail || null }, answered_at: new Date().toISOString(),
  }).eq('id', promptId);

  if (interpreted === 'yes' && prompt.person_id) {
    // logs a contact event (freshens drift health) + marks the showing-up moment
    await logContact({ userId, personId: prompt.person_id, source: 'confirmed', sourceMessageId: answeredMessageId });
    if (prompt.nudge_id) {
      await supabase.from('nudges')
        .update({ showing_up: true, status: 'answered', response_message_id: answeredMessageId })
        .eq('id', prompt.nudge_id);
    }
    // a "yes" to a goal follow-up also completes the intention set in the brief
    if (prompt.prompt_type === 'goal_followup') {
      await supabase.from('user_goals')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('user_id', userId).eq('person_id', prompt.person_id).eq('status', 'open');
    }
  }
  return true;
}

// ── Nudge lifecycle (daily sweeps) ───────────────────────────────────
export async function createNudge({ userId, personId, nudgeType, reason, priority = 50, goalId = null }) {
  const { data, error } = await supabase.from('nudges').insert({
    user_id: userId, person_id: personId, nudge_type: nudgeType, reason,
    priority, status: 'queued', metadata: goalId ? { goal_id: goalId } : {},
  }).select('id').single();
  if (error) throw error;
  return data;
}

export async function markNudgeSent({ nudgeId, sentMessageId }) {
  await supabase.from('nudges')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_message_id: sentMessageId })
    .eq('id', nudgeId);
}

// Has this user been nudged since `sinceIso`? (the "at most one nudge per ~day" gate)
export async function hasRecentNudge(userId, sinceIso) {
  const { data } = await supabase.from('nudges')
    .select('id').eq('user_id', userId).not('sent_at', 'is', null)
    .gte('sent_at', sinceIso).limit(1);
  return (data || []).length > 0;
}
