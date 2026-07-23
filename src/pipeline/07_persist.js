import * as memory from '../services/memory.js';
import * as rel from '../services/relationships.js';
import * as users from '../services/users.js';
import * as people from '../services/people.js';
import { logger } from '../utils/logger.js';

// ── Fix H1: the model PROPOSES, this file DISPOSES. Every enum-bound value is
// validated/coerced before it touches Postgres, and every item writes inside its
// own try/catch so one bad value can never poison the rest of the message.
const FACT_TYPES = ['preference', 'interest', 'life_event', 'goal', 'mood', 'relationship_detail', 'context', 'note'];
const ITEM_TYPES = ['product', 'event', 'gift_idea', 'link', 'note'];
const ORIGINS = ['stated_by_person', 'user_added', 'cedrus_inferred', 'cedrus_suggested'];
const SIGNALS = ['none', 'implied_contact', 'explicit_contact', 'wants_contact', 'confirmed_contact'];
const REMINDER_TYPES = ['birthday', 'checkin', 'event', 'custom'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const clamp01 = (n) => (typeof n === 'number' && isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8);

const CONTACT_SIGNALS = ['explicit_contact', 'confirmed_contact', 'implied_contact'];

// ── Priority 2a: a fact whose value merely restates its key carries zero
// information ("jewelry" / "likes jewelry"). The prompt is told not to emit
// these, but code disposes: we drop them before they reach Postgres so a model
// slip can't write a tautological row. Mirrors test/extraction-prompt-cases.mjs.
export function isTautologicalFact(factKey, factValue) {
  const key = String(factKey || '').toLowerCase().replace(/_/g, ' ').trim();
  const val = String(factValue || '').toLowerCase().trim();
  if (!key || !val) return false;
  if (val === key) return true;
  return [
    `likes ${key}`, `loves ${key}`, `enjoys ${key}`, `is into ${key}`,
    `into ${key}`, `a fan of ${key}`, `likes`, `loves`, `enjoys`,
  ].includes(val);
}

// ── Birthday routing (docs/ENTITY_RESOLUTION_V2.md §4). A stated birthday must
// populate the STRUCTURED people.birthday_month/day the insight/discovery engines
// read — not only a reminders row (the observed bug: "Quin's birthday is Nov 12"
// created a reminder but left the person columns null). Pure + unit-tested.
export function validBirthday(month, day) {
  return Number.isInteger(month) && month >= 1 && month <= 12
      && Number.isInteger(day) && day >= 1 && day <= 31;
}
// A birthday reminder's trigger_at is a full ISO-8601 timestamp already localized to
// the user (offset included), so the calendar date in the string IS the birthday.
// Read month/day off the YYYY-MM-DD prefix — no timezone math, no Date parsing.
export function monthDayFromIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const month = parseInt(m[2], 10), day = parseInt(m[3], 10);
  return validBirthday(month, day) ? { month, day } : null;
}

