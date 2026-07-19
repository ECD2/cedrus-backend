import { daysUntilBirthday } from '../../utils/time.js';

const HEALTH_DRIFT = 60, HEALTH_URGENT = 40;
const GOAL_FOLLOWUP_MIN_AGE_DAYS = 3;   // wait a few days after the brief before asking
const PERSON_COOLDOWN_DAYS = 7;         // don't nudge about the same person too often

// Choose at most ONE nudge for this user (restraint is the brand). Returns null
// when nothing rises to the bar — silence is a feature.
//
// TYPE gate (matches the cadence design):
//   free  → goal follow-ups + day-of birthdays, core-five only (unmissable + their own intentions)
//   pro   → all of the above + mid-week drift, across everyone
//
// suppressPromo (safety spec §6): inside the 48h post-crisis window the playful
// proactive layer — drift nudges — is withheld. Goal follow-ups and day-of
// birthdays are ordinary factual tasks and continue (the person isn't paused).
export function selectNudge(user, cand, now = new Date(), { suppressPromo = false } = {}) {
  const tier = planTier(user);
  const proLike = tier === 'pro' || tier === 'trial';
  const ctx = cand.context || [];
  const byId = new Map(ctx.map(p => [p.person_id, p]));
  const cooldown = new Map((cand.cooldowns || []).map(c => [c.id, c.last_nudged_at]));
  const recentlyNudged = (pid) => {
    const t = cooldown.get(pid);
    return t ? (Date.now() - new Date(t).getTime()) < PERSON_COOLDOWN_DAYS * 86400000 : false;
  };

  const candidates = [];

  // Goal follow-up (free + pro) — the showing-up loop; asks a tracked question.
  for (const g of cand.goals || []) {
    if (!g.person_id || recentlyNudged(g.person_id)) continue;
    const ageDays = (Date.now() - new Date(g.created_at).getTime()) / 86400000;
    if (ageDays < GOAL_FOLLOWUP_MIN_AGE_DAYS) continue;
    const p = byId.get(g.person_id);
    if (!proLike && !(p && p.is_core_five)) continue; // free: core-five only
    candidates.push({
      type: 'goal_followup', personId: g.person_id, personName: p ? p.name : 'them',
      detail: g.goal_text, isQuestion: true, priority: 80, goalId: g.id,
    });
  }

  // Day-of / day-before birthday (free: core-five; pro: anyone) — gentle alert.
  for (const b of cand.birthdays || []) {
    const d = daysUntilBirthday(b.birthday_month, b.birthday_day, user.timezone);
    if (d === null || d > 1) continue;
    if (!proLike && !b.is_core_five) continue;
    if (recentlyNudged(b.id)) continue;
    candidates.push({
      type: 'birthday', personId: b.id, personName: b.name,
      detail: d === 0 ? 'birthday is today' : 'birthday is tomorrow',
      isQuestion: false, priority: 100,
    });
  }

  // Drift (PRO/trial only — real-time drift is a Pro capability) — gentle alert.
  // Withheld during the §6 suppression window (the playful proactive layer).
  if (proLike && !suppressPromo) {
    for (const p of ctx) {
      if (p.is_self || !p.proactive_enabled) continue;
      if (p.relationship_health_score == null || p.relationship_health_score >= HEALTH_DRIFT) continue;
      if (recentlyNudged(p.person_id)) continue;
      const weeks = p.days_since_contact ? Math.round(p.days_since_contact / 7) : null;
      candidates.push({
        type: 'drift', personId: p.person_id, personName: p.name,
        detail: weeks ? `haven't talked in about ${weeks} week${weeks > 1 ? 's' : ''}` : 'starting to slip',
        isQuestion: false, priority: p.relationship_health_score < HEALTH_URGENT ? 70 : 60,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  return { ...candidates[0], planTier: tier };
}

function planTier(user) {
  if (user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user.plan === 'trialing') return 'trial';
  return 'free';
}
