import { supabase } from '../lib/supabase.js';
import { mondayOf, localWeekOf } from '../utils/time.js';

export async function addFact({ userId, personId, factType, factKey, factValue, supersedesPrior, sourceMessageId, confidence }) {
  // Supersession is single-valued only; the model decides. Multi-valued tastes never reach here with true.
  if (supersedesPrior && factKey) {
    await supabase.from('facts')
      .update({ is_current: false, ended_at: new Date().toISOString(), ended_reason: 'superseded' })
      .eq('person_id', personId).eq('fact_key', factKey).eq('is_current', true);
  }
  const { error } = await supabase.from('facts').insert({
    user_id: userId, person_id: personId, fact_type: factType, fact_key: factKey,
    fact_value: factValue, source_message_id: sourceMessageId, confidence,
  });
  if (error) throw error;
}

export async function addSavedItem({ userId, personId, itemType, title, description, eventDate, url, origin, sourceMessageId }) {
  const { error } = await supabase.from('saved_items').insert({
    user_id: userId, person_id: personId, item_type: itemType, title,
    description: description || null, event_date: eventDate || null, url: url || null,
    origin: origin || 'cedrus_inferred', source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

export async function addReminder({ userId, personId, title, triggerAt, reminderType, sourceMessageId }) {
  const { error } = await supabase.from('reminders').insert({
    user_id: userId, person_id: personId, title, trigger_at: triggerAt,
    reminder_type: reminderType || 'custom', created_by: 'cedrus', source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

export async function addGoal({ userId, personId, goalText, dueAt, sourceMessageId, timezone }) {
  // Fix H4: stamp the goal into the USER'S local week — a goal set Sunday evening
  // must belong to the week the mid-week sweep will look for it in.
  const weekOf = timezone ? localWeekOf(timezone) : mondayOf(new Date());
  const { error } = await supabase.from('user_goals').insert({
    user_id: userId, person_id: personId, goal_text: goalText, due_at: dueAt || null,
    week_of: weekOf, source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

// Still-open intentions from prior weeks (for a soft "did you get to it?" aside).
export async function getOpenGoals(userId) {
  const { data } = await supabase.from('user_goals')
    .select('id, goal_text, person_id, week_of, status')
    .eq('user_id', userId).eq('status', 'open')
    .order('week_of', { ascending: false }).limit(5);
  return data || [];
}

// Open intentions set THIS week (for the mid-week "did you reach out?" follow-up).
export async function getOpenGoalsThisWeek(userId, weekOf) {
  const { data } = await supabase.from('user_goals')
    .select('id, goal_text, person_id, created_at')
    .eq('user_id', userId).eq('status', 'open').eq('week_of', weekOf)
    .order('created_at', { ascending: true });
  return data || [];
}
