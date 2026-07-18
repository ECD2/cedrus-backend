// ─────────────────────────────────────────────────────────────────────────────
// Cedrus Priority 0 — Safety & Crisis Detection
// Implements CEDRUS_SAFETY_AND_CRISIS_ESCALATION_SPEC.md.
//
// This module is DELIBERATELY DEPENDENCY-FREE and PURE. It imports nothing with
// side effects, does no I/O, and never calls a model. That is the single most
// important property here (spec §10): the crisis response must be immune to
// prompt injection, jailbreaking, or an off-distribution message reaching a
// person in danger. Detection is deterministic code; responses are fixed,
// versioned constants — never composed by the conversational model at request
// time.
//
// Detection is tuned for HIGH RECALL, not high precision (spec §1). When a
// message is genuinely ambiguous between a crisis category (A/B/D) and ordinary
// substance/relationship content (E), we treat it as the crisis track. A false
// trigger costs a slightly more careful reply; a missed one costs much more.
// ─────────────────────────────────────────────────────────────────────────────

// Versioned so a future review/legal sign-off can bump copy without silent drift
// (spec §2: "small, versioned, reviewed set of response templates"). The 988
// number and the "your local emergency number" fallback are Emil's ENGINEERING
// PLACEHOLDERS pending legal review (spec §8) — do not treat as final user copy.
export const CRISIS_TEMPLATE_VERSION = 'crisis-v1-2026-07-16';

// ── Fixed crisis response templates (spec §2, §3) ────────────────────────────
// Every template below satisfies, structurally:
//   • a concrete resource, never "please seek help" (spec §2.1)
//   • never terminates the conversation ("I'm still here") (spec §2.2)
//   • never claims Cedrus took external action it can't (spec §2.3)
//   • region-aware, never region-assuming: 988 (US) + local-emergency fallback
//     (spec §2.5)
//   • no probing "why", no assessment questions (spec §2.6)
//   • plain, calm, no brand voice / no 🌲 / no cheerfulness (spec §2.7)
export const CRISIS_TEMPLATES = {
  // Category A — self-harm / suicide (own)
  A: `I'm really glad you told me, and I don't want you to be alone with this. I can't be the right support on my own, but people who can are here now. In the US, call or text 988 (Suicide & Crisis Lifeline). Elsewhere, your local emergency number can connect you. If you might be in immediate danger, please contact emergency services now. I'm still here.`,

  // Category B — danger to others
  B: `I want to take what you said seriously. I can't help with harming anyone, but I don't want anyone to get hurt. If someone is in danger right now, please contact your local emergency number (911 in the US). If these thoughts are weighing on you, the 988 line in the US can talk it through with you. I'm still here.`,

  // Category D — substance emergency (active or possible overdose)
  D: `This sounds like it could be an emergency. If someone may have overdosed, call your local emergency number now (911 in the US), stay with them, and don't leave them alone. Put them on their side if they're breathing. If naloxone (Narcan) is on hand, use it. In the US, Poison Control is 1-800-222-1222. I'm still here.`,

  // Category C — third-party crisis (someone ELSE may be in danger).
  // Framed around supporting another person; makes no promise Cedrus will act on
  // or reach the third party, and offers no diagnosis of them (spec §3).
  C: `I'm really glad you're looking out for them. I can't reach or act for someone else, but you don't have to carry it alone. In the US, 988 (call or text) can guide you on supporting someone in crisis. If they might be in immediate danger, your local emergency number can help. I'm here if you want to keep talking.`,
};

// Hard substance-content boundary refusal (spec §4). Fires on ANY request for
// dosing / combination / timing / sourcing guidance, in any framing ("harm
// reduction", "for a friend", "research"). Still offers the two safe doors:
// the emergency path and the supporting-someone path.
export const SUBSTANCE_BOUNDARY_TEMPLATE = `I can't help with how to use, dose, combine, or get substances, however it's framed. If this is an emergency happening right now, tell me what you're seeing and I'll share what to do. And if you're worried about someone's use, I'm here for that too.`;

// ── Category enum ────────────────────────────────────────────────────────────
export const CRISIS_CATEGORIES = {
  A: 'self_harm_self',
  B: 'danger_to_others',
  C: 'third_party_crisis',
  D: 'substance_emergency',
};

