import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
import * as people from './people.js';
import { applyVoiceGuard } from './voiceGuard.js';
import { interpretClarificationReply } from './entityResolution.js';

// ─────────────────────────────────────────────────────────────────────────────
// CLARIFICATIONS — the ask-first dedup loop (Phase 2a of docs/ENTITY_RESOLUTION_V2.md
// §2). Owns the pending_clarifications lifecycle, the deterministic voice-guarded
// question authoring, and the held-payload apply (replayed through persist() — the
// one write implementation). The MERGE/CREATE/ASK decision lives in entityResolution.js
// (§1); this module only HOLDS, ASKS, and APPLIES.
//
// The table is created via docs/ENTITY_RESOLUTION_CLARIFICATIONS.proposed.sql through
// Emil's Supabase ceremony BEFORE deploy; this code assumes it exists. resolveEntities
// and persist are INJECTED (deps) so the loop is testable without the whole pipeline.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = 'pending_clarifications';
export const CLARIFICATION_TTL_HOURS = 72; // docs §7 default
const REPLY_CHAR_CAP = 320;                 // matches understand()'s reply cap

function nowIso() { return new Date().toISOString(); }
function ttlIso() { return new Date(Date.now() + CLARIFICATION_TTL_HOURS * 3600 * 1000).toISOString(); }

// ── Question authoring (deterministic; EN — ES is a documented follow-up, §7).
// No em dash, no exclamation — enforced HERE (applyVoiceGuard's 'routine' band
// leaves them), then passed through applyVoiceGuard as the house backstop.
function firstNameOf(name) { const s = String(name || '').trim(); return s.split(/\s+/)[0] || s; }

function orList(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] || '';
  if (xs.length === 2) return xs[0] + ' or ' + xs[1];
  return xs.slice(0, -1).join(', ') + ', or ' + xs[xs.length - 1];
}

function relTag(c, i) {
  const r = String((c && c.relationship) || '').trim();
  if (r) return /^(my|your|the)\b/i.test(r) ? r : 'your ' + r;
  return ['the first', 'the second', 'the third'][i] || ('option ' + (i + 1));
}

// Phase 2b: render a candidate as "Luca C." when it collides on first name with
// another candidate and we have its last-initial (docs §3 displayName, list-scoped);
// otherwise just the first name.
function labelCandidate(c, all) {
  const first = firstNameOf(c.name);
  const collides = (all || []).some((o) => o !== c && firstNameOf(o.name).toLowerCase() === first.toLowerCase());
  return collides && c.last_initial ? first + ' ' + c.last_initial : first;
}

