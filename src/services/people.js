import { supabase } from '../lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────
// OWNERSHIP GUARD (WS-A item 3 — the cross-tenant-write backstop)
//
// The backend uses the Supabase SERVICE-ROLE client, which BYPASSES RLS
// (lib/supabase.js). That means the database provides NO tenant isolation for
// these queries — every `.eq('user_id', …)` predicate is the ONLY thing
// stopping one user's write from landing on another user's row. Historically
// three writers here (rename / setRelationship / markNudged) mutated by
// `person_id` ALONE, so a model-supplied or hallucinated foreign person_id
// (see 06_resolveEntities.js, WS-B's file) could write across tenants.
//
// New rule for this service: EVERY read and write is scoped by `user_id`, and
// every write REQUIRES the owning userId. A write whose (user_id, person_id)
// pair doesn't exist affects zero rows — a foreign person_id is silently
// rejected instead of clobbering another tenant. `requireUser()` fails closed
// if a caller forgets to pass ownership context.
//
// NOTE (flagged to WS-B, docs/WSA_FLAGS_FOR_WSB.md): rename() and
// setRelationship() are also called from src/pipeline/07_persist.js, which WS-A
// must not edit. Those two calls must be updated to pass `user.id`
// (persist already has it in scope). Until then those specific writes fail
// closed (a caught no-op) rather than performing an unscoped write.
// ─────────────────────────────────────────────────────────────────────────

function requireUser(userId, fn) {
  if (!userId || typeof userId !== 'string') {
    throw new Error(`people.${fn}: userId is required (ownership guard) — refusing an unscoped write`);
  }
}

export async function listForUser(userId) {
  const { data } = await supabase.from('people')
    .select('id, name, aliases, relationship, is_self, last_contact_at')
    .eq('user_id', userId).eq('is_archived', false);
  return data || [];
}

// Add a spelling as an alias so a future identical mention resolves by exact-alias
// match and never re-triggers a dedup question (docs §2.5 — the "same" not-duplicate
// path). Scoped by user_id (ownership guard); a foreign person_id is a no-op. Idempotent.
export async function addAlias(userId, personId, alias) {
  requireUser(userId, 'addAlias');
  const a = String(alias || '').trim();
  if (!personId || !a) return;
  const { data } = await supabase.from('people')
    .select('aliases').eq('id', personId).eq('user_id', userId).maybeSingle();
  if (!data) return; // person isn't this user's — refuse silently
  const current = Array.isArray(data.aliases) ? data.aliases : [];
  if (current.some((s) => String(s).toLowerCase() === a.toLowerCase())) return; // already present
  if (a.toLowerCase() === '') return;
  await supabase.from('people').update({ aliases: [...current, a] })
    .eq('id', personId).eq('user_id', userId);
}

export async function create(userId, { name, relationship = null, aliases = [] }) {
  requireUser(userId, 'create');
  const { data, error } = await supabase.from('people')
    .insert({ user_id: userId, name, relationship, aliases }).select('*').single();
  if (error) throw error;
  return data;
}

// Rename an existing person (e.g. the user corrected a misheard/misspelled name).
// Scoped by user_id: a person_id that isn't this user's is a no-op, not a
// cross-tenant write.
export async function rename(userId, personId, name) {
  requireUser(userId, 'rename');
  if (!personId || !name) return;
  await supabase.from('people').update({ name })
    .eq('id', personId).eq('user_id', userId);
}

// Rename the user's own is_self person (set during onboarding — Fix C3).
export async function renameSelf(userId, name) {
  requireUser(userId, 'renameSelf');
  await supabase.from('people').update({ name })
    .eq('user_id', userId).eq('is_self', true);
}

// Keep the person's canonical relationship-to-user in step with the newest
// relationship fact (corrections like girlfriend -> ex-girlfriend land here).
export async function setRelationship(userId, personId, relationship) {
  requireUser(userId, 'setRelationship');
  if (!personId || !relationship) return;
  await supabase.from('people').update({ relationship })
    .eq('id', personId).eq('user_id', userId);
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

// Set a person's structured birthday (month/day) — the field getBirthdaysForUser
// and the insight/discovery engines actually read. Scoped by user_id (ownership
// guard), so a foreign person_id is a no-op, never a cross-tenant write. Mirrors
// setRelationship. Year is intentionally NOT written: there is no people.birthday_year
// column (docs/ENTITY_RESOLUTION_V2.md §4) and the engines use month/day only.
export async function setBirthday(userId, personId, { month, day } = {}) {
  requireUser(userId, 'setBirthday');
  if (!personId || month == null || day == null) return;
  await supabase.from('people').update({ birthday_month: month, birthday_day: day })
    .eq('id', personId).eq('user_id', userId);
}

// Scoped by user_id: markNudged never touches a person that isn't this user's.
export async function markNudged(userId, personId) {
  requireUser(userId, 'markNudged');
  if (!personId) return;
  await supabase.from('people').update({ last_nudged_at: new Date().toISOString() })
    .eq('id', personId).eq('user_id', userId);
}

// Per-person nudge cooldown data (avoid nudging about the same person too often).
export async function getNudgeCooldowns(userId) {
  const { data } = await supabase.from('people')
    .select('id, last_nudged_at').eq('user_id', userId).eq('is_archived', false);
  return data || [];
}
