// ─────────────────────────────────────────────────────────────────────────────
// ENTITY RESOLUTION — the ONE place that decides, per mention, whether it maps to
// an EXISTING person (merge) or a NEW person (create).
//
// Phase 1 of docs/ENTITY_RESOLUTION_V2.md: the confidence bands that stop the
// wrong-person merge. PURE + DEPENDENCY-FREE (like safetyDetection.js /
// voiceGuard.js): every input is passed in (the model's parsed mention, the raw
// message body, and the user's people list). No DB, no clock, no model. The
// pipeline step (06_resolveEntities.js) loads the roster and executes the
// create/merge; this module only DECIDES. Same inputs → same verdict.
//
// THE FIX: a bare substring match NEVER auto-merges. Auto-merge fires only on an
// exact name / registered alias / curated nickname, and only when there is exactly
// one such candidate and no "new-person" phrasing cue. A mention with a new-person
// cue ("met a guy named Lucas") is always a NEW person, even when an existing name
// is a substring of it. The genuinely-ambiguous case DEFAULTS TO CREATE here (never
// a guessed merge onto an existing record); the ask-first clarification loop that
// would instead HOLD the write and ask is Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

// Curated nickname equivalences (bidirectional groups). This is the "Mike/Michael"
// intent the old substring backstop actually wanted — a real name equivalence, not
// a spelling overlap. Conservative on purpose: only well-known pairs.
const NICKNAME_GROUPS = [
  ['mike', 'michael', 'mick', 'mikey'],
  ['alex', 'alexander', 'alexandra', 'alexa', 'lex'],
  ['nick', 'nicholas', 'nicolas'],
  ['chris', 'christopher', 'christine', 'christina', 'kris'],
  ['matt', 'matthew'],
  ['tom', 'thomas', 'tommy'],
  ['dave', 'david', 'davey'],
  ['dan', 'daniel', 'danny'],
  ['jon', 'john', 'jonathan', 'johnny', 'jonny'],
  ['will', 'william', 'bill', 'billy'],
  ['rob', 'robert', 'bob', 'bobby', 'robbie'],
  ['jim', 'james', 'jimmy', 'jamie'],
  ['joe', 'joseph', 'joey'],
  ['kate', 'katherine', 'kathryn', 'katie', 'kathy', 'catherine'],
  ['liz', 'elizabeth', 'beth', 'eliza', 'lizzie', 'betsy'],
  ['sam', 'samuel', 'samantha', 'sammy'],
  ['ben', 'benjamin', 'benny'],
  ['andy', 'andrew', 'drew'],
  ['tony', 'anthony'],
  ['steve', 'stephen', 'steven'],
  ['ed', 'edward', 'eddie', 'ted'],
  ['pat', 'patrick', 'patricia', 'patty'],
];

// name -> canonical group key (its group's first element)
const NICKNAME_CANON = (() => {
  const m = {};
  for (const g of NICKNAME_GROUPS) for (const n of g) m[n] = g[0];
  return m;
})();

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
// First token only, for nickname / first-name comparisons ("Luca Nannini" -> "luca").
function firstToken(s) {
  return normName(s).split(' ')[0] || '';
}

// ── New-person phrasing cues. When present, the mention is a NEW person even if an
// existing name is a substring / near-match — a strong signal the user is
// INTRODUCING someone, not referring back. Deterministic, case-insensitive.
const NEW_PERSON_CUES = [
  /\bmet\s+(?:a|an|this|some|my)\b/i,             // "met a guy named", "met this girl"
  /\b(?:a|some|this)\s+(?:guy|girl|man|woman|kid|person|friend|coworker|colleague|neighbou?r|classmate)\s+(?:named|called)\b/i,
  /\b(?:someone|somebody)\s+(?:named|called)\b/i, // "someone named X"
  /\ba\s+new\s+\w+/i,                             // "a new coworker", "a new friend"
  /\bnamed\s+\w+/i,                               // "...named Lucas..."
  /\bgoes\s+by\b/i,
  /\bthis\s+(?:guy|girl|woman|man|kid)\b/i,       // "this guy at the gym"
  /\bat\s+(?:a|an|the|my|work)\b[^.]*\b(?:event|party|conference|meetup|wedding|gym|class|bar|office)\b/i,
];

export function hasNewPersonCue(text) {
  return NEW_PERSON_CUES.some((re) => re.test(String(text || '')));
}

