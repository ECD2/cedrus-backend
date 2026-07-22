import { computeInsights, gatherInsightSignals } from './insights.js';
import { isInSuppressionWindow } from './safetyFlags.js';
import { listInterests } from './interests.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE BRIEF ENGINE — "the reason to reach out, composed into a brief."
//
// EXTENDS the existing weekly-brief pipeline (src/jobs/brief/gather|select|compose)
// by feeding the INSIGHT ENGINE (src/services/insights.js) into the brief's select
// stage, so the brief surfaces REAL reasons to reach out (recency, birthdays,
// upcoming dates, recently-learned facts, open reminders/prompts/goals) instead of
// re-deriving them. It does NOT replace the send pipeline: weeklyBrief.js still
// gather→select→composes→sends exactly as before. This module is the READ side —
// inert and queryable, like insights.js. Nothing here sends, schedules, or writes.
//
// THREE STAGES, mirroring the pipeline vocabulary but insight-driven:
//   1. selectBriefReasons()  — PURE. Turns the insight feed into a ranked, gated
//      brief PLAN. This is where insights get "wired into select": entitlement is
//      honored (Core 5 reasons are free/actionable; gated Pro reasons become the
//      free-tier loss-aversion teaser), and the §6 crisis-suppression contract is
//      reproduced exactly (suppressPromo strips the teaser + action offers while
//      factual reasons keep flowing).
//   2. composeBriefContent() — PURE. Deterministically composes the plan into a
//      returnable brief: structured `sections`, a `plan` in the SAME shape the
//      OpenAI composer (src/jobs/brief/compose.js) consumes, and voice-safe `text`.
//      Deterministic on purpose: it makes selection + voice unit-testable and keeps
//      the engine inert (no model call), exactly like insights.js. Wiring the plan
//      to the model composer later is a one-line graft — the plan shape already fits.
//   3. buildFirstBrief()     — PURE. The onboarding payoff: a distinct "first brief"
//      for a brand-new user, composed from a thin profile (their people, goals,
//      interests, location) plus whatever real insights already exist. Honest about
//      cold-start: it NEVER fabricates. A section with nothing real is omitted, and
//      the truly-empty case says so plainly in the product voice.
//
// READ LAYER (what a future surface calls):
//   generateBrief(user, opts, deps)      → gather → computeInsights → select →
//                                           compose → RETURN the composed brief
//   generateFirstBrief(user, opts, deps) → gather thin profile → RETURN first brief
// Both consult the §6 suppression window (read-only, fail-open) like previewBrief,
// and neither is wired into SMS, email, the scheduler, or any dispatch.
//
// VOICE (CEDRUS_VOICE_AND_EMOTIONAL_INTELLIGENCE_SPEC): every string this module
// emits follows acknowledge → task → open-door, uses no em dashes and no exclamation
// marks, avoids the banned cheerful vocabulary, and never resurfaces a negative fact
// cheerfully. voiceScan() below is the enforceable backstop and is unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

// ── Tunables (deterministic; adjust from real briefs once they're flowing) ─────
const MAX_REASONS = 3;         // keep the brief tight; curation > completeness (mirrors select.js MAX_MOMENTS)
const MAX_TEASER_NAMES = 2;    // how many outside-circle names the free teaser shows
const MAX_FIRST_PEOPLE = 3;    // names to greet a new user with in the first brief
const MAX_FIRST_INTERESTS = 3; // interests to reflect back in the first brief

// The reason types the brief treats as PROMOTIONAL follow-through — an action offer
// ("want me to draft something?") rides these. Everything else is plain factual.
// (The teaser/upsell is handled separately.) Kept as data so it stays inspectable.
const CLOSING_QUESTION = 'Who do you want to make time for this week?';

// ─────────────────────────────────────────────────────────────────────────────
// tierOf — the viewer's own plan. Local (not imported from insights.js) so the
// pure stages stay self-contained and unit-testable in isolation.
// ─────────────────────────────────────────────────────────────────────────────
export function tierOf(user) {
  if (user && user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user && user.plan === 'trialing') return 'trial';
  return 'free';
}

