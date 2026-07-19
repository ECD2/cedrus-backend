import { daysUntilBirthday } from '../../utils/time.js';

// Tunables — adjust from real briefs once they're flowing.
const HEALTH_DRIFT = 60;          // health below this = drifting
const HEALTH_URGENT = 40;         // health below this = really slipping
const BIRTHDAY_WINDOW_DAYS = 7;
const LIFE_EVENT_RECENT_DAYS = 60;
const SAVED_EVENT_WINDOW_DAYS = 30;
const MAX_MOMENTS = 3;            // keep the brief tight; curation > completeness

// Turn raw candidates into a ranked, gated brief PLAN. This is where the free/Pro
// boundary lives, and where we decide the few things worth surfacing.
//
// suppressPromo (safety spec §6): inside the 48h post-crisis window the
// promotional/playful layer is withheld — the Pro-locked teaser (an upsell) and
// the playful action offers. Factual moments, the goal aside, the self note and
// the closing question are ordinary brief content and keep flowing.
export function selectBriefItems(user, candidates, { suppressPromo = false } = {}) {
  const tier = planTier(user);
  const proLike = tier === 'pro' || tier === 'trial';
  const offerActions = proLike && !suppressPromo;

  const ctx = candidates.context || [];
  const byId = new Map(ctx.map(p => [p.person_id, p]));
  const self = ctx.find(p => p.is_self) || null;

  // proactive_enabled already encodes the gate: free => core-five (+self); pro/trial => everyone.
  const proactive = ctx.filter(p => p.proactive_enabled && !p.is_self);
  const outside = ctx.filter(p => !p.proactive_enabled && !p.is_self); // the free teaser pool

  const moments = [];

  // 1) Birthdays (free: core-five only; pro/trial: anyone)
  for (const b of candidates.birthdays || []) {
    const d = daysUntilBirthday(b.birthday_month, b.birthday_day, user.timezone);
    if (d === null || d > BIRTHDAY_WINDOW_DAYS) continue;
    if (!proLike && !b.is_core_five) continue;
    moments.push({
      type: 'birthday', personId: b.id, personName: b.name,
      detail: d === 0 ? 'birthday is today' : d === 1 ? 'birthday is tomorrow' : `birthday in ${d} days`,
      priority: d <= 3 ? 100 : 85, actionOffer: offerActions,
    });
  }

  // 2) Drift among proactive people (the signature Cedrus moment)
  for (const p of proactive) {
    if (p.relationship_health_score == null || p.relationship_health_score >= HEALTH_DRIFT) continue;
    const weeks = p.days_since_contact ? Math.round(p.days_since_contact / 7) : null;
    moments.push({
      type: 'drift', personId: p.person_id, personName: p.name,
      detail: weeks ? `haven't talked in about ${weeks} week${weeks > 1 ? 's' : ''}` : 'starting to slip',
      priority: p.relationship_health_score < HEALTH_URGENT ? 78 : 62, actionOffer: offerActions,
    });
  }

  // 3) Life-event follow-ups (the "it remembered" moments)
  for (const p of proactive) {
    const le = recentLifeEvent(p.current_facts, LIFE_EVENT_RECENT_DAYS);
    if (!le) continue;
    moments.push({
      type: 'life_event', personId: p.person_id, personName: p.name,
      detail: le, priority: 66, actionOffer: offerActions,
    });
  }

  // 4) Saved-item timing (a concert/release/gift moment landing soon)
  for (const p of proactive) {
    const si = upcomingSavedItem(p.active_saved_items, SAVED_EVENT_WINDOW_DAYS);
    if (!si) continue;
    moments.push({
      type: 'saved_item', personId: p.person_id, personName: p.name,
      detail: si, priority: 56, actionOffer: offerActions,
    });
  }

  // Rank, keep one moment per person, cap for a tight brief.
  const items = onePerPerson(moments.sort((a, b) => b.priority - a.priority)).slice(0, MAX_MOMENTS);

  // Last week's intention → a SOFT aside (not a tracked question; the mid-week
  // sweep is what follows up and captures the showing-up moment).
  const goalFollowup = buildGoalFollowup(candidates.openGoals, byId);

  // Free-tier teaser: people OUTSIDE the circle who are slipping (loss-aversion engine).
  // It is an upsell — suppressed outright inside the §6 window.
  let teaser = null;
  if (!proLike && !suppressPromo) {
    const slippingIds = new Set();
    const names = [];
    for (const p of outside) {
      if (p.relationship_health_score != null && p.relationship_health_score < HEALTH_DRIFT) {
        slippingIds.add(p.person_id);
      }
    }
    for (const b of candidates.birthdays || []) {
      if (!b.is_core_five) slippingIds.add(b.id);
    }
    for (const id of slippingIds) { const p = byId.get(id); if (p) names.push(p.name); }
    if (slippingIds.size > 0) teaser = { count: slippingIds.size, names: names.slice(0, 2) };
  }

  const selfNote = buildSelfNote(self);
  const quiet = items.length === 0;

  return {
    userName: user.name || null,
    planTier: tier,
    selfNote,
    items,
    goalFollowup,
    teaser,
    quiet,
    closingQuestion: 'Who do you want to make time for this week?',
  };
}

// ── helpers ──────────────────────────────────────────────────────────

function planTier(user) {
  if (user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user.plan === 'trialing') return 'trial';
  return 'free';
}

function onePerPerson(sorted) {
  const seen = new Set();
  const out = [];
  for (const m of sorted) {
    if (m.personId && seen.has(m.personId)) continue;
    if (m.personId) seen.add(m.personId);
    out.push(m);
  }
  return out;
}

function withinDays(iso, days) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && (Date.now() - t) <= days * 86400000 && t <= Date.now();
}

function recentLifeEvent(facts, days) {
  const le = (facts || [])
    .filter(f => f.type === 'life_event' && withinDays(f.created_at, days))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  return le ? le.value : null;
}

function upcomingSavedItem(items, days) {
  const soon = (items || [])
    .filter(s => s.event_date)
    .map(s => ({ ...s, _t: new Date(s.event_date).getTime() }))
    .filter(s => Number.isFinite(s._t) && s._t >= Date.now() && s._t <= Date.now() + days * 86400000)
    .sort((a, b) => a._t - b._t)[0];
  if (!soon) return null;
  const when = new Date(soon.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${soon.title} (${when})`;
}

function buildGoalFollowup(openGoals, byId) {
  const g = (openGoals || [])[0];
  if (!g) return null;
  const person = g.person_id ? byId.get(g.person_id) : null;
  return { goalText: g.goal_text, personName: person ? person.name : null };
}

function buildSelfNote(self) {
  if (!self || !self.current_facts) return null;
  const note = (self.current_facts || [])
    .filter(f => f.type === 'mood' || f.type === 'life_event')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  return note ? note.value : null;
}
