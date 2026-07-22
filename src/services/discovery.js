import { supabase } from '../lib/supabase.js';
import { daysUntilBirthday } from '../utils/time.js';
import * as interestsSvc from './interests.js';
import * as people from './people.js';
import * as memory from './memory.js';
import { isInSuppressionWindow } from './safetyFlags.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE DISCOVERY PLANNER — "what would be worth looking up to enrich the brief."
//
// Given a user's PROFILE (the things they've already told Cedrus about), this
// produces a ranked, capped PLAN of directed lookups that WOULD enrich a brief:
//
//   { type:'sports_schedule', subject:'Kansas City Chiefs', why:'followed team' }
//   { type:'local_event',     subject:'padel', near:'Miami',  why:'hobby' }
//   { type:'goal_context',    subject:'run a half marathon', why:'open goal' }
//
// It is a PLAN, not an action. This is the SIBLING of insights.js: insights ranks
// reasons to reach out from INTERNAL signals; discovery ranks EXTERNAL lookups
// (the Pro "internet-lookup" feature Emil defined) from the SAME profile data.
//
// FOUR load-bearing rules, all enforced structurally below:
//
//   1. PLAN ONLY. This module never fetches a URL, never calls a model, never
//      sends anything. It emits intentions; some later, separate executor (not
//      built here, not imported by anything) would run them. computeDiscoveryPlan
//      is PURE + DETERMINISTIC — no DB, no clock of its own (the caller passes
//      `now`), no network. Same inputs → same output, every time.
//   2. NO FABRICATION. Every plan item traces to a REAL profile datum via its
//      required `source` field (an interest row, an open goal, a person's
//      upcoming date). Nothing is invented: an empty profile yields an empty
//      plan, never a guessed one.
//   3. CAPPED + SELF-EXCLUDED. The plan is ranked by a fixed numeric formula and
//      capped (default 6). The user's own is_self person is never a subject.
//   4. SAFETY FIRST (spec §6/§7). Discovery IS the "learn your interests" /
//      Pro-promo track the crisis spec names by hand: it goes SILENT for the 48h
//      suppression window after any crisis signal, and never enriches crisis
//      content. getDiscoveryPlan checks isInSuppressionWindow BEFORE gathering
//      anything and returns an empty, suppressed plan inside the window.
//
// ENTITLEMENT (tag, do NOT enforce — mirrors insights.js): the internet-lookup
// enrichment is the Pro feature, so items are tagged 'pro'/gated — EXCEPT a
// Core-5 person's upcoming occasion, which stays in the free tier's "your inner
// circle's moments" promise ('free'/ungated). The planner computes + tags every
// item regardless of plan; the surface decides what to actually run.
//
// Imported by nothing. Read + rank + plan only.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86400000;

// The cap. "A brief is enriched by a handful of good lookups, not a firehose."
const DEFAULT_LIMIT = 6;

// ── Windows (deterministic; a person-occasion is only worth enriching if it is
//    actually coming up) ──────────────────────────────────────────────────────
const BIRTHDAY_WINDOW_DAYS = 14;     // mirror insights: surface up to two weeks out
const SAVED_EVENT_WINDOW_DAYS = 30;  // a concert/anniversary landing within a month

// ── Ranking tunables ──────────────────────────────────────────────────────────
// Base weight per plan type, before per-item urgency + the Core-5 ring boost.
const BASE = {
  person_occasion: 82, // a real upcoming date, personal + time-sensitive
  goal_context: 70,    // a user-declared intention — they asked for movement here
  sports_schedule: 60,
  media_release: 55,
  local_event: 52,
  place_context: 46,
};

// Stable tie-break order when two items score equal (keeps the ranking total +
// reproducible regardless of input array order — same discipline as insights).
const TYPE_ORDER = ['person_occasion', 'goal_context', 'sports_schedule', 'media_release', 'local_event', 'place_context'];
const TYPE_RANK = Object.fromEntries(TYPE_ORDER.map((t, i) => [t, i]));

const CORE_FIVE_BOOST = 10;  // person_occasion only: the inner circle ranks up
const PROVENANCE_BOOST = 5;  // a user_STATED interest outranks a merely inferred one
const NEAR_BOOST = 4;        // a local lookup we can actually localize outranks one we can't

// Interest categories that map to a directed lookup in v1. `food` and
// `other_freeform` are deliberately NOT planned yet: they have no single clean
// lookup shape, and planning a guess would violate rule 2. Widen when a real
// lookup shape exists for them. Keys mirror interests.INTEREST_CATEGORIES.
const INTEREST_PLAN = {
  sports_team: { type: 'sports_schedule', why: 'followed team' },
  hobby: { type: 'local_event', why: 'hobby' },
  media_show: { type: 'media_release', why: 'followed show' },
  media_music: { type: 'media_release', why: 'followed artist' },
  place: { type: 'place_context', why: 'place you follow' },
};

