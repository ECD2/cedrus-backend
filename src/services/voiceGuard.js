// ─────────────────────────────────────────────────────────────────────────────
// Cedrus Priority 1 — Voice & Emotional-Intelligence structural backstop
// Implements the enforceable half of CEDRUS_VOICE_AND_EMOTIONAL_INTELLIGENCE_SPEC.md.
//
// The empathy GRAMMAR (§5) is generative — the model drafts the reply guided by
// the rewritten extraction prompt. But three rules must NOT depend on the model
// obeying a prompt instruction; they are enforced here in code:
//
//   • §3.2 banned cheerfulness ("great/awesome/yay/nice", "!") outside Positive
//   • §4   never attach a Pro upsell to a Sensitive/Negative/Crisis reply
//   • §8   the relationship-CORRECTION path ("girlfriend → ex") is wired to the
//          valence check here, so the exact original failure is structurally
//          impossible even if the model misclassifies the band.
//
// Pure and dependency-free, like safetyDetection.js — directly unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export const BANDS = ['routine', 'positive', 'sensitive_neutral', 'negative', 'crisis'];

// Ordered by caution. Higher index = more cautious. Used to enforce the spec's
// "when uncertain, default to the MORE cautious band" tie-break (§2).
const BAND_ORDER = { routine: 0, positive: 1, sensitive_neutral: 2, negative: 3, crisis: 4 };

function moreCautious(a, b) {
  const ai = BAND_ORDER[a] ?? 2; // unknown → treat as sensitive_neutral (silence-safe)
  const bi = BAND_ORDER[b] ?? 2;
  return ai >= bi ? a : b;
}

// Relationship values that mean the relationship ENDED or soured. A supersession
// to one of these is the "girlfriend → ex" case — Sensitive-neutral at minimum.
const ENDED_RELATIONSHIP = /\b(ex[- ]?(?:girlfriend|boyfriend|wife|husband|partner)?|ex|divorced|separated|estranged|no longer together|broke up|broken up|split up|split)\b/i;

// Explicit loss / hardship language anywhere in the incoming message → Negative.
const LOSS_LANGUAGE = /\b(passed away|passed on|died|death|funeral|miscarriage|miscarried|laid off|got fired|lost (?:my|his|her|their) job|cancer|terminal|diagnosed|hospice|estranged|breakup|broke up)\b/i;

// Cheerful reactions banned outside the Positive band (§3.2).
const BANNED_CHEER = /\b(great|awesome|yay|woohoo|amazing|nice|wonderful|exciting|congrats|congratulations)\b/gi;

// Upsell / monetization fragments that must never ride along a non-Positive,
// non-Routine reply (§4). Whole sentences containing these get dropped.
const UPSELL = /(cedrus\.life\/upgrade|upgrade to pro|go pro\b|pro is unlimited|\$9\s*\/?\s*month|\$9\/mo|paywall|subscribe)/i;

// Numeric diet / weight-target / exercise guidance suppressed once disordered-
// eating signals appear (§5). We strip sentences that hand out specific numbers.
const DIET_GUIDANCE = /(\b\d+\s*(?:calories|cals|kcal|lbs?|pounds?|kg|grams?|reps|minutes? of (?:cardio|exercise))\b|\blose \d+|\bcut (?:back )?to \d+|\btarget weight|\bgoal weight)/i;

// ─────────────────────────────────────────────────────────────────────────────
// resolveBand — combine the model's proposed band with deterministic escalators.
// The model can only ever be ESCALATED toward caution here, never de-escalated:
// a structural guarantee that the correction path can't produce a cheerful reply.
// ─────────────────────────────────────────────────────────────────────────────
export function resolveBand({ modelBand, body, facts }) {
  let band = BANDS.includes(modelBand) ? modelBand : 'sensitive_neutral';

  // Correction-path wiring (§8): a relationship fact superseding to an ended
  // value forces at least Sensitive-neutral — the "girlfriend → ex" fix.
  const relFacts = (facts || []).filter((f) => canonicalRelKey(f.fact_key) === 'relationship');
  const endedCorrection = relFacts.some(
    (f) => ENDED_RELATIONSHIP.test(String(f.fact_value || '')) && (f.supersedes_prior === true),
  );
  if (endedCorrection) band = moreCautious(band, 'sensitive_neutral');

  // Explicit loss language in the message → Negative, regardless of model band.
  if (LOSS_LANGUAGE.test(String(body || ''))) band = moreCautious(band, 'negative');

  return band;
}

// Local mirror of memory.canonicalFactKey for the relationship alias, kept here
// so this module stays dependency-free. (memory.js remains the source of truth
// for persistence; this is only for band resolution.)
function canonicalRelKey(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase().replace(/\s+/g, '_');
  if (['relationship_status', 'relationship_type', 'relationship_to_user'].includes(k)) return 'relationship';
  return k;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyVoiceGuard — mutate/return a cleaned reply for a NON-crisis message.
// (Crisis/boundary replies are fixed templates and never pass through here.)
//
//   input:  { reply, band, disorderedEating }
//   output: { reply, band }  (reply cleaned, band echoed for logging/tests)
// ─────────────────────────────────────────────────────────────────────────────
export function applyVoiceGuard({ reply, band, disorderedEating }) {
  let out = String(reply || '');
  const nonCheerful = band === 'sensitive_neutral' || band === 'negative' || band === 'crisis';

  if (nonCheerful) {
    // §3.2: no exclamation points attached to a sensitive acknowledgment.
    out = out.replace(/!+/g, '.');
    // §3.2: strip cheerful reaction words. They almost never belong in a
    // sensitive reply; removing them and tidying punctuation is safe.
    out = out.replace(BANNED_CHEER, '');
    out = tidy(out);
  }

  // §4: never bundle a monetization prompt with a non-Routine, non-Positive
  // reply. Drop any sentence carrying an upsell fragment.
  if (band !== 'routine' && band !== 'positive') {
    out = dropSentencesMatching(out, UPSELL);
  }

  // §5: once disordered-eating signals appear, suppress specific diet / weight /
  // exercise numbers for the rest of the conversation.
  if (disorderedEating) {
    out = dropSentencesMatching(out, DIET_GUIDANCE);
  }

  out = tidy(out);
  if (!out) out = 'Got it, I’ll keep that in mind.'; // silence-safe default (§3.8)
  // Recapitalize the opener if stripping a leading cheer word left it lowercase.
  out = out.replace(/^([a-z])/, (m, c) => c.toUpperCase());
  return { reply: out, band };
}

// Remove whole sentences that match a pattern, keep the rest intact.
function dropSentencesMatching(text, re) {
  const parts = String(text).split(/(?<=[.?])\s+/);
  const kept = parts.filter((s) => !re.test(s));
  return kept.join(' ').trim();
}

// Collapse the punctuation/spacing artifacts left behind after word removal:
// "Okay , updated" → "Okay, updated"; doubled spaces; leading punctuation.
function tidy(text) {
  return String(text)
    .replace(/\s+([,.])/g, '$1')
    .replace(/([,.])\s*([,.])/g, '$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+/, '')
    .replace(/\.\s*\./g, '.')
    .trim();
}
