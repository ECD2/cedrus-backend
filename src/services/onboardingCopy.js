// ─────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING — user-facing copy
//
// ── MSG_COMPLIANCE ──
// This MUST be byte-identical to MSG_COMPLIANCE in src/pipeline/index.js, which
// is itself byte-identical to the Opt-In Confirmation Response approved in
// Twilio toll-free verification. The web flow texts this VERBATIM as the first
// message so a website signup and an inbound-SMS signup receive the exact same,
// approved first contact. Do NOT edit this without re-submitting to Twilio AND
// updating the pipeline copy in lockstep.
//
// CANONICAL SOURCE: src/pipeline/index.js. This is a deliberate duplicate
// because this stream is new-files-only and cannot export the pipeline's
// private const. A drift guard (test/webonboard.test.mjs) reads the pipeline
// file and fails the build if the two strings ever diverge. Follow-up flagged
// in docs/WEB_ONBOARD_CONTRACT.md: extract this to one shared module both the
// pipeline and this service import, so a single edit updates both.
// ─────────────────────────────────────────────────────────────────────────

export const MSG_COMPLIANCE =
  "Hey, I'm Cedrus. I help you remember the people you care about: birthdays, life updates, gift ideas, and the moments worth following up on. By continuing, you agree to receive recurring SMS messages from Cedrus Life. No spam, ever. Reply STOP to opt out anytime, HELP for info. Msg & data rates may apply. Ready to start... who's someone important in your life?";

// The SINGLE response body for every well-formed submission — new number,
// existing account, or a number we chose not to re-text. It never reveals
// which of those happened (the brief: "NEVER reveal whether a number already
// has an account"). Voice rules (WS-B): no em dashes, no exclamation marks.
export const MSG_ONBOARD_OK =
  "If that number can receive texts, Cedrus just sent you a message. Reply to it to get started.";

// Validation + traffic errors. These are safe to differentiate: they describe
// the INPUT or the request rate, not whether an account exists, so they leak
// nothing about who is or isn't a Cedrus user.
export const MSG_INVALID_PHONE =
  "That does not look like a mobile number we can text. Check it and try again.";
export const MSG_INVALID_EMAIL =
  "That email address does not look right. Fix it or leave it blank.";
export const MSG_RATE_LIMITED =
  "That is a lot of tries in a short time. Give it a minute and try again.";
