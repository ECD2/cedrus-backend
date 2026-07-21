import { supabase } from '../lib/supabase.js';
import { daysUntilBirthday } from '../utils/time.js';
import * as people from './people.js';
import * as memory from './memory.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE INSIGHT ENGINE — "the reason to reach out."
//
// Computes, PER PERSON, a ranked list of insights (reasons to reach out or things
// to know right now) from REAL signals the rest of the backend already produces:
//
//   • recency / last touch  — v_agent_person_context.days_since_contact
//     (freshened by the contact_events trigger on people.last_contact_at), with
//     relationship_health_score as a secondary urgency booster.
//   • upcoming birthdays     — people.birthday_month/day (via getBirthdaysForUser).
//   • upcoming important dates — saved_items.event_date (active_saved_items on the
//     context view). Facts carry no structured date, so dated reasons come from
//     saved items; birthdays come from the people columns. (Documented choice.)
//   • recently-learned facts — current_facts[].created_at within a recent window.
//   • ring priority          — is_core_five tightens the recency threshold AND
//     boosts score, so the Inner/Core 5 are watched closest.
//   • open reminders/prompts/goals tied to a person — pending reminders,
//     open pending_prompts, and open user_goals.
//
// DESIGN (mirrors src/jobs/brief/select.js, which is pure + unit-testable):
//   1. computeInsights() is PURE and DETERMINISTIC — no DB, no clock of its own
//      (the caller passes `now`), no model call. Ranking is a fixed numeric
//      formula, so the order is testable and reproducible. This is the whole
//      engine; everything else is plumbing or phrasing.
//   2. formatInsight() is a SEPARATE, swappable natural-language formatter. It
//      holds NO ranking logic, so the phrasing can be replaced (or handed to a
//      model later) without touching the deterministic core.
//   3. getInsightsForUser() / getInsightsForPerson() are the clean READ functions
//      the future frontend calls: they gather real signals then run the pure core.
//
// ENTITLEMENT (tag, do NOT enforce): every insight is tagged free vs pro — Core 5
// people are free, everyone else is gated behind Pro. Billing is NOT enforced
// here; the surface decides later. The engine computes for ALL people regardless.
//
// This module is READ + RANK ONLY. It never sends anything and is not wired into
// SMS, the brief, or the sweeps. Surfacing/sending is a later, separate step.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;

// ── Tunables (deterministic; adjust from real data once insights are flowing) ──
const NEW_FACT_WINDOW_DAYS = 14;     // "you just learned X about Y"
const BIRTHDAY_WINDOW_DAYS = 14;     // surface a birthday up to two weeks out
const SAVED_EVENT_WINDOW_DAYS = 30;  // a concert/anniversary landing within a month
const REMINDER_WINDOW_DAYS = 14;     // an upcoming (or just-due) pending reminder
const REMINDER_OVERDUE_GRACE_DAYS = 7; // still-pending but a little past = "due now"
// Ring-weighted recency: the Core 5 are flagged as drifting far sooner.
const RECENCY_THRESHOLD_DAYS = { core: 14, regular: 30 };
const HEALTH_DRIFT = 60;             // mirror brief/sweeps: below = drifting (booster)
const CORE_FIVE_BOOST = 12;          // ring priority weighting on the score

// Base weight per insight type (before per-item urgency + ring boost).
const BASE = {
  birthday: 88,
  open_reminder: 80,
  saved_event: 70,
  open_prompt: 62,
  recency: 55,
  open_goal: 50,
  new_fact: 44,
};

// Stable tie-break order when two insights score equal (keeps ranking total +
// reproducible regardless of input array order).
const TYPE_ORDER = ['birthday', 'open_reminder', 'saved_event', 'open_prompt', 'recency', 'open_goal', 'new_fact'];
const TYPE_RANK = Object.fromEntries(TYPE_ORDER.map((t, i) => [t, i]));

// ── Small pure helpers ────────────────────────────────────────────────────────
const toIso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();
const ms = (now) => (now instanceof Date ? now.getTime() : new Date(now).getTime());

function daysUntil(iso, now) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - ms(now)) / DAY);
}
function ageInDays(iso, now) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ms(now) - t) / DAY));
}

export function planTier(user) {
  if (user && user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user && user.plan === 'trialing') return 'trial';
  return 'free';
}

// Entitlement tag ONLY (no enforcement): Core 5 is free, everyone else is Pro.
function entitlementFor(isCoreFive) {
  return isCoreFive ? 'free' : 'pro';
}