// ── Classify how a mention name matches the user's existing people. Returns the
// STRONGEST match kind and its candidate ids (>1 => ambiguous at that kind).
// `people` = [{ id, name, aliases }] (people.listForUser shape).
export function classifyMatch(name, people = []) {
  const target = normName(name);
  if (!target) return { kind: 'none', personId: null, candidates: [] };
  const targetFirst = firstToken(name);
  const targetCanon = NICKNAME_CANON[targetFirst] || null;

  const exactName = [], exactAlias = [], nick = [], substr = [];
  for (const p of people || []) {
    const pName = normName(p.name);
    if (!pName) continue;
    if (pName === target) { exactName.push(p.id); continue; }
    const aliases = (p.aliases || []).map(normName).filter(Boolean);
    if (aliases.includes(target)) { exactAlias.push(p.id); continue; }

    const pFirst = firstToken(p.name);
    if (targetCanon && NICKNAME_CANON[pFirst] === targetCanon && pFirst !== targetFirst) {
      nick.push(p.id); continue;
    }
    // bare substring (>=3 chars, one name contains the other) — NEVER auto-merges
    if (target.length >= 3 && pName.length >= 3
        && (pName.includes(target) || target.includes(pName))) {
      substr.push(p.id);
    }
  }

  if (exactName.length) return { kind: 'exact_name', personId: exactName[0], candidates: exactName };
  if (exactAlias.length) return { kind: 'exact_alias', personId: exactAlias[0], candidates: exactAlias };
  if (nick.length) return { kind: 'nickname', personId: nick[0], candidates: nick };
  if (substr.length) return { kind: 'partial_substring', personId: substr[0], candidates: substr };
  return { kind: 'none', personId: null, candidates: [] };
}

// ── NEAR-MATCH (docs/ENTITY_RESOLUTION_V2.md §1.5) — the Phase-2 ASK trigger.
// A mention name that is CLOSE to an existing FIRST name but not exact:
//   Levenshtein ≤ 2  AND  min(len) ≥ 3  AND  a shared 2-letter prefix.
// Tuned to catch the Luca/Luka/Lucas/Luc family and to STAY SILENT on genuinely
// different short names (Jon/Jan, Dan/Don, Sam/Pam). Exact-equal is the exact_name
// band (silent merge), so it is excluded here. PURE — same inputs, same result.
const NEAR_MAX_DISTANCE = 2;
const NEAR_MIN_LEN = 3;
const NEAR_MIN_PREFIX = 2;
const NEAR_CANDIDATE_CAP = 3;

// Levenshtein edit distance, short-circuited once it provably exceeds `max`
// (first names are short, so the DP is tiny).
export function levenshtein(a, b, max = NEAR_MAX_DISTANCE) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already over budget
    prev = cur;
  }
  return prev[lb];
}

function sharedPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// Is normalized first-name `m` a NEAR-MATCH of normalized first-name `e`? Never true
// for equal strings (that is the exact band) or names shorter than the min length.
export function isNearMatch(m, e) {
  if (!m || !e || m === e) return false;
  if (Math.min(m.length, e.length) < NEAR_MIN_LEN) return false;
  if (sharedPrefixLen(m, e) < NEAR_MIN_PREFIX) return false;
  const d = levenshtein(m, e, NEAR_MAX_DISTANCE);
  return d >= 1 && d <= NEAR_MAX_DISTANCE;
}

function candidateView(p, distance) {
  return {
    id: p.id,
    name: p.name,
    relationship: p.relationship || null,
    last_contact_at: p.last_contact_at || null,
    distance,
  };
}

// Order per §1.5: edit distance asc, then interaction salience (last_contact_at
// desc), then name asc; dedup by id (keep the closest); cap at 3.
export function orderAndCapCandidates(cands) {
  const byId = new Map();
  for (const c of cands || []) {
    if (!c || !c.id) continue;
    const prev = byId.get(c.id);
    if (!prev || c.distance < prev.distance) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const sa = a.last_contact_at || '', sb = b.last_contact_at || '';
    if (sa !== sb) return sa < sb ? 1 : -1;          // more recent first
    return normName(a.name) < normName(b.name) ? -1 : 1;
  }).slice(0, NEAR_CANDIDATE_CAP);
}