// ── Small pure helpers (copied intent from insights.js — no shared import so the
//    concat test rig can bundle this file in isolation) ─────────────────────────
const toIso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();
const ms = (now) => (now instanceof Date ? now.getTime() : new Date(now).getTime());
const isStr = (s) => typeof s === 'string' && s.trim() !== '';

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
// Freshness bucket: a recently-affirmed interest is a stronger enrichment signal
// than a stale one. Deterministic given `now`.
function freshnessBoost(iso, now) {
  const age = iso ? ageInDays(iso, now) : null;
  if (age == null) return 0;
  if (age <= 7) return 5;
  if (age <= 30) return 3;
  if (age <= 90) return 1;
  return 0;
}

export function planTier(user) {
  if (user && user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user && user.plan === 'trialing') return 'trial';
  return 'free';
}

// Entitlement tag ONLY (no enforcement). The internet-lookup enrichment is the
// Pro feature, so everything is 'pro'/gated EXCEPT a Core-5 person's occasion,
// which stays free (consistent with insights: Core 5 moments are the free tier).
function entitlementFor(item) {
  const free = item.type === 'person_occasion' && item.isCoreFive === true;
  return { entitlement: free ? 'free' : 'pro', gated: !free };
}

function makeItem({ type, subject, why, source, urgency, now, near = null, isCoreFive = false, detail = {} }) {
  const item = {
    type,
    subject,
    near,                    // populated only for local lookups; null otherwise
    why,
    isCoreFive: !!isCoreFive, // meaningful for person_occasion; false elsewhere
    score: BASE[type] + urgency + (isCoreFive ? CORE_FIVE_BOOST : 0),
    detail,
    source,                  // REQUIRED — traces to a real profile datum (rule 2)
    entitlement: null,       // filled just below
    gated: null,
    message: null,           // filled by formatPlanItem
  };
  const tag = entitlementFor(item);
  item.entitlement = tag.entitlement;
  item.gated = tag.gated;
  return item;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveLocation — where a `near` comes from, in a fixed, fully-traced order.
// Never invents a place: returns null (and `near` stays null) when the user has
// given us no location signal at all. Deterministic (no clock).
//   1. opts.location  — a place the caller resolved at call time (geo/IP, etc.)
//   2. profile        — a future app_users.home_location (see DISCOVERY.proposed.sql);
//                       null today, wired forward through the injectable read.
//   3. a `place` interest — the freshest active one the user actually follows.
// ─────────────────────────────────────────────────────────────────────────────
function resolveLocation({ optsLocation, profileLoc, interests }) {
  if (isStr(optsLocation)) return { value: optsLocation.trim(), source: { kind: 'caller' } };
  if (isStr(profileLoc)) return { value: profileLoc.trim(), source: { kind: 'profile', field: 'home_location' } };
  const places = (interests || []).filter((i) => i && i.category === 'place' && isStr(i.label));
  if (places.length) {
    // Freshest affirmation wins; label breaks ties so the pick is deterministic.
    places.sort((a, b) => {
      const fa = a.last_affirmed_at || a.created_at || '';
      const fb = b.last_affirmed_at || b.created_at || '';
      if (fa !== fb) return fa < fb ? 1 : -1; // desc = freshest first
      return String(a.label).localeCompare(String(b.label));
    });
    const p = places[0];
    return { value: p.label.trim(), source: { kind: 'interest_place', interestId: p.id } };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDiscoveryPlan — the PURE, DETERMINISTIC planner. Given already-gathered
// profile data + a fixed `now`, returns { generatedAt, plan }:
//   • plan = the ranked, capped list of directed lookups, each entitlement-tagged
//            and traced to its source datum.
// No I/O, no clock, no model, no fetch. Same inputs → same output, every time.
// ─────────────────────────────────────────────────────────────────────────────
export function computeDiscoveryPlan({
  user = {}, interests = [], goals = [], birthdays = [], context = [],
  location = null, now = new Date(), limit = null, maxPerType = null,
} = {}) {
  const near = location && isStr(location.value) ? location.value : null;
  const nearSource = near ? { ...location.source, value: near } : null;
  const all = [];

  // 1) INTERESTS → directed lookups. Only active interests reach here (the read
  //    layer asks listInterests for active-only, honoring the per-interest
  //    opt-out). Categories with no v1 lookup shape are skipped, not guessed.
  for (const i of interests || []) {
    if (!i || !isStr(i.label)) continue;
    const plan = INTEREST_PLAN[i.category];
    if (!plan) continue; // food / other_freeform / unknown — no fabrication
    const isLocal = plan.type === 'local_event';
    const urgency =
      (i.provenance === 'user_stated' ? PROVENANCE_BOOST : 0) +
      freshnessBoost(i.last_affirmed_at || i.created_at, now) +
      (isLocal && near ? NEAR_BOOST : 0);
    const source = { kind: 'interest', interestId: i.id, category: i.category, label: i.label };
    if (isLocal && nearSource) source.near = nearSource;
    all.push(makeItem({
      type: plan.type, subject: i.label.trim(), why: plan.why, source, urgency, now,
      near: isLocal ? near : null,
      detail: { category: i.category, provenance: i.provenance || null },
    }));
  }

  // 2) OPEN GOALS → goal_context lookups. Passed VERBATIM (no transformation, no
  //    invention). A goal the user set more recently is the fresher intention.
  for (const g of goals || []) {
    if (!g || !isStr(g.goal_text)) continue;
    const urgency = freshnessBoost(g.week_of || g.created_at, now);
    all.push(makeItem({
      type: 'goal_context', subject: g.goal_text.trim(), why: 'open goal',
      source: { kind: 'goal', goalId: g.id, personId: g.person_id || null },
      urgency, now, detail: { personId: g.person_id || null },
    }));
  }

  // 3) PEOPLE WITH UPCOMING DATES → person_occasion lookups (e.g. ways to mark a
  //    birthday, context for a saved event). Self is excluded — you do not plan a
  //    lookup about your own birthday. is_self + is_core_five + saved items come
  //    from the agent context view; birthdays from people.birthday_month/day.
  const selfIds = new Set();
  const metaById = new Map();
  for (const p of context || []) {
    if (!p) continue;
    if (p.is_self) { selfIds.add(p.person_id); continue; }
    metaById.set(p.person_id, {
      name: p.name, isCoreFive: !!p.is_core_five, savedItems: p.active_saved_items || [],
    });
  }

  // 3a) Birthdays — soonest within the window, one per person.
  for (const b of birthdays || []) {
    if (!b || selfIds.has(b.id)) continue;
    const d = daysUntilBirthday(b.birthday_month, b.birthday_day, user.timezone);
    if (d === null || d < 0 || d > BIRTHDAY_WINDOW_DAYS) continue;
    const name = (metaById.get(b.id) || {}).name || b.name || 'them';
    const isCoreFive = !!(b.is_core_five || (metaById.get(b.id) || {}).isCoreFive);
    const urgency = d <= 1 ? 16 : d <= 3 ? 12 : d <= 7 ? 8 : 5;
    all.push(makeItem({
      type: 'person_occasion', subject: `${name}'s birthday`, why: 'upcoming birthday',
      source: { kind: 'person', personId: b.id, occasion: 'birthday' },
      urgency, now, isCoreFive, detail: { personName: name, occasion: 'birthday', days: d },
    }));
  }

  // 3b) Saved-item dates — soonest within the window, one per person.
  for (const [personId, meta] of metaById.entries()) {
    let soon = null;
    for (const s of meta.savedItems || []) {
      if (!s || !s.event_date || !isStr(s.title)) continue;
      const d = daysUntil(s.event_date, now);
      if (d == null || d < 0 || d > SAVED_EVENT_WINDOW_DAYS) continue;
      if (!soon || d < soon.days) soon = { days: d, title: s.title.trim() };
    }
    if (!soon) continue;
    const urgency = soon.days <= 3 ? 14 : soon.days <= 7 ? 10 : soon.days <= 14 ? 6 : 3;
    all.push(makeItem({
      type: 'person_occasion', subject: soon.title, why: 'upcoming event',
      source: { kind: 'person', personId, occasion: 'saved_event', title: soon.title },
      urgency, now, isCoreFive: meta.isCoreFive,
      detail: { personName: meta.name || 'them', occasion: 'saved_event', days: soon.days },
    }));
  }

  // 4) Phrase, rank, cap.
  for (const item of all) item.message = formatPlanItem(item);
  all.sort(rank);

  let ranked = all;
  if (maxPerType != null) {
    const seen = {};
    ranked = all.filter((item) => {
      const n = (seen[item.type] || 0);
      if (n >= maxPerType) return false;
      seen[item.type] = n + 1;
      return true;
    });
  }
  const plan = limit != null ? ranked.slice(0, Math.max(0, limit)) : ranked;
  return { generatedAt: toIso(now), plan };
}

// Deterministic ranking: score desc, then a fixed tie-break (type order, then
// subject, then a stable source signature) so ties never depend on input order.
function rank(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  const s = String(a.subject).localeCompare(String(b.subject));
  if (s !== 0) return s;
  return JSON.stringify(a.source).localeCompare(JSON.stringify(b.source));
}

// ─────────────────────────────────────────────────────────────────────────────
// formatPlanItem — the SWAPPABLE natural-language layer. Holds NO ranking logic
// and reads only the item's own fields, so it can be replaced wholesale (a
// different voice, or a model later) without touching the deterministic core.
// House style (voice spec): warm, brief, no em dashes, no exclamation marks.
// These describe the INTENDED lookup; they are not run here.
// ─────────────────────────────────────────────────────────────────────────────
export function formatPlanItem(item) {
  const s = item.subject || 'this';
  switch (item.type) {
    case 'sports_schedule':
      return `Look up the ${s} schedule, a team you follow.`;
    case 'local_event':
      return item.near
        ? `Look for ${s} events near ${item.near}, a hobby of yours.`
        : `Look for ${s} events, a hobby of yours.`;
    case 'media_release':
      return `Check what is new from ${s}, ${item.why}.`;
    case 'place_context':
      return `See what is happening in ${s}, a place you follow.`;
    case 'goal_context':
      return `Find context that helps with ${shorten(s, 60)}, an open goal.`;
    case 'person_occasion':
      return item.detail && item.detail.occasion === 'birthday'
        ? `Look up ways to mark ${s} coming up.`
        : `Look up what would help with ${shorten(s, 60)} coming up.`;
    default:
      return `Worth looking into: ${shorten(s, 60)}.`;
  }
}

function shorten(str, n) {
  const t = String(str).trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ LAYER — the clean functions a future surface calls. Every read goes
// through an injectable dep (defaults wired to the real services), so the pure
// core stays testable and callers can stub the gather.
// ─────────────────────────────────────────────────────────────────────────────

// Default user-location read: today there is no app_users location column, so
// this reads forward-looking fields off the already-loaded user object (exactly
// as insights reads user.timezone) and returns null when absent. When
// app_users.home_location lands (DISCOVERY.proposed.sql), point this at it.
async function defaultUserLocation(user) {
  if (!user) return null;
  return user.home_location || user.location || user.city || null;
}

// Gather every real profile datum the planner ranks over. One place, injectable.
export async function gatherDiscoverySignals(user, opts = {}, deps = {}) {
  const getInterests = deps.getInterests
    || (async (u) => (await interestsSvc.listInterests({ user: u }, deps)).interests);
  const getOpenGoals = deps.getOpenGoals || memory.getOpenGoals;
  const getBirthdays = deps.getBirthdays || people.getBirthdaysForUser;
  const getAgentContext = deps.getAgentContext || people.getAgentContext;
  const getUserLocation = deps.getUserLocation || defaultUserLocation;

  const [interests, goals, birthdays, context, profileLoc] = await Promise.all([
    getInterests(user), getOpenGoals(user.id), getBirthdays(user.id),
    getAgentContext(user.id), getUserLocation(user),
  ]);
  const location = resolveLocation({ optsLocation: opts.location, profileLoc, interests });
  return { interests, goals, birthdays, context, location };
}

// The user's ranked discovery PLAN: directed lookups that would enrich a brief,
// ranked and capped (default 6). Each item is entitlement-tagged and traced to a
// real profile datum. NOTHING is fetched — this is a plan of intentions.
//
// SAFETY (spec §6): discovery is the promo / "learn your interests" track, so it
// goes SILENT during the 48h crisis-suppression window — checked BEFORE any
// gather, returning an empty { suppressed: true } plan. The check fails open (the
// safetyFlags read returns false when its flag is unavailable), exactly as the
// safety module intends: ordinary product keeps working; only this promo layer
// pauses, and only when the flag is genuinely active.
export async function getDiscoveryPlan(user, opts = {}, deps = {}) {
  if (!user || !user.id) throw new Error('getDiscoveryPlan: user is required (ownership guard)');
  const now = opts.now || new Date();

  const suppressionCheck = deps.isInSuppressionWindow
    || (typeof isInSuppressionWindow === 'function' ? isInSuppressionWindow : null);
  const suppressed = suppressionCheck ? await suppressionCheck(user.id) : false;
  if (suppressed) {
    return { generatedAt: toIso(now), viewerTier: planTier(user), suppressed: true, plan: [] };
  }

  const signals = await gatherDiscoverySignals(user, opts, deps);
  const { plan, generatedAt } = computeDiscoveryPlan({
    user, ...signals, now,
    limit: opts.limit != null ? opts.limit : DEFAULT_LIMIT,
    maxPerType: opts.maxPerType != null ? opts.maxPerType : null,
  });
  // viewerTier is the viewer's own plan (free/trial/pro) so the SURFACE can apply
  // entitlement enforcement against each item's `gated` tag. The planner still
  // computes + tags every item; enforcement is deliberately not done here.
  return { generatedAt, viewerTier: planTier(user), suppressed: false, plan };
}
