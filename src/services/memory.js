import { supabase } from '../lib/supabase.js';
import { mondayOf, localWeekOf } from '../utils/time.js';

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL FACT-SLOT REGISTRY — the single source of truth for "which fact keys
// describe the same real-world attribute." This is the ONE place slots are
// defined; every write path reconciles through it and NOTHING keeps its own
// copy: extraction + user corrections go through addFact() below, and the
// historical chat-import path imports SINGLE_VALUED_KEYS straight from here.
// Reconciliation must never be scattered, so the extension surface is exactly
// these two tables:
//
//   • To alias a key onto an existing slot: add `<alias>: '<canonical>'` to
//     FACT_KEY_ALIASES. canonicalFactKey() then folds the alias in everywhere.
//   • To make a slot single-valued (a new value retires the old one): add the
//     canonical key to SINGLE_VALUED_KEYS.
//
// Why it exists: without it the same attribute forks into two keys — the
// "relationship" vs "relationship_status" bug that left a girlfriend and an
// ex-girlfriend both current on one person. Split rows written before this
// registry landed are collapsed by docs/REL_STATUS_RECONCILE.proposed.sql; the
// on-write guarantee is proven in test/fact-supersession.test.js.
export const FACT_KEY_ALIASES = {
  relationship_status: 'relationship',
  relationship_type: 'relationship',
  relationship_to_user: 'relationship',
  location: 'city',
  home: 'city',
  work: 'job',
  employer: 'job',
  career: 'job',
};

// Canonical slots that hold exactly ONE current value per person: a new value
// always retires the prior row (latest stated value supersedes), even when the
// model forgets to flag supersedes_prior.
export const SINGLE_VALUED_KEYS = new Set(['relationship', 'job', 'city', 'mood']);

export function canonicalFactKey(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase().replace(/\s+/g, '_');
  return FACT_KEY_ALIASES[k] || k;
}

export async function addFact({ userId, personId, factType, factKey, factValue, supersedesPrior, sourceMessageId, confidence }) {
  const key = canonicalFactKey(factKey);
  const supersedes = key && (supersedesPrior === true || SINGLE_VALUED_KEYS.has(key));
  if (supersedes) {
    // Retire the canonical key AND its aliases, so pre-normalization rows
    // (e.g. an old relationship_status fact) are superseded too.
    const keysToRetire = [key, ...Object.keys(FACT_KEY_ALIASES).filter((a) => FACT_KEY_ALIASES[a] === key)];
    await supabase.from('facts')
      .update({ is_current: false, ended_at: new Date().toISOString(), ended_reason: 'superseded' })
      .eq('person_id', personId).in('fact_key', keysToRetire).eq('is_current', true);
  }
  const { error } = await supabase.from('facts').insert({
    user_id: userId, person_id: personId, fact_type: factType, fact_key: key,
    fact_value: factValue, source_message_id: sourceMessageId, confidence,
    // The value we just wrote IS the current one. Stated explicitly so the
    // "exactly one current value per slot" invariant holds here on its own,
    // never resting on the facts.is_current column default.
    is_current: true,
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