// Owned, non-self existing people whose FIRST name near-matches `name` (§1.5).
export function findNearMatches(name, people = []) {
  const mFirst = firstToken(name);
  if (!mFirst) return [];
  const out = [];
  for (const p of people || []) {
    if (p.is_self) continue;
    const eFirst = firstToken(p.name);
    if (!eFirst || eFirst === mFirst) continue;      // exact-equal → exact_name band
    if (isNearMatch(mFirst, eFirst)) out.push(candidateView(p, levenshtein(mFirst, eFirst, NEAR_MAX_DISTANCE)));
  }
  return orderAndCapCandidates(out);
}

const MERGEABLE_KINDS = new Set(['exact_name', 'exact_alias', 'nickname']);
const CONFIDENCE_FLOOR = 0.70;

// ── decideResolution — the ONE decision. Returns one of:
//   { action: 'existing', personId, band, reason }   ← merge into an existing person
//   { action: 'new',                band, reason }    ← create a new person
//
// Phase 1: the AMBIGUOUS band DEFAULTS TO CREATE (never a guessed merge). The
// ask-first loop that would HOLD the write and ask is Phase 2.
//   mention = the model's people[] entry (resolution, person_id, candidate_ids,
//             proposed_name, mention_text, confidence)
//   body    = the raw inbound message text (for new-person cue detection)
//   people  = the user's existing people (listForUser shape)
// Phase 2a adds a third action, 'ask' — HOLD the write and clarify — for the
// genuinely-ambiguous cases §1 used to default-create. A verdict is one of:
//   { action: 'existing', personId, band, reason }
//   { action: 'new',                band, reason }
//   { action: 'ask', askKind, newName, candidates:[{id,name,relationship,...}], band, reason }
// A merge is still AUTOMATIC only on exact name / registered alias / curated
// nickname with exactly one candidate; a new-person cue still forces CREATE.
export function decideResolution({ mention = {}, body = '', people = [] } = {}) {
  const roster = people || [];
  const ownedIds = new Set(roster.map((p) => p.id));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const confidence = typeof mention.confidence === 'number' ? mention.confidence : 1;
  const name = mention.proposed_name || mention.mention_text || '';

  // 1) Model resolved to an OWNED existing/self person, confidently. Trust it as a
  //    SILENT merge only when the mention actually NAMES that person — an exact name,
  //    a registered alias, or a curated nickname. If the mention is merely a near-miss
  //    SPELLING of the resolved person ("Luka" vs "Luca") and other near-matches exist,
  //    a confident model verdict is exactly the typo-merge Phase 2a must catch — so we
  //    ASK instead, listing the model's pick alongside the other near candidates. The
  //    confidence floor is deliberately NOT the lever (0.90 is genuinely high): the lever
  //    is "near-miss spelling ⇒ ask regardless of model confidence" (diagnosis 2026-07-24).
  //    A confident existing whose name is unrelated (resolved by context/relationship,
  //    no near sibling) is not a typo-merge and is still trusted.
  if ((mention.resolution === 'existing' || mention.resolution === 'self')
      && mention.person_id && ownedIds.has(mention.person_id)
      && confidence >= CONFIDENCE_FLOOR) {
    const resolvedPerson = byId.get(mention.person_id);
    const namesResolvedPerson = MERGEABLE_KINDS.has(classifyMatch(name, [resolvedPerson]).kind);
    if (namesResolvedPerson) {
      return { action: 'existing', personId: mention.person_id, band: 'confident_existing', reason: 'model_existing_owned' };
    }
    const nearToModelPick = findNearMatches(name, roster);
    if (nearToModelPick.length >= 1) {
      const candidates = orderAndCapCandidates([
        candidateView(resolvedPerson, levenshtein(firstToken(name), firstToken(resolvedPerson.name), NEAR_MAX_DISTANCE)),
        ...nearToModelPick,
      ]);
      return { action: 'ask', askKind: 'near_match', newName: name, candidates, band: 'ask_near_match', reason: 'near_miss_over_model_existing' };
    }
    return { action: 'existing', personId: mention.person_id, band: 'confident_existing', reason: 'model_existing_owned' };
  }

  // 2) A new-person phrasing cue → confident CREATE. Outranks any near/weak overlap
  //    with an existing name (the Lucas fix); never an ask, never a merge.
  const cue = hasNewPersonCue([mention.mention_text, body].filter(Boolean).join(' '));
  if (cue) return { action: 'new', band: 'confident_new', reason: 'new_person_cue' };

  // 3) Exact name / registered alias / curated nickname, exactly ONE → silent merge.
  const match = classifyMatch(name, roster);
  if (MERGEABLE_KINDS.has(match.kind) && match.candidates.length === 1) {
    return { action: 'existing', personId: match.personId, band: 'confident_existing', reason: 'exact_or_nickname_single' };
  }

  // 4) The same name/alias/nickname is shared by 2+ owned people → ASK which
  //    (bare-name disambiguation, §2.4) before attaching anything.
  if (MERGEABLE_KINDS.has(match.kind) && match.candidates.length >= 2) {
    const candidates = orderAndCapCandidates(
      match.candidates.map((id) => byId.get(id)).filter(Boolean).map((p) => candidateView(p, 0)),
    );
    return { action: 'ask', askKind: 'bare_name', newName: name, candidates, band: 'ask_bare_name', reason: 'bare_name_multiple' };
  }

  // 5) A NEAR-MATCH (§1.5) and/or a model-flagged ambiguity over owned people → ASK.
  const near = findNearMatches(name, roster);
  const modelAmb = mention.resolution === 'ambiguous'
    ? (mention.candidate_ids || []).filter((id) => ownedIds.has(id)).map((id) => byId.get(id)).filter(Boolean).map((p) => candidateView(p, 0))
    : [];
  const candidates = orderAndCapCandidates([...near, ...modelAmb]);
  if (candidates.length >= 1) {
    return { action: 'ask', askKind: 'near_match', newName: name, candidates, band: 'ask_near_match', reason: near.length ? 'near_match' : 'model_ambiguous' };
  }

  // 6) No match at all → confident create.
  return { action: 'new', band: 'confident_new', reason: 'no_match_create' };
}

