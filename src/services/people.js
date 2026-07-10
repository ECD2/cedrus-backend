import { supabase } from '../lib/supabase.js';

export async function listForUser(userId) {
  const { data } = await supabase.from('people')
    .select('id, name, aliases, relationship, is_self')
    .eq('user_id', userId).eq('is_archived', false);
  return data || [];
}

export async function create(userId, { name, relationship = null, aliases = [] }) {
  const { data, error } = await supabase.from('people')
    .insert({ user_id: userId, name, relationship, aliases }).select('*').single();
  if (error) throw error;
  return data;
}

// Rename an existing person (e.g. the user corrected a misheard/misspelled name).
export async function rename(personId, name) {
  if (!personId || !name) return;
  await supabase.from('people').update({ name }).eq('id', personId);
}

// Rename the user's own is_self person (set during onboarding — Fix C3).
export async function renameSelf(userId, name) {
  await supabase.from('people').update({ name }).eq('user_id', userId).eq('is_self', true);
}

// Fuzzy backstop. MVP: exact/contains match. Upgrade to a pg_trgm rpc for typo tolerance.
// Fix M1: substring matching only for names of 3+ chars, so "Jo" can't silently
// merge into "Joan" — wrong-person merges are the worst failure for a memory product.
export async function fuzzyFind(userId, name) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  const { data } = await supabase.from('people')
    .select('id, name, aliases').eq('user_id', userId).eq('is_archived', false);
  let best = null;
  for (const p of data || []) {
    const names = [p.name, ...(p.aliases || [])].map(s => (s || '').toLowerCase());
    if (names.includes(target)) return { id: p.id, score: 1 };
    if (target.length >= 3 &&
        names.some(s => s && s.length >= 3 && (s.includes(target) || target.includes(s)))) {
      best = best || { id: p.id, score: 0.7 };
    }
  }
  return best;
}

// The agent's main read view: people with current facts + active saved items pre-bundled.
export async function getAgentContext(userId, { proactiveOnly = false } = {}) {
  let q = supabase.from('v_agent_person_context').select('*').eq('user_id', userId);
  if (proactiveOnly) q = q.eq('proactive_enabled', true);
  const { data } = await q;
  return data || [];
}

// People with a known birthday (+ core-five flag for free-tier gating).
export async function getBirthdaysForUser(userId) {
  const { data } = await supabase.from('people')
    .select('id, name, birthday_month, birthday_day, is_core_five')
    .eq('user_id', userId).eq('is_archived', false)
    .not('birthday_month', 'is', null);
  return data || [];
}

export async function markNudged(personId) {
  if (!personId) return;
  await supabase.from('people').update({ last_nudged_at: new Date().toISOString() }).eq('id', personId);
}

// Per-person nudge cooldown data (avoid nudging about the same person too often).
export async function getNudgeCooldowns(userId) {
  const { data } = await supabase.from('people')
    .select('id, last_nudged_at').eq('user_id', userId).eq('is_archived', false);
  return data || [];
}
