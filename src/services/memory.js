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
// INVARIANT (locked by test/fact-supersession.test.js): every alias here MUST
// canonicalize to its declared target AND that target MUST be single-valued
// (below). That pairing is what makes a correction arriving under ANY alias
// supersede the prior value instead of forking a second current row. So only
// ever alias onto relationship / job / city (never a multi-valued slot like
// music). New alias keys are written in canonical underscore form; canonicalFactKey
// folds spaces/hyphens/underscore-runs so the model can slip on separators too.
export const FACT_KEY_ALIASES = {
  // → relationship (what the person IS to the user; one at a time). The
  // extraction prompt names relationship_status / relationship_type / "status"
  // as the forbidden variants — all three fold here (status was the gap).
  relationship_status: 'relationship',
  relationship_type: 'relationship',
  relationship_to_user: 'relationship',
  relationship_to_me: 'relationship',
  status: 'relationship',
  // → city (where they are now). location/home already folded; add the other
  // plain "where they live" phrasings the model reaches for.
  location: 'city',
  home: 'city',
  lives_in: 'city',
  residence: 'city',
  // → job (their work — both the employer facet and the field facet already
  // collapse here via employer + career, so these synonyms are consistent).
  work: 'job',
  employer: 'job',
  career: 'job',
  occupation: 'job',
  profession: 'job',
  workplace: 'job',
  company: 'job',
};

// Canonical slots that hold exactly ONE current value per person: a new value
// always retires the prior row (latest stated value supersedes), even when the
// model forgets to flag supersedes_prior.
export const SINGLE_VALUED_KEYS = new Set(['relationship', 'job', 'city', 'mood']);

// Fold a raw fact_key to its canonical slot. Normalizes case, surrounding
// whitespace, and ANY run of separators (spaces, hyphens, underscores) to a
// single underscore, so "Relationship Status", "relationship-status" and
// "relationship_status" all reach the same alias entry before the lookup. A key
// that normalizes to empty is treated as no key.
export function canonicalFactKey(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase().replace(/[\s_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!k) return null;
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

// ── Model-fed timestamps: the ONE normalizer for every timestamptz the model can
// fill (saved_items.event_date, reminders.trigger_at, user_goals.due_at). The
// extractor is told to emit fully-localized ISO-8601, but it sometimes emits natural
// language ("this morning", "tonight"); inserted raw, that explodes a timestamptz
// write with SQLSTATE 22007 and — before the catches were unmasked — silently
// destroyed the WHOLE item. Rule: accept ISO-8601 (date or datetime, optional
// offset) and return a UTC instant; return null for anything else. A bare calendar
// date is anchored to 12:00 UTC so its day is preserved for every US timezone (00:00Z
// would slip a western-US date back to the previous evening). The CALLER decides what
// null means: a nullable garnish (event_date / due_at) drops the date and KEEPS the
// row; a NOT-NULL column (reminders.trigger_at) treats null as "no schedulable time".
// Parse model timestamps HERE and nowhere else — do not re-parse per call site.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
export function toTimestamptz(value, _timezone) {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') { const d = new Date(value); return isNaN(d.getTime()) ? null : d.toISOString(); }
  const s = String(value).trim();
  if (!s) return null;
  let d;
  if (ISO_DATE.test(s)) d = new Date(s + 'T12:00:00Z');        // bare date → noon UTC (day stable across US tz)
  else if (ISO_DATETIME.test(s)) d = new Date(s.replace(' ', 'T'));
  else return null;                                            // natural language / garbage → drop the date
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function addSavedItem({ userId, personId, itemType, title, description, eventDate, url, origin, sourceMessageId, timezone }) {
  const { error } = await supabase.from('saved_items').insert({
    user_id: userId, person_id: personId, item_type: itemType, title,
    // event_date is a nullable garnish: an unparseable model date drops to null so the
    // memory is STILL saved — a bad date must never destroy the item (this was the 22007).
    description: description || null, event_date: toTimestamptz(eventDate, timezone), url: url || null,
    origin: origin || 'cedrus_inferred', source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

export async function addReminder({ userId, personId, title, triggerAt, reminderType, sourceMessageId, timezone }) {
  // reminders.trigger_at is NOT NULL, and a reminder with no schedulable time is
  // meaningless — so an unparseable time throws (persist skips just this reminder, with
  // a now-unmasked error) rather than inserting null or a natural-language 22007.
  const at = toTimestamptz(triggerAt, timezone);
  if (!at) throw new Error('addReminder: unparseable trigger_at ' + JSON.stringify(triggerAt));
  const { error } = await supabase.from('reminders').insert({
    user_id: userId, person_id: personId, title, trigger_at: at,
    reminder_type: reminderType || 'custom', created_by: 'cedrus', source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

export async function addGoal({ userId, personId, goalText, dueAt, sourceMessageId, timezone }) {
  // Fix H4: stamp the goal into the USER'S local week — a goal set Sunday evening
  // must belong to the week the mid-week sweep will look for it in.
  const weekOf = timezone ? localWeekOf(timezone) : mondayOf(new Date());
  const { error } = await supabase.from('user_goals').insert({
    // due_at is a nullable garnish (like event_date): unparseable → null, keep the goal.
    user_id: userId, person_id: personId, goal_text: goalText, due_at: toTimestamptz(dueAt, timezone),
    week_of: weekOf, source_message_id: sourceMessageId,
  });
  if (error) throw error;
}

// user_goals holds two populations: this pipeline's auto-captured weekly
// INTENTIONS (origin='cedrus_inferred', the default) and the standing goals a
// person writes through /api/goals (origin='user_set', services/goals.js).
// Both reads below feed the weekly brief, insights, and discovery, and
// briefEngine takes getOpenGoals()[0] for the "did you reach out?" follow-up —
// so a person-less life goal must never reach them. origin is the isolation
// key in BOTH directions (goals.js filters origin='user_set' on every one of
// its statements). Every pre-existing row carries the column DEFAULT, so this
// filter is a no-op for historical data and excludes only user-set goals.
const INFERRED_ORIGIN = 'cedrus_inferred';

// Still-open intentions from prior weeks (for a soft "did you get to it?" aside).
export async function getOpenGoals(userId) {
  const { data } = await supabase.from('user_goals')
    .select('id, goal_text, person_id, week_of, status')
    .eq('user_id', userId).eq('status', 'open').eq('origin', INFERRED_ORIGIN)
    .order('week_of', { ascending: false }).limit(5);
  return data || [];
}

// Open intentions set THIS week (for the mid-week "did you reach out?" follow-up).
export async function getOpenGoalsThisWeek(userId, weekOf) {
  const { data } = await supabase.from('user_goals')
    .select('id, goal_text, person_id, created_at')
    .eq('user_id', userId).eq('status', 'open').eq('origin', INFERRED_ORIGIN)
    .eq('week_of', weekOf)
    .order('created_at', { ascending: true });
  return data || [];
}