// ── Deterministic interpretation of a reply to a clarification (§2.4). Model-first
// with a deterministic backstop is the doc's design; Phase 2a ships the backstop
// (the model `clarification_answer` field is a documented follow-up). PURE.
//   clarification = { candidates:[{id,name,relationship,last_initial?}], proposed_name }
//   → { decision: 'same'|'different'|'unclear', personId? }
export function interpretClarificationReply(body, clarification = {}) {
  const t = normName(body);
  if (!t) return { decision: 'unclear' };
  const cands = clarification.candidates || [];

  // Explicit "new / different / someone else / no" → create a new person.
  if (/\b(new|different|someone\s+else|somebody\s+else|another\s+one|neither|not\s+(?:her|him|them|the\s+same))\b/.test(t)
      || /^(no|nope|nah)\b/.test(t)) {
    return { decision: 'different' };
  }

  // Match a specific candidate by first/full name, last-initial letter, relationship
  // word, or an ordinal. Exactly one hit resolves to 'same'.
  const hits = [];
  for (const c of cands) {
    const cFirst = firstToken(c.name);
    const cName = normName(c.name);
    let hit = false;
    if (cName && (t === cName || t.split(/\s+/).includes(cFirst) || t.includes(cName))) hit = true;
    const li = normName(c.last_initial).replace(/[.]/g, '');
    if (li && new RegExp('(^|\\s)' + li + '(\\.|\\b)').test(t)) hit = true;
    const rel = normName(c.relationship);
    if (rel && rel.length >= 3 && t.includes(rel)) hit = true;
    if (hit) hits.push(c);
  }
  if (hits.length === 1) return { decision: 'same', personId: hits[0].id };

  const ord = ordinalIndex(t);
  if (ord != null && ord >= 0 && ord < cands.length) return { decision: 'same', personId: cands[ord].id };

  // Bare affirmation with a single candidate ("yes / same / that's him").
  if (cands.length === 1 && /\b(yes|yeah|yep|same|correct|right|the\s+same)\b/.test(t)) {
    return { decision: 'same', personId: cands[0].id };
  }
  if (cands.length === 1 && /that'?s\s+(?:him|her|them)/.test(t)) {
    return { decision: 'same', personId: cands[0].id };
  }

  return { decision: 'unclear' };
}

function ordinalIndex(t) {
  if (/\b(first|1st|number\s*one)\b/.test(t) || /^1\b/.test(t)) return 0;
  if (/\b(second|2nd|number\s*two)\b/.test(t) || /^2\b/.test(t)) return 1;
  if (/\b(third|3rd|number\s*three)\b/.test(t) || /^3\b/.test(t)) return 2;
  return null;
}