function sanitize(s) {
  let out = String(s || '')
    .replace(/[‒–—―]/g, ', ') // em/en/figure/horizontal-bar dash → comma
    .replace(/!+/g, '.')                          // no exclamation
    .replace(/\s+([,.?:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const g = applyVoiceGuard({ reply: out, band: 'routine' });
  out = (g && g.reply) || out;
  if (out.length > REPLY_CHAR_CAP) out = out.slice(0, REPLY_CHAR_CAP - 1).trimEnd() + '?';
  return out;
}

// Candidate-listing question (§2.4). bare_name → "Which Luca: your brother, or from
// work?"; near_match → "Is Luka a new person, or do you mean Luca or Lucas?"; a short
// fragment ("Luc") → "Did you mean Luca, Lucas, or Luka?".
export function authorQuestion({ askKind, newName, candidates = [] } = {}) {
  const first = firstNameOf(newName);
  let raw;
  if (askKind === 'bare_name') {
    // "Which Luca: C. or M.?" when both have a last-initial; else fall back to a
    // relationship / positional tag ("your brother, or from work?") — §2.4/§3.
    const tags = candidates.map((c, i) => c.last_initial || relTag(c, i));
    raw = 'Which ' + first + ': ' + orList(tags) + '?';
  } else {
    const names = candidates.map((c) => labelCandidate(c, candidates));
    raw = (first.length <= 3)
      ? 'Did you mean ' + orList(names) + '?'
      : 'Quick check: is ' + first + ' a new person, or do you mean ' + orList(names) + '?';
  }
  return sanitize(raw);
}

function nameForId(candidates, personId) {
  const c = (candidates || []).find((x) => x.id === personId);
  return c ? firstNameOf(c.name) : 'them';
}
function confirmSame(clarify, personId) {
  return sanitize('Got it, added that to ' + nameForId(clarify.candidates, personId) + '.');
}
function confirmDifferent(newName) {
  return sanitize('Got it, saved ' + firstNameOf(newName) + ' as someone new.');
}

// One reply, one optional question. Preserve the question whole; trim the head first
// if the 2-segment budget is tight (§2.4).
function composeReply({ base, confirmation, question }) {
  let head = String(confirmation || base || 'Got it.').trim();
  if (!question) return head.slice(0, REPLY_CHAR_CAP);
  const budget = REPLY_CHAR_CAP - question.length - 1;
  if (head.length > budget) head = budget > 1 ? head.slice(0, budget - 1).trimEnd() : '';
  return (head ? head + ' ' : '') + question;
}

// ── Held payload: the writes referencing the ambiguous mention, captured so they can
// be applied verbatim once the person is known. Plus the clarify context (askKind,
// newName, candidates) needed to author/interpret later.
export function buildHeldPayload({ parsed, mention, candidates, askKind, sourceMessageId }) {
  const mt = mention.mention_text;
  const forRef = (arr) => (arr || []).filter((x) => x && x.person_ref === mt);
  return {
    clarify: {
      askKind,
      newName: mention.proposed_name || mt,
      candidates: (candidates || []).map((c) => ({
        id: c.id, name: c.name, relationship: c.relationship || null,
        last_contact_at: c.last_contact_at || null, last_initial: c.last_initial || null,
      })),
    },
    writes: {
      source_message_id: sourceMessageId || null,
      person: {
        mention_text: mt,
        proposed_name: mention.proposed_name || mt,
        proposed_relationship: mention.proposed_relationship || null,
        contact_signal: mention.contact_signal,
        sentiment: mention.sentiment,
        confidence: mention.confidence,
        corrected_name: mention.corrected_name,
      },
      facts: forRef(parsed.facts),
      saved_items: forRef(parsed.saved_items),
      reminders: forRef(parsed.reminders),
      goals: forRef(parsed.goals),
      birthdays: forRef(parsed.birthdays),
    },
  };
}

// Replay the held writes onto `personId` via persist() (injected) — the one write
// implementation, so ownership guards + validation apply exactly once.
export async function applyHeldWrites({ user, personId, held, persist }) {
  if (!persist || !personId || !held || !held.writes) return;
  const w = held.writes;
  const mt = (w.person && w.person.mention_text) || (held.clarify && held.clarify.newName);
  const parsed = {
    people: w.person ? [w.person] : [],
    facts: w.facts || [], saved_items: w.saved_items || [],
    reminders: w.reminders || [], goals: w.goals || [], birthdays: w.birthdays || [],
    prompt_answer: null,
  };
  const resolved = { personByMention: mt ? { [mt]: personId } : {} };
  try {
    await persist({ user, message: { id: w.source_message_id || null }, parsed, resolved });
  } catch (err) { logger.warn('clarifications.applyHeldWrites failed', String(err)); }
}

// ── State machine (pending_clarifications) ─────────────────────────────────
export async function getActive(userId) {
  const { data } = await supabase.from(TABLE).select('*')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  return data || null;
}

export async function enqueue({ userId, mention, candidates, heldPayload, expiresAt }) {
  const row = {
    user_id: userId, status: 'pending', kind: 'person_dedup',
    mention_text: mention.mention_text || null,
    proposed_name: mention.proposed_name || mention.mention_text || null,
    proposed_relationship: mention.proposed_relationship || null,
    candidate_person_ids: (candidates || []).map((c) => c.id),
    held_payload: heldPayload || {}, reask_count: 0,
    created_at: nowIso(), expires_at: expiresAt || ttlIso(),
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
  if (error) { logger.warn('clarifications.enqueue failed', String((error && error.message) || error)); return null; }
  return data;
}

// Promote the FIFO-first pending row to active (only if nothing is active), author
// and store its question, and return it. Enforces one-active-per-user + FIFO.
export async function activateNext(userId, { askedMessageId } = {}) {
  if (await getActive(userId)) return null;
  const { data } = await supabase.from(TABLE).select('*')
    .eq('user_id', userId).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (!data) return null;
  const clarify = (data.held_payload && data.held_payload.clarify) || {};
  const question = data.question_text || authorQuestion(clarify);
  await supabase.from(TABLE).update({
    status: 'active', activated_at: nowIso(), question_text: question, asked_message_id: askedMessageId || null,
  }).eq('id', data.id).eq('user_id', userId);
  return { clarification: { ...data, status: 'active', question_text: question }, question };
}

export async function resolveRow(id, userId, { resolution, resolvedPersonId, answeredMessageId } = {}) {
  await supabase.from(TABLE).update({
    status: 'resolved', resolution, resolved_person_id: resolvedPersonId || null,
    answered_message_id: answeredMessageId || null, resolved_at: nowIso(),
  }).eq('id', id).eq('user_id', userId);
}

export async function bumpReask(active, userId) {
  await supabase.from(TABLE).update({ reask_count: (active.reask_count || 0) + 1 })
    .eq('id', active.id).eq('user_id', userId);
}

// ── Per-turn orchestrator (§2.2). deps = { resolveEntities, persist }. Returns
// { reply }. Crisis and the safety suppression window are honored here.
export async function dispatch({ user, message, parsed, body, inSuppression = false, deps = {} }) {
  const base = (parsed && parsed.reply) || 'Got it.';
  // Crisis / boundary: NEVER touch pending state (§2.3). The fixed reply stands.
  if (parsed && parsed._suppressPersistence) return { reply: base };

  const { resolveEntities, persist } = deps;
  let confirmation = null;
  let handledAsAnswer = false;

  // STEP 1 — interpret THIS message as an answer to the active clarification.
  const active = await getActive(user.id);
  if (active) {
    const clarify = (active.held_payload && active.held_payload.clarify) || {};
    const interp = interpretClarificationReply(body, { candidates: clarify.candidates || [], proposed_name: active.proposed_name });
    if (interp.decision === 'same' && interp.personId) {
      await applyHeldWrites({ user, personId: interp.personId, held: active.held_payload, persist });
      await people.addAlias(user.id, interp.personId, active.proposed_name); // never re-ask this spelling
      await resolveRow(active.id, user.id, { resolution: 'same', resolvedPersonId: interp.personId, answeredMessageId: message.id });
      confirmation = confirmSame(clarify, interp.personId);
      handledAsAnswer = true;
    } else if (interp.decision === 'different') {
      const created = await people.create(user.id, { name: active.proposed_name, relationship: active.proposed_relationship || null });
      await applyHeldWrites({ user, personId: created.id, held: active.held_payload, persist });
      await resolveRow(active.id, user.id, { resolution: 'different', resolvedPersonId: created.id, answeredMessageId: message.id });
      confirmation = confirmDifferent(active.proposed_name);
      handledAsAnswer = true;
    }
    // else 'unclear' → fall through: process this message normally + re-ask once.
  }

  // STEP 2 — resolve THIS message's entities (skip when it was purely the answer).
  if (!handledAsAnswer && resolveEntities) {
    const resolved = await resolveEntities({ user, parsed, body });
    if (persist) await persist({ user, message, parsed, resolved });
    for (const ask of resolved.asks || []) {
      await enqueue({
        userId: user.id, mention: ask.mention, candidates: ask.candidates,
        heldPayload: buildHeldPayload({ parsed, mention: ask.mention, candidates: ask.candidates, askKind: ask.askKind, sourceMessageId: message.id }),
      });
    }
  }

  // STEP 3 — ONE reply, at most ONE question, suppression-aware (decisions 5 & 6).
  let question = null;
  if (!inSuppression) {
    if (active && !handledAsAnswer) {
      // active question still open + reply was unclear → one gentle re-ask.
      if ((active.reask_count || 0) < 1) { await bumpReask(active, user.id); question = active.question_text; }
    } else {
      // nothing active now → activate the FIFO-next held item and ask it.
      const next = await activateNext(user.id, { askedMessageId: message.id });
      if (next) question = next.question;
    }
  }
  return { reply: composeReply({ base, confirmation, question }) };
}

// ── Expiry sweep (§2.3 — timeout defaults to CREATE, never a guessed merge).
// deps: persist (injected), loadUser (id -> {id, timezone}). Returns { resolved }.
export async function sweepExpired({ persist, loadUser, now = Date.now() } = {}) {
  const cutoff = new Date(now).toISOString();
  const { data } = await supabase.from(TABLE).select('*')
    .in('status', ['active', 'pending']).lte('expires_at', cutoff);
  const rows = data || [];
  let resolved = 0;
  const touchedUsers = new Set();
  for (const row of rows) {
    const user = loadUser ? await loadUser(row.user_id) : { id: row.user_id };
    try {
      const created = await people.create(user.id, {
        name: row.proposed_name || (row.held_payload && row.held_payload.clarify && row.held_payload.clarify.newName) || 'Someone',
        relationship: row.proposed_relationship || null,
      });
      await applyHeldWrites({ user, personId: created.id, held: row.held_payload, persist });
      await resolveRow(row.id, row.user_id, { resolution: 'expired_default_new', resolvedPersonId: created.id });
      resolved++; touchedUsers.add(row.user_id);
    } catch (err) { logger.warn('clarifications.sweepExpired failed for row', String(err)); }
  }
  for (const uid of touchedUsers) { try { await activateNext(uid); } catch { /* best-effort */ } }
  return { resolved };
}
