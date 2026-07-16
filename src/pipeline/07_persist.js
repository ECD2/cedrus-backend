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

// Writes the model's extraction to Supabase and runs the pending-prompt cascade.
export async function persist({ user, message, parsed, resolved }) {
  const ref = (m) => resolved.personByMention[m] || null;

  // message_people links + contact events
  for (const p of parsed.people || []) {
    const personId = ref(p.mention_text);
    if (!personId) continue;
    // Fix: a caught name correction ("no, it's Mela not Marla") renames the
    // existing person instead of the model quietly promising a fix that
    // never lands in the database.
    if (p.corrected_name) {
      try { await people.rename(personId, p.corrected_name); }
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
        await people.setRelationship(personId, factValue.slice(0, 100));
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

  // reminders + goals
  for (const r of parsed.reminders || []) {
    if (!r.trigger_at || isNaN(new Date(r.trigger_at).getTime())) {
      logger.warn('persist: skipped reminder with bad trigger_at', r.trigger_at);
      continue;
    }
    try {
      await memory.addReminder({
        userId: user.id, personId: ref(r.person_ref), title: r.title || 'Reminder',
        triggerAt: r.trigger_at,
        reminderType: pick(r.reminder_type, REMINDER_TYPES, 'custom'),
        sourceMessageId: message.id,
      });
    } catch (err) { logger.warn('persist: skipped bad reminder', r.title, String(err)); }
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
