// ─────────────────────────────────────────────────────────────────────────
// ONBOARDING SELF-NAME CAPTURE  (pure, dependency-free — unit-testable alone)
//
// The first onboarding prompt (MSG_COMPLIANCE in ./index.js) ends by asking
// "who's someone important in your life?". So the user's FIRST reply is about
// SOMEONE ELSE, not themselves. The old code grabbed the leading word-token of
// that reply and saved it as the USER'S OWN name — which is how self-person
// records ended up named "My" (from "My wife Sarah…") or "Grabbed" (from
// "Grabbed drinks with Dave"). Pronouns, possessives and verbs are NOT names.
//
// Fix: only treat the reply as the user's own name when it is an UNAMBIGUOUS
// self-introduction; otherwise leave the self-name blank (blank is correct —
// never a random word). A separate, side-effect-free check decides whether the
// whole reply is just a lone name (so the pipeline can skip a model call and ask
// the onboarding follow-up) WITHOUT asserting that lone name is the user's own.
// ─────────────────────────────────────────────────────────────────────────

// A leading greeting we tolerate before either a self-intro or a bare name.
const GREETING = /^(?:hi|hey|hello|yo|sup)[,!.\s]+/i;

// High-precision self-introduction cues, kept deliberately NARROW. Loose cues
// like "it's" / "this is" / "call me" routinely precede a non-name ("this is my
// mom", "call me tomorrow") and would reintroduce the garbage-name bug, so they
// are excluded. "my name is" is the gold standard; "i am" / "i'm" are common and
// are backstopped by the NOT_A_NAME guard below. The single capture group is the
// candidate name.
const SELF_CUE = "i am|i'?m|my name is|my name'?s";
const NAME_CHARS = "[A-Za-z][A-Za-z'’-]{1,20}";
const SELF_INTRO = new RegExp(`^(?:${SELF_CUE})\\s+(${NAME_CHARS})\\b`, 'i');
const SELF_STRIP = new RegExp(`^(?:${SELF_CUE})\\s+`, 'i');

// The whole (post-strip) message is exactly one name-like token, optionally with
// a trailing "." or "?" or "!".
const LONE_TOKEN = new RegExp(`^(${NAME_CHARS})[.!?]?$`);

// Words that commonly follow a self-intro cue but are NOT names. Guards the
// friendlier cues so "i'm good" / "i'm not sure" never become a saved name.
const NOT_A_NAME = new Set([
  'good', 'great', 'fine', 'ok', 'okay', 'well', 'here', 'there', 'busy',
  'sorry', 'back', 'not', 'no', 'yes', 'yeah', 'yep', 'nope', 'so', 'just',
  'still', 'also', 'my', 'the', 'a', 'an', 'at', 'on', 'in', 'to', 'and',
  'but', 'doing', 'done', 'tired', 'happy', 'sad', 'new', 'from', 'with',
  'about', 'into', 'ready', 'excited', 'nervous', 'curious', 'confused',
]);

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The user's OWN first name — ONLY from an explicit self-introduction, and never
// a common non-name word. Returns a capitalized name, or null when the reply is
// not a clear self-introduction (in which case the self-name is left blank).
export function extractSelfName(body) {
  const text = String(body || '').trim().replace(GREETING, '');
  const m = SELF_INTRO.exec(text);
  if (!m) return null;
  const token = m[1];
  if (NOT_A_NAME.has(token.toLowerCase())) return null;
  return capitalize(token);
}

// The lone name token when the WHOLE reply is essentially just a name ("Emil",
// "hey Emil", "I'm Emil", "my name is Emil") — used ONLY to decide whether to
// skip the model call and ask the onboarding follow-up. Returns the token
// (capitalized) or null. This does NOT assert the token is the user's own name:
// a bare "Sarah" is almost certainly the important person the user was asked
// about, so callers must not persist it as the self-name.
export function bareName(body) {
  const text = String(body || '').trim()
    .replace(GREETING, '')
    .replace(SELF_STRIP, '')
    .trim();
  const m = LONE_TOKEN.exec(text);
  return m ? capitalize(m[1]) : null;
}