function makeInsight({ type, meta, score, detail }) {
  return {
    personId: meta.personId,
    personName: meta.name || 'them',
    isCoreFive: !!meta.isCoreFive,
    type,
    score,
    detail: detail || {},
    entitlement: entitlementFor(meta.isCoreFive), // 'free' | 'pro' — tag, not a gate
    gated: !meta.isCoreFive,                       // true => requires Pro at the surface
    message: null,                                 // filled by formatInsight below
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeInsights — the PURE, DETERMINISTIC engine. Given already-gathered
// signals and a fixed `now`, returns:
//   { generatedAt, insights, byPerson }
//     • byPerson[personId] = that person's FULL ranked insight list
//     • insights           = the global feed: top `perPerson` per person,
//                            ranked, capped to `limit` (when given)
// No I/O, no clock, no model. Same inputs → same output, every time.
// ─────────────────────────────────────────────────────────────────────────────
export function computeInsights({
  user = {}, context = [], birthdays = [], goals = [], reminders = [], prompts = [],
  now = new Date(), perPerson = 1, limit = null,
} = {}) {
  // 1) Build the person-metadata map from the context view (the master source of
  //    is_core_five / recency / facts / saved items). Self is excluded — you do
  //    not "reach out" to yourself.
  const selfIds = new Set();
  const metaById = new Map();
  for (const p of context || []) {
    if (p.is_self) { selfIds.add(p.person_id); continue; }
    metaById.set(p.person_id, {
      personId: p.person_id,
      name: p.name,
      isCoreFive: !!p.is_core_five,
      health: p.relationship_health_score,
      daysSince: p.days_since_contact,
      facts: p.current_facts || [],
      savedItems: p.active_saved_items || [],
    });
  }
  // Birthdays carry is_core_five + name directly and exclude archived people;
  // fold in anyone the context view didn't already cover.
  for (const b of birthdays || []) {
    if (selfIds.has(b.id) || metaById.has(b.id)) continue;
    metaById.set(b.id, {
      personId: b.id, name: b.name, isCoreFive: !!b.is_core_five,
      health: null, daysSince: null, facts: [], savedItems: [],
    });
  }

  const metaFor = (pid) => (pid && !selfIds.has(pid) ? metaById.get(pid) || null : null);
  const all = [];

  // 2) Birthdays ── people.birthday_month/day
  for (const b of birthdays || []) {
    const meta = metaFor(b.id);
    if (!meta) continue;
    const d = daysUntilBirthday(b.birthday_month, b.birthday_day, user.timezone);
    if (d === null || d > BIRTHDAY_WINDOW_DAYS) continue;
    const urgency = d <= 0 ? 12 : d <= 1 ? 11 : d <= 3 ? 8 : d <= 7 ? 5 : 2;
    all.push(makeInsight({ type: 'birthday', meta, score: score('birthday', urgency, meta), detail: { days: d } }));
  }

  // 3) Recency / last touch ── days_since_contact, threshold weighted by ring
  for (const meta of metaById.values()) {
    if (meta.daysSince == null) continue;
    const threshold = meta.isCoreFive ? RECENCY_THRESHOLD_DAYS.core : RECENCY_THRESHOLD_DAYS.regular;
    if (meta.daysSince < threshold) continue;
    const overdue = meta.daysSince - threshold;
    let urgency = Math.min(20, Math.floor(overdue / 7) * 4);
    if (meta.health != null && meta.health < HEALTH_DRIFT) urgency += 5; // corroborating drift
    all.push(makeInsight({
      type: 'recency', meta, score: score('recency', urgency, meta),
      detail: { days: meta.daysSince, weeks: Math.round(meta.daysSince / 7), health: meta.health ?? null },
    }));
  }

  // 4) Recently-learned facts ── current_facts[].created_at (skip mood: churny +
  //    single-valued). One insight per person: the freshest qualifying fact.
  for (const meta of metaById.values()) {
    let best = null;
    for (const f of meta.facts || []) {
      if (!f || f.type === 'mood' || !f.created_at) continue;
      const age = ageInDays(f.created_at, now);
      if (age == null || age > NEW_FACT_WINDOW_DAYS) continue;
      if (!best || age < best.age) best = { age, value: f.value, factType: f.type };
    }
    if (!best) continue;
    const urgency = Math.max(0, Math.round((NEW_FACT_WINDOW_DAYS - best.age) / 2)); // fresher = higher
    all.push(makeInsight({
      type: 'new_fact', meta, score: score('new_fact', urgency, meta),
      detail: { value: best.value, factType: best.factType, ageDays: best.age },
    }));
  }

  // 5) Upcoming saved-item dates ── active_saved_items[].event_date. Soonest only.
  for (const meta of metaById.values()) {
    let soon = null;
    for (const s of meta.savedItems || []) {
      if (!s || !s.event_date) continue;
      const d = daysUntil(s.event_date, now);
      if (d == null || d < 0 || d > SAVED_EVENT_WINDOW_DAYS) continue;
      if (!soon || d < soon.days) soon = { days: d, title: s.title, eventDate: s.event_date };
    }
    if (!soon) continue;
    const urgency = soon.days <= 3 ? 12 : soon.days <= 7 ? 9 : soon.days <= 14 ? 6 : 3;
    all.push(makeInsight({
      type: 'saved_event', meta, score: score('saved_event', urgency, meta),
      detail: { title: soon.title, days: soon.days, when: formatWhen(soon.eventDate) },
    }));
  }

  // 6) Open reminders ── pending reminders tied to a person, within the window
  for (const r of reminders || []) {
    const meta = metaFor(r.person_id);
    if (!meta || !r.trigger_at) continue;
    const d = daysUntil(r.trigger_at, now);
    if (d == null || d > REMINDER_WINDOW_DAYS || d < -REMINDER_OVERDUE_GRACE_DAYS) continue;
    const urgency = d <= 0 ? 14 : Math.max(0, REMINDER_WINDOW_DAYS - d);
    all.push(makeInsight({
      type: 'open_reminder', meta, score: score('open_reminder', urgency, meta),
      detail: { title: r.title || 'a reminder', days: d, reminderId: r.id },
    }));
  }

  // 7) Open prompts ── a question Cedrus asked and is still awaiting an answer to
  for (const q of prompts || []) {
    const meta = metaFor(q.person_id);
    if (!meta) continue;
    const age = q.created_at ? ageInDays(q.created_at, now) : 0;
    const urgency = Math.min(10, age || 0);
    all.push(makeInsight({
      type: 'open_prompt', meta, score: score('open_prompt', urgency, meta),
      detail: { question: q.question_text || null, ageDays: age, promptId: q.id },
    }));
  }

  // 8) Open goals ── an intention the user set to reach out to this person
  for (const g of goals || []) {
    const meta = metaFor(g.person_id);
    if (!meta) continue;
    all.push(makeInsight({
      type: 'open_goal', meta, score: score('open_goal', 0, meta),
      detail: { goal: g.goal_text || null, goalId: g.id },
    }));
  }

  // 9) Phrase, group, rank
  for (const ins of all) ins.message = formatInsight(ins);

  const byPerson = {};
  for (const ins of all) (byPerson[ins.personId] || (byPerson[ins.personId] = [])).push(ins);
  for (const pid of Object.keys(byPerson)) byPerson[pid].sort(rank);

  const capped = perPerson === Infinity
    ? all.slice()
    : Object.values(byPerson).flatMap((list) => list.slice(0, Math.max(0, perPerson)));
  capped.sort(rank);
  const insights = limit != null ? capped.slice(0, limit) : capped;

  return { generatedAt: toIso(now), insights, byPerson };
}

// Deterministic ranking: score desc, then a fixed tie-break (type order, then
// name, then personId, then a stable detail signature) so ties never depend on
// input order.
function rank(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  const n = String(a.personName).localeCompare(String(b.personName));
  if (n !== 0) return n;
  if (a.personId !== b.personId) return String(a.personId) < String(b.personId) ? -1 : 1;
  return JSON.stringify(a.detail).localeCompare(JSON.stringify(b.detail));
}

function score(type, urgency, meta) {
  return BASE[type] + urgency + (meta.isCoreFive ? CORE_FIVE_BOOST : 0);
}

function formatWhen(iso) {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// formatInsight — the SWAPPABLE natural-language layer. Deliberately holds NO
// ranking logic and reads only from the insight's own fields, so it can be
// replaced wholesale (a different voice, or a model call) without touching the
// deterministic core. House style: warm, brief, and no em dashes.
// ─────────────────────────────────────────────────────────────────────────────
export function formatInsight(ins) {
  const name = ins.personName || 'them';
  const d = ins.detail || {};
  switch (ins.type) {
    case 'birthday': {
      const when = d.days <= 0 ? 'today' : d.days === 1 ? 'tomorrow' : `in ${d.days} days`;
      return `${name}'s birthday is ${when}.`;
    }
    case 'recency': {
      const span = d.weeks >= 1
        ? `about ${d.weeks} week${d.weeks > 1 ? 's' : ''}`
        : `${d.days} day${d.days === 1 ? '' : 's'}`;
      return `It's been ${span} since you connected with ${name}.`;
    }
    case 'saved_event':
      return `${d.title}${d.when ? ` on ${d.when}` : ''} is coming up for ${name}.`;
    case 'open_reminder': {
      const tail = d.days <= 0 ? ' (due now)' : d.days === 1 ? ' (tomorrow)' : '';
      return `You have a reminder about ${d.title} for ${name}${tail}.`;
    }
    case 'open_prompt':
      return d.question
        ? `Cedrus is still waiting to hear back about "${shorten(d.question, 60)}" for ${name}.`
        : `Cedrus is still waiting to hear back about ${name}.`;
    case 'open_goal':
      return d.goal
        ? `You wanted to reach out to ${name} about ${shorten(d.goal, 60)}.`
        : `You wanted to reach out to ${name}.`;
    case 'new_fact':
      return `Recently learned about ${name}: ${shorten(String(d.value || ''), 80)}.`;
    default:
      return `Something worth noting about ${name}.`;
  }
}

function shorten(s, n) {
  const t = String(s).trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ LAYER — the clean functions the future frontend calls. All Supabase reads
// go through injectable deps (defaults wired to the real services), so the pure
// core stays testable and callers can stub the gather.
// ─────────────────────────────────────────────────────────────────────────────

// Pending reminders tied to a person (read-only; never dispatches). The
// dispatcher fires trigger_at<=now, so a still-'pending' row a little past due
// is a legitimate "due now" reason to reach out.
export async function getOpenRemindersForUser(userId, deps = {}) {
  const db = deps.db || supabase;
  const { data } = await db.from('reminders')
    .select('id, person_id, title, trigger_at, status')
    .eq('user_id', userId).eq('status', 'pending').not('person_id', 'is', null)
    .order('trigger_at', { ascending: true }).limit(200);
  return data || [];
}

// Open questions Cedrus is awaiting an answer to, tied to a person.
export async function getOpenPromptsForUser(userId, deps = {}) {
  const db = deps.db || supabase;
  const { data } = await db.from('pending_prompts')
    .select('id, person_id, question_text, created_at, status')
    .eq('user_id', userId).eq('status', 'open').not('person_id', 'is', null)
    .order('created_at', { ascending: true }).limit(200);
  return data || [];
}

// Gather every real signal the engine ranks over. One place, injectable.
export async function gatherInsightSignals(user, deps = {}) {
  const getAgentContext = deps.getAgentContext || people.getAgentContext;
  const getBirthdays = deps.getBirthdays || people.getBirthdaysForUser;
  const getOpenGoals = deps.getOpenGoals || memory.getOpenGoals;
  const getOpenReminders = deps.getOpenReminders || ((uid) => getOpenRemindersForUser(uid, deps));
  const getOpenPrompts = deps.getOpenPrompts || ((uid) => getOpenPromptsForUser(uid, deps));
  const [context, birthdays, goals, reminders, prompts] = await Promise.all([
    getAgentContext(user.id), getBirthdays(user.id), getOpenGoals(user.id),
    getOpenReminders(user.id), getOpenPrompts(user.id),
  ]);
  return { context, birthdays, goals, reminders, prompts };
}

// The user's ranked insight FEED: the top insight per person (perPerson),
// ranked, optionally capped to `limit`. Each item is already entitlement-tagged.
export async function getInsightsForUser(user, opts = {}, deps = {}) {
  if (!user || !user.id) throw new Error('getInsightsForUser: user is required (ownership guard)');
  const now = opts.now || new Date();
  const signals = await gatherInsightSignals(user, deps);
  const { insights, generatedAt } = computeInsights({
    user, ...signals, now,
    perPerson: opts.perPerson != null ? opts.perPerson : 1,
    limit: opts.limit != null ? opts.limit : null,
  });
  // viewerTier is the viewer's own plan (free/trial/pro) so the SURFACE can apply
  // entitlement enforcement against each insight's `gated` tag. The engine still
  // computes + tags everyone; enforcement is deliberately not done here.
  return { generatedAt, viewerTier: planTier(user), insights };
}

// Every ranked insight for ONE person (a person page wants all the reasons, not
// just the top one). Returns [] for an unknown/self/archived person.
export async function getInsightsForPerson(user, personId, opts = {}, deps = {}) {
  if (!user || !user.id) throw new Error('getInsightsForPerson: user is required (ownership guard)');
  if (!personId) return { generatedAt: null, personId, viewerTier: planTier(user), insights: [] };
  const now = opts.now || new Date();
  const signals = await gatherInsightSignals(user, deps);
  const { byPerson, generatedAt } = computeInsights({ user, ...signals, now, perPerson: Infinity });
  return { generatedAt, personId, viewerTier: planTier(user), insights: byPerson[personId] || [] };
}
