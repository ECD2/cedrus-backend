// ─────────────────────────────────────────────────────────────────────────────
// IMPORT SCOPE (NF2-IMPORT) — the six-theme discipline, in code.
//
// cedrus-parser-discipline.md §5: "chat import extracts only the six closed
// themes and omits everything else entirely (medical, financial, legal, work
// content, passwords, dating logistics — never stored, summarized, or hinted
// at)." The six themes (cedrus_growth_spec.md §3):
//
//   1. people & relationships     4. dates (birthdays, anniversaries)
//   2. recurring commitments      5. travel patterns
//   3. preferences                6. health/fitness ROUTINES (never medical)
//
// The extraction prompt is shared with SMS and knows nothing about this
// boundary — so the model proposes and THIS FILE disposes, allow-list first
// (discipline §13: validate with "allow known-good", never "reject known-
// bad"). Order per fact: secrets → hard drop; out-of-scope → hard drop;
// allow-list → theme; anything unmatched → drop. Deny by default.
//
// Pure functions only: no I/O, no clients, fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

// ── Secrets (discipline §5 layer 1) — an import fact is never worth a secret ─
const SECRET_PATTERNS = [
  /\b(password|passcode|passwd|pwd|pin)\b\s*(is|was|[:=])/i,
  /\b(otp|one[- ]time|verification|auth(?:entication)?)\s*(code|pin)\b/i,
  /\bcode\s*[:=]?\s*\d{4,8}\b/i,
  /\brouting\s*(number|no\.?|#)?\s*[:=]?\s*\d{9}\b/i,
  /\baccount\s*(number|no\.?|#)\s*[:=]?\s*\d{6,}\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,                  // SSN shape
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_ -]?key|secret[_ -]?key|bearer)\b\s*[:=]/i,
];