// Writes the model's extraction to Supabase and runs the pending-prompt cascade.
export async function persist({ user, message, parsed, resolved }) {
  // Priority 0: a crisis/boundary turn writes NO product content (safety spec §7).
  // The fixed safety reply has already been chosen; nothing here should run.
  if (parsed._suppressPersistence) return;

  const ref = (m) => resolved.personByMention[m] || null;

  // message_people links + contact events
  for (const p of parsed.people || []) {
    const personId = ref(p.mention_text);
    if (!personId) continue;
    // Fix: a caught name correction ("no, it's Mela not Marla") renames the
    // existing person instead of the model quietly promising a fix that
    // never lands in the database.
    if (p.corrected_name) {
      try { await people.rename(user.id, personId, p.corrected_name); }
      catch (err) { logger.warn('persist: rename failed', p.corrected_name, String(err)); }
    }
    const signal = pick(p.contact_signal, SIGNALS, 'none');
    try {
      await rel.linkMessagePerson({
        messageId: message.id, userId: user.id, personId, mentionText: p.mention_text,
        contactSignal: signal,
        sentiment: pick(p.sentiment, SENTIMENTS, null),
        confidence: clamp01(p.confidence),
      });
      if (CONTACT_SIGNALS.includes(signal)) {
        await rel.logContact({ userId: user.id, personId, source: 'inferred', sourceMessageId: message.id });
      }
    } catch (err) { logger.warn('persist: skipped bad person link', p.mention_text, String(err)); }
  }

  // facts (supersession + key normalization applied inside addFact)
  for (const f of parsed.facts || []) {
    const personId = ref(f.person_ref);
    if (!personId || !f.fact_value) continue;
    // Priority 2a: drop tautological key/value collisions before they persist.
    if (isTautologicalFact(f.fact_key, f.fact_value)) {
      logger.warn('persist: dropped tautological fact', f.fact_key, f.fact_value);
      continue;
    }
    const factValue = String(f.fact_value).slice(0, 500);
    try {
      await memory.addFact({
        userId: user.id, personId,
        factType: pick(f.fact_type, FACT_TYPES, 'note'),
        factKey: f.fact_key || null,
        factValue,
        supersedesPrior: f.supersedes_prior === true,
        sourceMessageId: message.id, confidence: clamp01(f.confidence),
      });
      // A relationship fact is also the person's canonical relationship: keep the
      // people.relationship column (KNOWN PEOPLE context + dashboard label) in
      // sync, so a correction ("she's my ex now") actually changes what Cedrus
      // believes, instead of stacking a fact beside a stale column.
      if (memory.canonicalFactKey(f.fact_key) === 'relationship') {
        await people.setRelationship(user.id, personId, factValue.slice(0, 100));
      }
    } catch (err) { logger.warn('persist: skipped bad fact', f.fact_value, String(err)); }
  }

  // saved items
  for (const s of parsed.saved_items || []) {
    const personId = ref(s.person_ref);
    if (!personId || !s.title) continue;
    try {
      await memory.addSavedItem({
        userId: user.id, personId,
        itemType: pick(s.item_type, ITEM_TYPES, 'note'),
        title: String(s.title).slice(0, 200),
        description: s.description, eventDate: s.event_date, url: s.url,
        origin: pick(s.origin, ORIGINS, 'cedrus_inferred'),
        sourceMessageId: message.id,
      });
    } catch (err) { logger.warn('persist: skipped bad saved item', s.title, String(err)); }
  }

  // birthdays -> structured people.birthday_month/day (the field the engines read).
  // A birthday can arrive as a structured birthdays[] item (preferred) OR only as a
  // birthday reminder (what the model did in production); we populate the person
  // columns from EITHER, so the fix is robust to model variance. Ownership-scoped.
  const birthdayHandled = new Set();
  for (const b of parsed.birthdays || []) {
    const personId = ref(b.person_ref);
    const month = Number(b.month), day = Number(b.day);
    if (!personId) continue;
    if (!validBirthday(month, day)) { logger.warn('persist: skipped invalid birthday', b.month, b.day); continue; }
    try { await people.setBirthday(user.id, personId, { month, day }); birthdayHandled.add(personId); }
    catch (err) { logger.warn('persist: skipped bad birthday', String(err)); }
  }

  // reminders + goals
  for (const r of parsed.reminders || []) {
    if (!r.trigger_at || isNaN(new Date(r.trigger_at).getTime())) {
      logger.warn('persist: skipped reminder with bad trigger_at', r.trigger_at);
      continue;
    }
    const personId = ref(r.person_ref);
    const reminderType = pick(r.reminder_type, REMINDER_TYPES, 'custom');
    try {
      await memory.addReminder({
        userId: user.id, personId, title: r.title || 'Reminder',
        triggerAt: r.trigger_at, reminderType, sourceMessageId: message.id,
      });
    } catch (err) { logger.warn('persist: skipped bad reminder', r.title, String(err)); }
    // Keep the reminder (above) AND backfill the structured birthday from it, so a
    // model that files a birthday ONLY as a reminder still populates people.birthday.
    if (reminderType === 'birthday' && personId && !birthdayHandled.has(personId)) {
      const md = monthDayFromIsoDate(r.trigger_at);
      if (md) {
        try { await people.setBirthday(user.id, personId, md); birthdayHandled.add(personId); }
        catch (err) { logger.warn('persist: birthday backfill failed', String(err)); }
      }
    }
  }
  for (const g of parsed.goals || []) {
    if (!g.goal_text) continue;
    try {
      await memory.addGoal({
        userId: user.id, personId: ref(g.person_ref), goalText: g.goal_text,
        dueAt: g.due_at, sourceMessageId: message.id,
        timezone: user.timezone, // Fix H4: goals stamped in the USER'S week, not UTC's
      });
    } catch (err) { logger.warn('persist: skipped bad goal', g.goal_text, String(err)); }
  }

  // pending-prompt cascade (the self-healing loop)
  // Fix H1(b): only count a showing-up moment if the prompt actually existed and
  // was open — the model can no longer inflate the counter with invented ids.
  const pa = parsed.prompt_answer;
  if (pa && pa.answers_prompt_id) {
    try {
      const found = await rel.resolvePendingPrompt({
        promptId: pa.answers_prompt_id, userId: user.id, answeredMessageId: message.id,
        interpreted: pa.interpreted, detail: pa.detail,
      });
      if (found && pa.interpreted === 'yes') await users.incrementShowingUp(user.id);
    } catch (err) { logger.warn('persist: prompt cascade failed', String(err)); }
  }
}
