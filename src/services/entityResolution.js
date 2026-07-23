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
export function decideResolution({ mention = {}, body = '', people = [] } = {}) {
  const roster = people || [];
  const ownedIds = new Set(roster.map((p) => p.id));
  const confidence = typeof mention.confidence === 'number' ? mention.confidence : 1;

  // 1) The model resolved to an existing/self person BY ID. Honor it only if the id
  //    is OWNED (cross-tenant guard, WS-A) and confidence clears the floor.
  if ((mention.resolution === 'existing' || mention.resolution === 'self')
      && mention.person_id && ownedIds.has(mention.person_id)
      && confidence >= CONFIDENCE_FLOOR) {
    return { action: 'existing', personId: mention.person_id, band: 'confident_existing', reason: 'model_existing_owned' };
  }

  // 2) Genuinely ambiguous (model surfaced candidates) → Phase 1 default: CREATE.
  //    Never a guessed merge onto an existing record. (Phase 2 asks instead.)
  if (mention.resolution === 'ambiguous') {
    return { action: 'new', band: 'ambiguous_defaulted_new', reason: 'ambiguous_default_create_phase1' };
  }

  // 3) Resolve by name. A new-person phrasing cue forces CREATE regardless of any
  //    substring / near overlap with an existing name (the Lucas fix).
  const name = mention.proposed_name || mention.mention_text || '';
  const cue = hasNewPersonCue([mention.mention_text, body].filter(Boolean).join(' '));
  if (cue) {
    return { action: 'new', band: 'confident_new', reason: 'new_person_cue' };
  }

  // Auto-merge ONLY on exact name / exact alias / curated nickname, and only when
  // there is exactly ONE such candidate. A bare substring NEVER merges.
  const match = classifyMatch(name, roster);
  if (MERGEABLE_KINDS.has(match.kind) && match.candidates.length === 1) {
    return { action: 'existing', personId: match.personId, band: 'confident_existing', reason: 'exact_or_nickname_single' };
  }

  // Everything else — substring-only, multiple same-name ties, or no match at all —
  // DEFAULTS TO CREATE in Phase 1 (these are the cases Phase 2's ask-loop handles).
  return {
    action: 'new',
    band: match.kind === 'none' ? 'confident_new' : 'ambiguous_defaulted_new',
    reason: match.kind === 'none' ? 'no_match_create' : 'weak_match_default_create',
  };
}