// Luhn-valid 13–19 digit runs (card numbers), tolerant of space/dash groups.
export function hasLuhnRun(text) {
  const runs = String(text).match(/(?:\d[ -]?){13,19}/g) || [];
  for (const run of runs) {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export function containsSecret(text) {
  const t = String(text || '');
  if (!t) return false;
  return SECRET_PATTERNS.some((re) => re.test(t)) || hasLuhnRun(t);
}

// ── Out-of-scope themes (hard deny, checked before the allow-list) ──────────
// Health ROUTINES are in scope; clinical/medical content is not — the deny
// list targets clinical vocabulary, which routine facts ("runs every
// morning") never contain.
const OUT_OF_SCOPE_PATTERNS = [
  // medical / clinical
  /\b(diagnos\w*|cancer|chemo\w*|tumor|biopsy|prescri\w*|medication|antidepress\w*|dosage|milligrams?|\d+\s?mg\b|symptom\w*|surgery|therapist|therapy|psychiatr\w*|std\b|hiv\b|depression|anxiety|adhd|autis\w*|disorder|illness|blood (test|pressure|work)|er visit|hospital\w*)\b/i,
  // financial
  /\b(salary|paycheck|net worth|bank(?:ing)? (account|balance)|mortgage|loan|debt|credit (score|card)|invest\w*|stocks?\b|crypto\w*|bitcoin|401k|ira\b|tax(es| return)|venmo|paypal|wire transfer)\b/i,
  // legal
  /\b(lawsuit|attorney|lawyer|court (date|case)|legal (case|trouble|advice)|arrest\w*|criminal|probation|settlement|custody|immigration|visa (status|application)|deport\w*)\b/i,
  // work content (the material of work — a person's job title/employer stays in scope)
  /\b(deadline|sprint|standup|okr\b|kpi\b|quarterly (report|review)|slide deck|pull request|code review|codebase|perf(ormance)? review|my (boss|manager) (said|wants|asked)|layoffs? at)\b/i,
  // dating logistics
  /\b(tinder|hinge|bumble|okcupid|grindr|matched with|swiped (right|left)|hook(ed)? up|situationship|dating app)\b/i,
];

export function isOutOfScope(text) {
  const t = String(text || '');
  return OUT_OF_SCOPE_PATTERNS.some((re) => re.test(t));
}

// ── The allow-list: fact → theme (or null = dropped) ────────────────────────
const RELATIONSHIP_KEYS = new Set([
  'relationship', 'family', 'kids', 'children', 'partner', 'friends',
  'pets', 'pet', 'city', 'hometown', 'job', 'school',
]);
const DATE_KEYS = new Set(['birthday', 'birthdate', 'anniversary', 'wedding_date']);
const PREFERENCE_KEYS = new Set([
  'food', 'drink', 'coffee', 'music', 'movies', 'films', 'books', 'games',
  'team', 'teams', 'sports_team', 'sport', 'sports', 'hobby', 'hobbies',
  'brand', 'brands', 'style', 'size', 'sizes', 'clothing_size', 'shoe_size',
  'gifts', 'gift_ideas', 'color', 'art', 'interests', 'restaurants',
]);
const TRAVEL_KEYS = new Set(['travel', 'trip', 'trips', 'vacation', 'destination', 'destinations']);
const FITNESS_KEYS = new Set(['fitness', 'gym', 'workout', 'workouts', 'running', 'yoga', 'exercise', 'sport_activity']);
const COMMITMENT_KEYS = new Set(['routine', 'routines', 'schedule', 'commitment', 'commitments', 'tradition', 'traditions']);

const DATE_VALUE = /\b(birthday|anniversary)\b/i;
const TRAVEL_VALUE = /\b(travels? to|trip to|visit(s|ing)? |flies to|vacation(s|ed)? (in|to)|been to)\b/i;
const FITNESS_VALUE = /\b(runs?|running|gym|yoga|lifts?|lifting|trains?|training|marathon|pilates|hikes?|hiking|swims?|cycling|climbs?|climbing)\b/i;
const RECURRING_VALUE = /\b(every (day|week|month|morning|evening|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|weekly|monthly|each (week|month)|(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s\b)/i;
const LIFE_EVENT_VALUE = /\b(engaged|married|wedding|divorced|baby|born|moved to|graduat\w*|retire\w*|new job|anniversary)\b/i;

const norm = (k) => String(k || '').trim().toLowerCase().replace(/\s+/g, '_');

// classifyFactTheme({fact_type, fact_key, fact_value}) → theme string | null.
// null means the fact is OUT — never stored, never echoed, never counted in
// any user-visible way beyond an aggregate "dropped" number.
export function classifyFactTheme(fact) {
  const type = String((fact && fact.fact_type) || '');
  const key = norm(fact && fact.fact_key);
  const value = String((fact && fact.fact_value) || '');
  const both = `${key.replace(/_/g, ' ')} ${value}`;

  // Hard drops first: secrets, then out-of-scope vocabulary anywhere.
  if (containsSecret(both)) return null;
  if (isOutOfScope(both)) return null;

  // Key allow-lists next: a strong key places the fact regardless of the
  // fact_type the model happened to pick (a birthday typed 'note' is still a
  // date — the key is the more deliberate signal).
  if (DATE_KEYS.has(key)) return 'dates';
  if (RELATIONSHIP_KEYS.has(key)) return 'relationships';
  if (TRAVEL_KEYS.has(key)) return 'travel';
  if (FITNESS_KEYS.has(key)) return 'health_fitness';
  if (COMMITMENT_KEYS.has(key)) return 'commitments';
  if (PREFERENCE_KEYS.has(key)) return 'preferences';

  // Historical moods are noise, not memory; goals/notes/context from
  // years-old logs aren't one of the six themes. Only enduring person-facts
  // survive past this point.
  if (type === 'mood' || type === 'goal' || type === 'note' || type === 'context') return null;

  if (type === 'relationship_detail') return 'relationships';
  if (DATE_VALUE.test(both)) return 'dates';
  if (TRAVEL_VALUE.test(value)) return 'travel';
  if (FITNESS_VALUE.test(value) && RECURRING_VALUE.test(value)) return 'health_fitness';
  if (RECURRING_VALUE.test(value)) return 'commitments';
  if (type === 'preference' || type === 'interest') return 'preferences';
  if (type === 'life_event' && LIFE_EVENT_VALUE.test(value)) return 'relationships';

  return null; // deny by default — unmatched means unstored
}

// ── Relevance scorer for the pre-filter (technical design §3.2 step 3) ──────
// Pure heuristic, tuned for recall on the six themes. Messages scoring below
// MIN_SCORE never reach the model; the budget then keeps top scorers.
export const MIN_SCORE = 2;

const REL_WORDS = /\b(my|our) (mom|mother|dad|father|wife|husband|girlfriend|boyfriend|partner|fianc\w*|brother|sister|son|daughter|grandma|grandmother|grandpa|grandfather|aunt|uncle|cousin|niece|nephew|best friend|friend|buddy|roommate|coworker|colleague|neighbor|in[- ]laws?)\b/i;
const NAME_SHAPE = /(?:^|[\s,.!?])(?!I\b)[A-Z][a-z]{2,}\b/g;
const PREFERENCE_WORDS = /\b(loves?|likes?|favorite|favourite|obsessed with|really into|is into|enjoys?|can't stand|hates?|allergic to)\b/i;
const DATE_WORDS = /\b(birthday|anniversary|turns \d{1,2}\b|born on)\b/i;
const TRAVEL_WORDS = /\b(trip|travel\w*|vacation|flight|visiting|flying to)\b/i;
const FITNESS_WORDS = /\b(gym|marathon|yoga|workout|training for|runs)\b/i;
const SIZE_GIFT_WORDS = /\b(size|gift|present for)\b/i;
const CODE_BLOCK = /```|\bfunction\s*\(|=>\s*{|<\/[a-z]+>/;

export function scoreMessage(text) {
  const t = String(text || '');
  if (!t.trim()) return 0;
  let score = 0;
  if (REL_WORDS.test(t)) score += 3;
  if (PREFERENCE_WORDS.test(t)) score += 2;
  if (DATE_WORDS.test(t)) score += 3;
  if (TRAVEL_WORDS.test(t)) score += 1;
  if (FITNESS_WORDS.test(t)) score += 1;
  if (SIZE_GIFT_WORDS.test(t)) score += 1;
  if (RECURRING_VALUE.test(t)) score += 1;
  const names = (t.match(NAME_SHAPE) || []).length;
  score += Math.min(2, names);
  // Penalties: things chat logs are full of that memory never wants.
  if (CODE_BLOCK.test(t)) score -= 4;
  if (t.length > 2500) score -= 1;
  if (isOutOfScope(t)) score -= 3;
  if (containsSecret(t)) score = -100; // a secret disqualifies the whole message
  return score;
}