// ─────────────────────────────────────────────────────────────────────────────
// selectBriefReasons — PURE. insight feed (+ light context) → ranked, gated PLAN.
//
// `insights` is the entitlement-tagged feed from computeInsights (one ranked reason
// per person). We split it on the tag:
//   • free viewer  → actionable reasons are the FREE-tagged (Core 5) insights only;
//                    the GATED (Pro) insights become the loss-aversion teaser.
//   • pro/trial    → every insight is actionable; there is no teaser.
//
// suppressPromo (safety spec §6): inside the 48h post-crisis window the promotional
// /playful layer is withheld — the Pro teaser (an upsell) and the action offers.
// Factual reasons, the goal aside, the self note and the closing question are
// ordinary brief content and keep flowing. This reproduces src/jobs/brief/select.js's
// contract exactly (see test/brief-suppression.test.js) on the insight-driven path.
// ─────────────────────────────────────────────────────────────────────────────
export function selectBriefReasons(user, { insights = [], selfNote = null, goalFollowup = null } = {}, { suppressPromo = false } = {}) {
  const tier = tierOf(user);
  const proLike = tier === 'pro' || tier === 'trial';
  const offerActions = proLike && !suppressPromo;

  // Actionable reasons: free sees only ungated (Core 5) reasons; pro/trial see all.
  // Input is already ranked by the insight engine; we keep that order, one per
  // person (the feed already is), and cap for a tight brief.
  const eligible = (insights || []).filter((i) => i && (proLike || i.gated === false));
  const reasons = eligible.slice(0, MAX_REASONS).map((i) => ({
    type: i.type,
    personId: i.personId,
    personName: i.personName,
    detail: i.message,                 // already voice-safe (formatInsight, no em dash)
    entitlement: i.entitlement,
    gated: !!i.gated,
    actionOffer: offerActions,         // promo follow-through; off for free + off in §6 window
  }));

  // Free-tier teaser: the GATED (outside-circle) people who have a live reason are
  // the loss-aversion pool. It is an upsell, so it is suppressed outright in §6.
  let teaser = null;
  if (!proLike && !suppressPromo) {
    const seen = new Set();
    const names = [];
    for (const i of insights || []) {
      if (!i || i.gated !== true || !i.personId || seen.has(i.personId)) continue;
      seen.add(i.personId);
      if (names.length < MAX_TEASER_NAMES) names.push(i.personName);
    }
    if (seen.size > 0) teaser = { count: seen.size, names };
  }

  return {
    planTier: tier,
    selfNote: selfNote || null,
    reasons,
    goalFollowup: goalFollowup || null,
    teaser,
    quiet: reasons.length === 0,
    suppressed: !!suppressPromo,
    closingQuestion: CLOSING_QUESTION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// composeBriefContent — PURE. plan → returnable brief. Deterministic, voice-safe.
//
// Returns:
//   { variant, generatedAt, userName, viewerTier, suppressed, quiet, sections,
//     plan, text }
//   • sections — structured, for a frontend to render however it likes.
//   • plan     — the SAME shape src/jobs/brief/compose.js's OpenAI composer already
//                consumes (userName, planTier, selfNote, items, goalFollowup,
//                teaser, quiet, closingQuestion), so wiring a model render later is
//                trivial. We do NOT call the model here (kept inert + deterministic).
//   • text     — a deterministic acknowledge → task → open-door render.
// ─────────────────────────────────────────────────────────────────────────────
export function composeBriefContent(user, selection, { now = new Date() } = {}) {
  const userName = (user && user.name) || null;
  const s = selection;

  // acknowledge — a gentle opener. If the user has a self note we acknowledge that
  // they have their OWN week going on WITHOUT echoing the raw fact (echoing freeform
  // facts deterministically risks resurfacing a negative one; the raw value is kept
  // in sections.selfNote for the model path / frontend). See voice spec.
  const opening = s.selfNote
    ? `A quick note before the week. I'm thinking of you.`
    : greeting(userName);

  // task — the reasons, then an optional single action offer (pro, non-suppressed).
  const reasonLines = s.reasons.map((r) => r.detail);
  const anyOffer = s.reasons.some((r) => r.actionOffer);

  // goal aside — acknowledged warmly, never as a question (mirrors the brief prompt).
  const goalAside = s.goalFollowup ? goalAsideLine(s.goalFollowup) : null;

  // teaser — one gentle sentence, free plan only, already null when suppressed.
  const teaserLine = s.teaser ? teaserSentence(s.teaser) : null;

  const closing = closingLine(s.closingQuestion);

  // Assemble the deterministic text. Quiet weeks acknowledge the calm honestly
  // rather than manufacturing reasons (mirrors the brief prompt's quiet rule).
  const parts = [opening];
  if (s.quiet) {
    parts.push(`Quiet week, nobody is slipping, which is its own kind of good.`);
  } else {
    parts.push(...reasonLines);
    if (anyOffer) parts.push(`Want me to help you pick one to reach out to?`);
  }
  if (goalAside) parts.push(goalAside);
  if (teaserLine) parts.push(teaserLine);
  parts.push(closing);
  const text = joinSentences(parts);

  const sections = {
    opening,
    reasons: s.reasons,
    goalAside,
    teaser: s.teaser ? { ...s.teaser, message: teaserLine } : null,
    closing,
  };

  // The compose.js-compatible plan (so a future model render is a one-line graft).
  const plan = {
    userName,
    planTier: s.planTier,
    selfNote: s.selfNote,
    items: s.reasons.map((r) => ({
      type: r.type, personName: r.personName, detail: r.detail, actionOffer: r.actionOffer,
    })),
    goalFollowup: s.goalFollowup,
    teaser: s.teaser,
    quiet: s.quiet,
    closingQuestion: s.closingQuestion,
  };

  return {
    variant: 'weekly',
    generatedAt: isoOf(now),
    userName,
    viewerTier: s.planTier,
    suppressed: s.suppressed,
    quiet: s.quiet,
    sections,
    plan,
    text,
    voice: voiceScan(text),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildFirstBrief — PURE. The onboarding payoff for a brand-new user.
//
// Works from a THIN profile the moment onboarding finishes. It surfaces only what
// is REAL — the people they named, interests they gave, goals they set, and any
// insight that already legitimately exists (e.g. a birthday they entered). It NEVER
// fabricates activity that did not happen. Empty sections are omitted; the
// truly-empty profile gets an honest, welcoming, open-door message.
//
// profile = { people:[{id,name,relationship?}], interests:[{category,label}],
//             goals:[{goal_text,...}], location: string|null }
// insights = the (usually small) real insight feed for this new user; may be [].
// ─────────────────────────────────────────────────────────────────────────────
export function buildFirstBrief(user, profile = {}, { insights = [], now = new Date() } = {}) {
  const userName = (user && user.name) || null;
  const people = (profile.people || []).filter((p) => p && !p.is_self && p.name);
  const interests = (profile.interests || []).filter((i) => i && i.label);
  const goals = (profile.goals || []).filter((g) => g && g.goal_text);
  const location = profile.location || null;

  // Real reasons only (a birthday they entered during onboarding is legitimate; a
  // cold-start user usually has none, and that is fine).
  const reasons = (insights || []).slice(0, MAX_REASONS).map((i) => ({
    type: i.type, personId: i.personId, personName: i.personName, detail: i.message,
    entitlement: i.entitlement, gated: !!i.gated,
  }));

  const hasAnything = people.length > 0 || interests.length > 0 || goals.length > 0 || reasons.length > 0;

  // acknowledge — always warm and welcoming; positive valence, still no banned words.
  const welcome = userName
    ? `Good to have you here, ${userName}. I'm Cedrus, and I help you show up for the people you care about.`
    : `Good to have you here. I'm Cedrus, and I help you show up for the people you care about.`;

  const parts = [welcome];
  const sections = { welcome, people: [], reasons, interests: [], goals: [], location, empty: !hasAnything };

  if (hasAnything) {
    // task — reflect back ONLY what is real, in the product voice.
    if (people.length) {
      const names = people.slice(0, MAX_FIRST_PEOPLE).map((p) => p.name);
      sections.people = people.map((p) => ({ id: p.id, name: p.name, relationship: p.relationship || null }));
      parts.push(`You have already told me about ${listPhrase(names)}.`);
    }
    for (const r of reasons) parts.push(r.detail); // real insights (e.g. a birthday), voice-safe
    if (interests.length) {
      const labels = interests.slice(0, MAX_FIRST_INTERESTS).map((i) => i.label);
      sections.interests = interests.map((i) => ({ category: i.category, label: i.label }));
      parts.push(`I also have that you are into ${listPhrase(labels)}.`);
    }
    if (goals.length) {
      sections.goals = goals.map((g) => ({ goalText: g.goal_text, personId: g.person_id || null }));
      // Forward-looking for a NEW user (the goal was just set), not the weekly
      // recap's past tense. Never invents progress that has not happened yet.
      parts.push(`You set a goal to ${clip(String(goals[0].goal_text || 'stay close'), 60)}, and I will help you keep it.`);
    }
    // open-door — invite the first real reach-out.
    parts.push(people.length
      ? `Who is on your mind first this week?`
      : `Who is someone you want to keep closer this week?`);
  } else {
    // Honest cold-start: nothing real to surface. Say so plainly and open the door.
    parts.push(`I do not have anyone in here yet, and that is okay.`);
    parts.push(`Tell me about someone you care about and I will help you keep up with them.`);
  }

  const text = joinSentences(parts);
  return {
    variant: 'first',
    generatedAt: isoOf(now),
    userName,
    viewerTier: tierOf(user),
    quiet: !hasAnything,
    empty: !hasAnything,
    sections,
    text,
    voice: voiceScan(text),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// READ LAYER — the clean functions a future surface calls. All I/O goes through
// injectable deps (defaults wired to the real services + the insight engine), so
// the pure stages stay testable and callers can stub the gather.
// ─────────────────────────────────────────────────────────────────────────────

// The user's composed WEEKLY brief, RETURNED (never sent). Gathers the same real
// signals the insight engine ranks, runs the pure select → compose stages, and
// honors the §6 suppression window read-only (fail-open), exactly like previewBrief.
export async function generateBrief(user, opts = {}, deps = {}) {
  if (!user || !user.id) throw new Error('generateBrief: user is required (ownership guard)');
  const now = opts.now || new Date();
  const gather = deps.gatherInsightSignals || gatherInsightSignals;
  const compute = deps.computeInsights || computeInsights;
  const suppressionRead = deps.isInSuppressionWindow || isInSuppressionWindow;

  const signals = await gather(user, deps);
  const { insights } = compute({ user, ...signals, now, perPerson: 1, limit: null });
  const selfNote = selfNoteFrom(signals.context);
  const goalFollowup = goalFollowupFrom(signals.goals, signals.context);

  // Read-only §6 check: reflect suppression reality without ever pausing the brief.
  const suppressPromo = opts.suppressPromo != null ? opts.suppressPromo : await safeSuppression(suppressionRead, user.id);

  const selection = selectBriefReasons(user, { insights, selfNote, goalFollowup }, { suppressPromo });
  return composeBriefContent(user, selection, { now });
}

// The user's FIRST brief, RETURNED (never sent). Gathers a thin onboarding profile
// (people, interests, goals, location) plus any real insights, and composes the
// welcoming cold-start brief without fabricating anything.
export async function generateFirstBrief(user, opts = {}, deps = {}) {
  if (!user || !user.id) throw new Error('generateFirstBrief: user is required (ownership guard)');
  const now = opts.now || new Date();
  const gather = deps.gatherInsightSignals || gatherInsightSignals;
  const compute = deps.computeInsights || computeInsights;

  const signals = await gather(user, deps);
  const { insights } = compute({ user, ...signals, now, perPerson: 1, limit: null });
  const profile = await gatherBriefProfile(user, signals, deps);
  return buildFirstBrief(user, profile, { insights, now });
}

// Assemble the thin first-brief profile from real onboarding data. People come from
// the same context the insight engine already gathered (no extra read); interests
// and location are the two first-brief-specific reads, both injectable.
export async function gatherBriefProfile(user, signals, deps = {}) {
  const listInts = deps.listInterests || ((u) => listInterests({ user: u }, deps));
  const getLocation = deps.getLocation || ((u) => u.location || u.city || u.region || null);

  const context = (signals && signals.context) || [];
  const people = context
    .filter((p) => p && !p.is_self && p.person_id)
    .map((p) => ({ id: p.person_id, name: p.name, relationship: p.relationship || null, is_self: false }));

  let interests = [];
  try {
    const res = await listInts(user);
    interests = (res && res.interests) || [];
  } catch { interests = []; } // a missing interests table must not break the first brief

  return {
    people,
    interests,
    goals: (signals && signals.goals) || [],
    location: getLocation(user),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// voiceScan — the enforceable voice backstop. Returns { ok, violations } listing
// any em dash, exclamation mark, or banned cheerful word. This module authors its
// copy to pass by construction; the scan is what the voice-compliance test asserts
// against, and a cheap guard a caller can apply to model-composed text too.
// ─────────────────────────────────────────────────────────────────────────────
const BANNED_CHEER = /\b(great|awesome|yay|woohoo|amazing|nice|wonderful|exciting|congrats|congratulations)\b/i;
export function voiceScan(text) {
  const t = String(text || '');
  const violations = [];
  if (t.includes('—')) violations.push('em_dash');
  if (t.includes('!')) violations.push('exclamation');
  const cheer = t.match(BANNED_CHEER);
  if (cheer) violations.push('banned_cheer:' + cheer[0].toLowerCase());
  return { ok: violations.length === 0, violations };
}

// ── small pure helpers ─────────────────────────────────────────────────────────
function isoOf(now) { return (now instanceof Date ? now : new Date(now)).toISOString(); }

function greeting(userName) {
  return userName ? `Hey ${userName}.` : `Hey.`;
}

function closingLine(q) {
  const t = String(q || CLOSING_QUESTION).trim();
  return /[?.]$/.test(t) ? t : t + '?';
}

function goalAsideLine({ goalText, personName }) {
  const who = personName ? ` with ${personName}` : '';
  return `I hope you got some time in${who} on ${clip(String(goalText || 'that'), 60)}.`;
}

function teaserSentence({ count, names }) {
  const who = (names || []).length ? ` ${listPhrase(names)}` : '';
  const someone = count === 1 ? 'Someone' : 'A couple of people';
  return `${someone} outside your circle${who ? ',' + who + ',' : ''} started to drift too. Pro keeps everyone close.`;
}

// "a", "a and b", "a, b, and c"
function listPhrase(items) {
  const xs = (items || []).filter(Boolean);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

// Join into flowing prose, one space between sentences, each ending in punctuation.
function joinSentences(parts) {
  return (parts || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map((p) => (/[.?]$/.test(p) ? p : p + '.'))
    .join(' ')
    .trim();
}

function clip(sIn, n) {
  const t = String(sIn).trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

// The user's OWN recent note (mood or life event on their is_self person), for a
// gentle acknowledgment. Mirrors buildSelfNote in src/jobs/brief/select.js.
function selfNoteFrom(context) {
  const self = (context || []).find((p) => p && p.is_self);
  if (!self || !self.current_facts) return null;
  const note = (self.current_facts || [])
    .filter((f) => f.type === 'mood' || f.type === 'life_event')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  return note ? note.value : null;
}

// Last week's still-open intention → a soft aside (mirrors buildGoalFollowup).
function goalFollowupFrom(openGoals, context) {
  const g = (openGoals || [])[0];
  if (!g) return null;
  const person = g.person_id ? (context || []).find((p) => p && p.person_id === g.person_id) : null;
  return { goalText: g.goal_text, personName: person ? person.name : null };
}

// Read-only §6 suppression check that can never throw the brief off the rails.
async function safeSuppression(read, userId) {
  try { return !!(await read(userId)); } catch { return false; }
}