// A/B/C/D fire the suppression window (spec §6). The substance-content boundary
// and disordered-eating flag do NOT, on their own, open the promo cooldown —
// they are content boundaries, not crisis events.
const SUPPRESSION_CATEGORIES = new Set(['A', 'B', 'C', 'D']);

// ─────────────────────────────────────────────────────────────────────────────
// Pattern banks. Kept explicit and commented so a reviewer (or counsel) can see
// exactly what fires and why. High recall by design.
// ─────────────────────────────────────────────────────────────────────────────

// Normalize once: lowercase, collapse whitespace, strip most punctuation so
// "k i l l" spacing tricks and "kill!!!" both land on the same phrase check.
// (Injection hardening: this runs on raw user content that is never trusted.)
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Self-harm / suicide (own) — FIRST-PERSON, unambiguous. These fire Category A
// even when a third-party subject is also present (spec §3: if the user also
// indicates their own risk, A applies and outranks the third-party reading).
const SELF_HARM_FIRST_PERSON = [
  /\bkill (?:myself|me)\b/,
  /\bkilling myself\b/,
  /\b(?:end|ending|take|taking) my (?:own )?life\b/,
  /\bi (?:want|wanna|need|have) to die\b/,
  /\bi (?:don'?t|do not) want to (?:live|be alive|be here|wake up)\b/,
  /\bi wish i (?:was|were) dead\b/,
  /\bi'?m going to kill myself\b/,
  /\b(?:hurt|harm|cut|cutting) (?:myself|me)\b/,
  /\bself[- ]harm\b/,
  /\bi (?:can'?t|cannot) go on\b/,
  /\bi'?m done (?:with life|living)\b/,
  // "kill myself" text shorthand — but NOT the kilometres reading. A distance is
  // written as a number immediately before "kms" ("10 kms", "10kms", "5 kms");
  // the suicide shorthand stands alone or after intent words ("kms honestly",
  // "wanna kms"). The two fixed-width lookbehinds reject only the distance form,
  // so "Ran 10 kms this morning" no longer fires self-harm (Finding 2). (§1)
  /(?<!\d)(?<!\d )\bkms\b/,
];

// Self-harm — AMBIGUOUS bare signals: strong crisis words with no explicit
// subject. Read as OWN (Category A) UNLESS a clear third-party subject is present
// in the same message, in which case the third-party track (C) handles it.
const SELF_HARM_AMBIGUOUS = [
  /\bsuicid(?:e|al)\b/,
  /\bbetter off dead\b/,
  /\bwant to end it all\b/,
  /\bend it all\b/,
  /\bunalive\b/, // platform-evasion slang
];

// Self-harm — WEAK / IMPLICIT signals: hopelessness that deployed products miss
// most often (spec §1). These fire the crisis track too — a false trigger is an
// acceptable cost; a missed implicit disclosure is the documented failure.
const SELF_HARM_IMPLICIT = [
  /\bno (?:reason|point) (?:to|in) (?:living|live|being here|be here|going on|go on|continue|carry on)\b/,
  /\bwhat'?s the point of (?:living|anything|going on|it all)\b/,
  /\beveryone(?:'?s| is| would be)? better off without me\b/,
  /\bwould be better off without me\b/,
  /\bnobody would (?:miss|notice) me\b/,
  /\bi don'?t (?:see|have) a (?:reason|future)\b/,
  /\bi (?:just )?want (?:it|the pain|everything) to (?:stop|end)\b/,
  /\bi (?:can'?t|cannot) do this anymore\b.*\b(?:live|living|life|myself|alive|breathing|exist)\b/,
  /\btired of (?:living|being alive|it all)\b/,
  /\bi'?m done (?:with life|living)\b/,
  /\bcan'?t take it anymore\b.*\b(?:die|end|myself|alive|living)\b/,
  // Stockpiling medication — a documented preparatory warning sign (Finding 1
  // probe: "I've been saving up my pills"). Scoped to the collect/stockpile verbs
  // plus a medication noun, so "picking up my pills from the pharmacy" is inert.
  /\b(?:saving|saved|stockpil(?:e|ed|ing)|hoard(?:ed|ing)?|collecting|been (?:saving|collecting|hoarding))\b[^.?!]{0,15}\b(?:pills?|meds?|medication|medications|painkillers?|pain killers|sleeping pills|tablets?)\b/,
  // "go to sleep and not wake up" family (Finding 1 probe): a wish not to wake,
  // phrased around sleep rather than the "I don't want to wake up" the bank
  // already had.
  /\b(?:go to sleep|fall asleep|sleep|lie down)\b[^.?!]{0,15}\b(?:and|then)\b[^.?!]{0,10}\b(?:not|never) (?:wake up|wake back up|come back|be here)\b/,
  /\bwish i (?:could|would) (?:just )?(?:not wake up|never wake up|not wake back up)\b/,
];

// Danger to others (B). Context-aware, NOT a bare verb+object word list — that
// is the Finding 2 fix. Sports/competition traffic ("we beat them in the
// finals", "the Lakers beat the Celtics", "crush/destroy them") is core traffic
// for this product and must never fire this category. So:
//   • the bare list holds ONLY unambiguous-violence verbs (no "beat/hurt/harm/
//     attack" — those are ambiguous with sports and need an intent frame or a
//     violent complement);
//   • "beat" fires only with a violent complement ("beat him up", "beat the
//     hell out of"), never bare "beat them";
//   • ambiguous verbs (hurt/attack/…) fire only under an explicit "I'm going
//     to / I want to" intent frame.
// Person-noun target set. The bare possessive wildcard (`my \w+`, `his \w+`, …)
// used to accept ANY noun as the object of a violence verb, so ordinary idioms
// — "kill my vibe", "kill my phone", "kill my plants", "kill my buzz", "kill my
// momentum", "kill my afternoon" — all fired Category B. Scoping the my/his/her/
// their complement to an explicit PERSON noun closes that false-positive class.
// This is the SAME technique the third-party "cutting" pattern (THIRD_PARTY_CRISIS)
// uses on its subject: a real person relation, not an open `\w+`. An OPTIONAL
// closed-set kinship/relationship modifier keeps recall on "my little brother",
// "my ex boyfriend", "my step dad", "my best friend"; a trailing `s?` covers
// plurals. Objects match no person noun, so they no longer fire. High recall on
// the target side is deliberate (spec §1) — the list is broad (family, partners,
// exes, and roles like boss/neighbor/coworker) so a real threat still lands.
const PERSON_NOUN =
  '(?:(?:little|lil|big|baby|older|oldest|younger|youngest|half|step|ex|best|twin|teenage|adult|grown|estranged|former|new|current|dear|old|only|whole)\\s+)?' +
  '(?:person|people|man|men|woman|women|guy|girl|boy|kid|child|children|' +
  'daughter|son|sister|brother|sibling|mom|mother|mum|mommy|momma|dad|father|daddy|papa|' +
  'parent|wife|husband|spouse|partner|fiance|fiancee|girlfriend|boyfriend|gf|bf|ex|' +
  'grandma|grandpa|grandmother|grandfather|grandkid|grandchild|grandchildren|' +
  'aunt|uncle|cousin|niece|nephew|inlaw|stepmom|stepdad|stepson|stepdaughter|stepbrother|stepsister|' +
  'bestie|buddy|pal|friend|roommate|neighbor|neighbour|' +
  'boss|manager|supervisor|coworker|colleague|employee|landlord|tenant|teacher|professor|coach|' +
  'classmate|student|doctor|therapist|nurse|client|customer|family|folks)s?';
const OWNED_PERSON = '(?:my|his|her|their) ' + PERSON_NOUN;

const DANGER_OTHERS = [
  new RegExp('\\b(?:kill|murder|stab|strangle|shank|slit) (?:him|her|them|someone|somebody|people|everybody|everyone|' + OWNED_PERSON + ')\\b'),
  // Explicit stated intent — the frame disambiguates a threat from a score line.
  new RegExp('\\bi(?:\'?m going to| will|\'?ll| wanna| want to| am going to| plan to| really want to| swear i\'?ll)\\b[^.?!]{0,14}\\b(?:kill|murder|hurt|harm|attack|stab|shoot|strangle|choke)\\b[^.?!]{0,14}\\b(?:him|her|them|someone|somebody|people|everyone|everybody|you|' + OWNED_PERSON + ')\\b'),
  // "beat" only with a violent complement — never bare "beat them" (sports).
  new RegExp('\\bbeat(?:ing)? (?:him|her|them|the \\w+|' + OWNED_PERSON + ') (?:up|to death|senseless|bloody|half to death|to a pulp)\\b'),
  /\bbeat the (?:crap|shit|hell|life|living \w+) out of\b/,
  /\bmake (?:him|her|them|everyone|everybody) (?:pay|suffer|hurt|regret it)\b/,
  /\bi (?:want|wanna|need) to (?:hurt|harm|kill) (?:someone|somebody|people|him|her|them)\b/,
  /\bthoughts of (?:hurting|killing|harming|attacking) (?:someone|somebody|others|people|him|her|them)\b/,
  /\bshoot up (?:the|my|a|his|her|their)\b/,
  // Weapon acquired AND knowledge of the target's whereabouts — an implicit but
  // serious danger-to-others constellation (Finding 1 probe: "I bought a gun and
  // I know where she lives").
  /\bi (?:bought|got|have|own|just bought|picked up|am getting|just got) (?:a |my |the |another )?(?:gun|firearm|pistol|rifle|shotgun|weapon|knife|ammo|ammunition|bullets?)\b[^.?!]*\bknow where (?:he|she|they|\w+) (?:lives?|works?|sleeps?|is|'?ll be|will be|hangs? out|goes)\b/,
];

// Third-party crisis (C): someone ELSE may be in danger. Third-person subject.
const THIRD_PARTY_CRISIS = [
  /\b(?:he|she|they|my \w+|his \w+|her \w+|their \w+|\w+) (?:wants?|is trying|threatened|talked about|said (?:he|she|they)(?:'?s| is| wants?)?) (?:to )?(?:die|kill (?:himself|herself|themselves|themself)|end (?:it|his life|her life|their life|things))/,
  /\b(?:is|seems|sounds|might be|may be) suicidal\b/,
  /\bworried (?:that )?(?:he|she|they|my \w+|\w+) (?:might|may|could|will) (?:hurt|harm|kill) (?:himself|herself|themselves|themself)\b/,
  /\b(?:he|she|they|my \w+|\w+) (?:might|may|could|is going to) (?:hurt|harm|kill) (?:himself|herself|themselves|themself)\b/,
  /\b(?:he|she|they|my \w+|his \w+|her \w+|their \w+) (?:doesn'?t|don'?t) want to (?:live|be here|be alive)\b/,
  /\b(?:he|she|they|my \w+) (?:talked|talking) about (?:ending|killing|suicide|not being here)\b/,
  // A discovered goodbye/suicide note about someone else (Finding 1 probe:
  // "found a note in my son's room about wanting to die"). "found/saw/read" +
  // note/letter + a death-wish phrase; the discovery verb keeps it third-party,
  // and no first-person self-harm pattern matches "wanting to die" so precedence
  // still lands this on C, not A.
  /\b(?:found|saw|read|discovered)\b[^.?!]{0,40}\b(?:note|letter|message|journal|diary)\b[^.?!]{0,40}\b(?:want(?:ing|ed)? to die|kill(?:ing)? (?:himself|herself|themselves|themself)|end(?:ing)? (?:it|his life|her life|their life)|suicid|not (?:want|wanting) to (?:live|be here|be alive))\b/,
  // A third party self-harming ("my daughter has been cutting again"). Scoped
  // hard so the mundane senses of "cutting" (carbs, class, hair, coupons) and the
  // layoff sense ("my company is cutting again") do not fire: the subject must be
  // an explicit PERSON relation (not any noun) AND the complement an explicit
  // self-harm phrase ("cutting herself/again", "self-harming").
  /\b(?:my|his|her|their) (?:daughter|son|kid|kids|child|children|sister|brother|sibling|friend|bestie|girlfriend|boyfriend|gf|bf|wife|husband|partner|spouse|mom|mother|dad|father|roommate|cousin|niece|nephew|teen|teenager|student|classmate|coworker|colleague|ex|grandkid|grandchild)\b[^.?!]{0,20}\b(?:cutting (?:herself|himself|themselves|themself|again|once more)|self[- ]?harm(?:ing|ed|s)?|harming (?:herself|himself|themselves|themself)|hurting (?:herself|himself|themselves|themself))\b/,
];

// Substance emergency (D): active/possible overdose or medical emergency.
const SUBSTANCE_EMERGENCY = [
  /\boverdos(?:e|ed|ing)\b/,
  /\bod(?:'?d|ed|ing|'?ing)?\b(?=.*\b(?:pills?|heroin|fentanyl|fent|drugs?|meth|coke|xanax|oxy|opioid)\b)/,
  /\btook (?:a (?:bunch|ton|lot) of|too many|way too many|all (?:the|my|his|her)) (?:pills|mg|tabs|of them)\b/,
  /\b(?:not|isn'?t|won'?t start) breathing\b/,
  /\b(?:can'?t|cannot|won'?t) wake (?:him|her|them|up)\b/,
  /\b(?:passed out|unconscious|blue lips|turning blue|foaming)\b.*\b(?:pills?|drunk|drugs?|heroin|fentanyl|took|alcohol|xanax|overdose)\b/,
  /\btook (?:pills|something) and (?:now )?(?:can'?t|won'?t|isn'?t|is not)\b/,
  /\bthink (?:he|she|they|i) (?:might have|may have|)?overdos/,
  // Overdose-quantity signal (Finding 1 probe: "took like 8 xannies"). Two shapes
  // so ordinary "took 2 pills for a headache" stays inert: (a) a count of a NAMED
  // misuse substance/slang at any number, and (b) a clearly-excessive count of
  // generic pills/tabs (two-digit, i.e. 10+). Generic "pills" at a small number is
  // deliberately NOT here — that path is the "a bunch of / too many pills" line
  // above and the unresponsive line below.
  /\btook (?:like |about |around |roughly |maybe |over |at least |a couple |some )?\d{1,3}\s*(?:xans?|xannies|bars?|percs?|oxys?|oxycodones?|benzos?|valiums?|klonopins?|addys?|adderalls?|roxies?|blues?|beans?|tabs?)\b/,
  /\btook (?:like |about |around |over |at least )?\d{2,}\s*(?:pills?|tablets?|caps?|of them)\b/,
  // Person unresponsive after taking something — active-emergency signal. Scoped
  // to a "took …" lead-in, or an explicit person pronoun, so "my phone/the wifi is
  // barely responsive" can't trip it (no "took", no he/she/they subject).
  /\btook\b[^.?!]{0,40}\b(?:barely|not|isn'?t|won'?t|can'?t|hardly)\b[^.?!]{0,12}\b(?:responsive|breathing|conscious|awake|moving|respond(?:ing)?|waking up)\b/,
  /\b(?:he|she|they|he'?s|she'?s|they'?re) (?:barely|hardly|not really) (?:responsive|conscious|breathing|awake)\b/,
];

// A substance lexicon (drug/alcohol names + common slang) and a dosage-unit set.
// Finding 3's dosage/lethality/combination QUESTION patterns require one of these
// tokens, so they catch "max oxy you can take" / "what amount of fentanyl is
// lethal" / "ratio of molly to alcohol" WITHOUT firing on everyday questions
// ("what's the max I can bench", "ratio of flour to water").
const SUB =
  '(?:alcohol|booze|liquor|vodka|whiskey|whisky|tequila|rum|wine|beers?|weed|thc|cannabis|marijuana|coke|cocaine|crack|mdma|molly|ecstasy|acid|lsd|shrooms?|mushrooms?|heroin|fent|fentanyl|meth|methamphetamine|ketamine|ket|special k|xanax|xans?|xannies|bars?|valium|klonopin|ativan|adderall|addy|vyvanse|oxy|oxys?|oxycodone|percs?|percocet|opioids?|opiates?|codeine|vicodin|benzos?|kratom|ghb|dmt|nitrous|whippets?|amphetamines?|roofies?|tramadol|morphine|dilaudid|suboxone|methadone|gabapentin|pills?|tabs?|hits?|caps?|tablets?|shrooms?)';
const UNIT =
  '(?:mg|milligrams?|micrograms?|mcg|ug|grams?|ml|hits?|tabs?|tablets?|pills?|lines?|caps?|bumps?|shots?|doses?|puffs?|drops?)';

// Substance guidance-request boundary (spec §4): dosing/combination/timing/
// sourcing. Refused in ANY framing. Note these are REQUESTS FOR GUIDANCE, not
// disclosures of use — "my brother struggles with pills" must NOT match here.
const SUBSTANCE_GUIDANCE = [
  /\bhow (?:much|many) (?:mg |grams? |milligrams? )?(?:of )?[a-z0-9]+ (?:should|do|can|to) (?:i|you|we|one) (?:take|do|dose|use|drop)\b/,
  // Any "how much/many <unit>" is a dosing question regardless of trailing phrasing.
  /\bhow (?:much|many) (?:mg|milligrams?|micrograms?|mcg|ug|grams?|hits?|tabs?|tablets?|pills?|lines?|caps?|bumps?|shots?)\b/,
  /\bhow (?:much|many)\b[^.?!]*\b(?:to get (?:high|lit|f\w*ed up)|is (?:a lot|too much|safe|enough|lethal)|before (?:i|you|it|they) (?:feel|kick|hit|od|overdose))\b/,
  /\bhow (?:much|many) (?:should|do|can|to) i (?:take|do|dose|use|smoke|snort|inject|drop)\b/,
  /\b(?:safe|right|correct|proper|good|recommended) (?:dose|dosage|amount) (?:of|for|to)\b/,
  /\bhow much (?:to (?:get|feel)|for a) (?:high|trip|buzz)\b/,
  // Combination questions — require at least one substance token on the object
  // side so ordinary "should we mix red and white paint" / "can I combine these
  // two files" do NOT read as drug-combination guidance (the SUB requirement was
  // added here; the un-scoped [a-z0-9]+ form fired on paint).
  new RegExp('\\b(?:can|could|should|is it (?:safe|ok|okay) to) (?:i |we |you )?(?:mix|combine|stack|take)\\b[^.?!]{0,12}\\b' + SUB + '\\b[^.?!]{0,10}\\b(?:and|with|\\+|plus)\\b', 'i'),
  /\bmix(?:ing)? [a-z0-9]+ (?:and|with|\+) [a-z0-9]+\b(?=.*\b(?:high|trip|drunk|dose|safe|effect|feel)\b)/,
  /\bwhere (?:can i|do i|to) (?:buy|get|score|find|order) (?:weed|coke|cocaine|mdma|molly|acid|lsd|shrooms|heroin|meth|xanax|oxy|percs?|pills|drugs)\b/,
  /\bhow (?:do|to) i? ?(?:make|cook|synthesize|produce) (?:meth|mdma|lsd|acid|crack|dmt)\b/,
  /\bhow (?:long|much) (?:before|after|between) (?:doses|hits|taking)\b/,
  /\bpotentiate\b/,

  // ── Finding 3: dosage / lethality / combination QUESTION shapes ────────────
  // These are the depth the reviewer flagged as falling through to the model.
  // Each requires a substance/unit token so ordinary questions stay untouched,
  // and each is a QUESTION about use — distinct from a Category-E disclosure
  // ("my brother's been struggling with pills"), which names no dose, lethal
  // amount, or combination and therefore matches none of these.

  // "what's the max oxy you can take" / "most acid one can do in a night".
  new RegExp('\\b(?:max|maximum|most|highest|biggest|safe|safest)\\b[^.?!]{0,25}\\b' + SUB + '\\b[^.?!]{0,25}\\b(?:take|do|dose|use|have|handle|smoke|snort|inject|drink|in a (?:day|night|sitting)|per day|at once|a day)', 'i'),
  new RegExp('\\b(?:max|maximum|most|highest|biggest|safe|safest)\\b[^.?!]{0,15}\\b(?:you can|i can|one can|to)\\b[^.?!]{0,15}\\b(?:take|dose|do|use|have|handle)\\b[^.?!]{0,15}\\b' + SUB + '\\b', 'i'),
  // "how much oxy can I take" / "how many bars should I do" (substance between).
  new RegExp('\\bhow (?:much|many)\\b[^.?!]{0,20}\\b' + SUB + '\\b[^.?!]{0,20}\\b(?:can|should|do|to)\\b[^.?!]{0,10}\\b(?:i|you|we|one)\\b[^.?!]{0,10}\\b(?:take|do|dose|use|have|smoke|snort|inject|drink|handle)', 'i'),

  // Lethality: "what amount of fentanyl is lethal", "lethal dose of xanax",
  // "how much heroin would kill you".
  /\b(?:lethal|fatal|deadly|toxic) (?:dose|amount|quantity|level|limit)\b/i,
  new RegExp('\\b(?:what|which|how much|how many)\\b[^.?!]{0,20}\\b' + SUB + '\\b[^.?!]{0,20}\\b(?:is|are|would be|counts as|to be)\\b[^.?!]{0,15}\\b(?:lethal|fatal|deadly|an overdose|enough to (?:kill|od|overdose|die))', 'i'),
  new RegExp('\\b(?:what|which)\\b[^.?!]{0,15}\\b(?:amount|dose|dosage|quantity)\\b[^.?!]{0,15}\\bof\\b[^.?!]{0,15}\\b' + SUB + '\\b[^.?!]{0,15}\\bis (?:lethal|fatal|deadly|an overdose|too much)', 'i'),
  new RegExp('\\bhow (?:much|many)\\b[^.?!]{0,25}\\b' + SUB + '\\b[^.?!]{0,20}\\b(?:to (?:od|overdose|die|kill (?:you|me|someone))|would kill|is lethal|is fatal|before (?:you|i|they) (?:od|overdose|die))', 'i'),

  // Combination / ratio questions: "good ratio of molly to alcohol", "mix xanax
  // with alcohol", "take oxy and xanax together". Both sides must be substances,
  // so "ratio of eggs to flour" stays inert.
  new RegExp('\\b(?:ratio|mix|combo|combination|mixture|cocktail|mixing|blend)\\b[^.?!]{0,10}\\b' + SUB + '\\b[^.?!]{0,10}\\b(?:to|and|with|\\+|&|:|then)\\b[^.?!]{0,10}\\b' + SUB + '\\b', 'i'),
  new RegExp('\\b(?:mix|combine|stack|take|do)\\b[^.?!]{0,15}\\b' + SUB + '\\b[^.?!]{0,12}\\b(?:with|and|\\+|plus|then|before|after|alongside)\\b[^.?!]{0,12}\\b' + SUB + '\\b', 'i'),
];

// Disordered-eating / body signals (spec §5). Sets a flag that suppresses diet /
// weight-target / exercise guidance for the rest of the conversation. Not itself
// an A/B/C/D crisis unless self-harm signals co-occur.
const DISORDERED_EATING = [
  /\b(?:making|make|made) myself (?:throw up|vomit|puke|sick)\b/,
  /\b(?:purg(?:e|ing)|bulimi|anorexi)\b/,
  /\bstarv(?:e|ing) myself\b/,
  /\bhaven'?t eaten (?:in|for) \w+ (?:days?|meals?)\b/,
  /\b(?:skip|skipping|skipped) (?:meals|eating|food) (?:to|so i)\b/,
  /\bi (?:feel|am|'?m) (?:so |too |really )?(?:fat|disgusting|huge)\b/,
  /\bhate (?:my body|how i look|the way i look)\b/,
  /\bhow (?:do i|to|can i) lose \d+ ?(?:lbs?|pounds?|kg|kilos?)\b/,
  /\blose (?:weight|\d+ ?(?:lbs?|pounds?)) (?:fast|quick|by \w+)\b/,
  /\bbinge (?:and|then) purg/,
];

function anyMatch(patterns, text) {
  return patterns.some((re) => re.test(text));
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateSafety(text) — the single entry point the pipeline calls BEFORE the
// valence classifier and BEFORE any model call for reply generation (spec §10).
//
// Returns a plain object:
//   {
//     action: 'crisis' | 'boundary' | 'none',
//     category: 'A'|'B'|'C'|'D'|null,   // set when action === 'crisis'
//     boundary: 'substance'|null,        // set when action === 'boundary'
//     reply: <fixed template string>|null,
//     suppressionWindow: boolean,        // opens the §6 48h promo cooldown
//     disorderedEating: boolean,         // §5 flag (can be true alongside any action)
//     templateVersion: string,
//   }
//
// It never throws and never returns model-generated text.
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateSafety(rawText) {
  const text = normalize(rawText);
  const disorderedEating = anyMatch(DISORDERED_EATING, text);

  // Precedence, spec-aligned:
  //  1. Unambiguous first-person self-harm → A (outranks a third-party reading,
  //     §3: if the user also indicates their own risk, A applies).
  //  2. Otherwise a clear third-party crisis subject → C.
  //  3. Otherwise a bare/ambiguous self-harm signal (no third-party subject) → A.
  //  4. Danger to others → B.
  //  5. Substance emergency → D.
  const firstPersonSelfHarm = anyMatch(SELF_HARM_FIRST_PERSON, text) || anyMatch(SELF_HARM_IMPLICIT, text);
  const thirdParty = anyMatch(THIRD_PARTY_CRISIS, text);
  const ambiguousSelfHarm = anyMatch(SELF_HARM_AMBIGUOUS, text);
  const dangerOthers = anyMatch(DANGER_OTHERS, text);
  const substanceEmergency = anyMatch(SUBSTANCE_EMERGENCY, text);

  let category = null;
  if (firstPersonSelfHarm) category = 'A';
  else if (thirdParty) category = 'C';
  else if (ambiguousSelfHarm) category = 'A';
  else if (dangerOthers) category = 'B';
  else if (substanceEmergency) category = 'D';

  if (category) {
    return {
      action: 'crisis',
      category,
      boundary: null,
      reply: CRISIS_TEMPLATES[category],
      suppressionWindow: SUPPRESSION_CATEGORIES.has(category),
      disorderedEating,
      templateVersion: CRISIS_TEMPLATE_VERSION,
    };
  }

  // No crisis category. Check the always-on substance-guidance boundary (§4).
  if (anyMatch(SUBSTANCE_GUIDANCE, text)) {
    return {
      action: 'boundary',
      category: null,
      boundary: 'substance',
      reply: SUBSTANCE_BOUNDARY_TEMPLATE,
      suppressionWindow: false,
      disorderedEating,
      templateVersion: CRISIS_TEMPLATE_VERSION,
    };
  }

  // Nothing fired. Ordinary message → valence/voice grammar handles it. We still
  // pass through the disorderedEating flag so the voice layer suppresses diet/
  // weight/exercise guidance for the rest of the conversation (§5).
  return {
    action: 'none',
    category: null,
    boundary: null,
    reply: null,
    suppressionWindow: false,
    disorderedEating,
    templateVersion: CRISIS_TEMPLATE_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateModelCrisis({ band, crisisType }) — the SECOND NET (spec §1, high
// recall). evaluateSafety() above is deterministic and runs BEFORE the model; it
// cannot catch every implicit signal (a suicide note left in someone's room, or
// "I gave my dog away and wrote letters to everyone" — no safe regex exists for
// those without drowning ordinary traffic in false positives). So the model's own
// valence classifier is wired as a second detector: every message that clears the
// deterministic gate is classified by the model, and when it returns
// band === 'crisis' the pipeline calls THIS function and routes to the SAME fixed,
// reviewed CRISIS_TEMPLATES.
//
// The model NEVER authors the crisis reply. It only raises the band (detection);
// the response text stays a versioned constant (spec §10 — the single most
// important engineering property). `crisisType` is an OPTIONAL hint that only
// SELECTS which reviewed template; it can never generate one. An unknown or
// missing hint falls back to Category A (self-harm) — the most protective default,
// which always points to 988 + the local-emergency fallback and stays present.
// ─────────────────────────────────────────────────────────────────────────────
export const MODEL_CRISIS_TYPE_TO_CATEGORY = {
  self_harm: 'A', self: 'A', suicide: 'A', suicidal: 'A', self_harm_self: 'A',
  danger_to_others: 'B', others: 'B', violence: 'B', harm_others: 'B', danger: 'B',
  third_party: 'C', someone_else: 'C', third_party_crisis: 'C', other_person: 'C',
  substance: 'D', overdose: 'D', substance_emergency: 'D', drug_emergency: 'D',
};

function normalizeCrisisType(t) {
  return String(t || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function evaluateModelCrisis({ band, crisisType } = {}) {
  if (band !== 'crisis') {
    return {
      action: 'none', category: null, boundary: null, reply: null,
      suppressionWindow: false, disorderedEating: false, source: 'model_band',
      templateVersion: CRISIS_TEMPLATE_VERSION,
    };
  }
  const category = MODEL_CRISIS_TYPE_TO_CATEGORY[normalizeCrisisType(crisisType)] || 'A';
  return {
    action: 'crisis',
    category,
    boundary: null,
    reply: CRISIS_TEMPLATES[category],
    suppressionWindow: SUPPRESSION_CATEGORIES.has(category),
    disorderedEating: false,
    source: 'model_band',
    templateVersion: CRISIS_TEMPLATE_VERSION,
  };
}

// Convenience predicate used by the pipeline's structural override.
export function isSafetyOverride(safety) {
  return safety && (safety.action === 'crisis' || safety.action === 'boundary');
}
