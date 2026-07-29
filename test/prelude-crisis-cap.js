// Doubles for Bundle 22 (crisis outranks the pre-model short-circuits).
// Concatenated BEFORE the import/export-stripped src files by run-tests.sh.
//
// REAL code in this bundle: src/services/safetyDetection.js (evaluateSafety,
// isSafetyOverride), src/pipeline/selfName.js (extractSelfName, bareName), and
// src/pipeline/index.js (the pipeline under test). Everything below is a double.

const println = typeof print === 'function' ? print : console.log; // jsc: print(); node/bun: console.log

// ── Knobs ───────────────────────────────────────────────────────────────────
let __isNew = false;
let __onboardingComplete = true;
let __hasNoHistory = false;
let __allowed = true;                 // checkRateLimit verdict
let __compliance = { handled: false };
let __budgetGate = { paused: false, reason: null, degraded: false }; // STAGE B3.5 verdict (item 1)
let __cardResult = { handled: false, reply: null };                  // STAGE B2.6 verdict (item 2)

// ── Recorders ───────────────────────────────────────────────────────────────
let __outbound = [];                  // { body, type }
let __calls = [];                     // ordered call trace
let __openaiInvocations = [];         // bodies that reached the model seam
let __crisisSignals = [];
let __suppressionWindows = [];

function __reset(opts) {
  const o = opts || {};
  __isNew = !!o.isNew;
  __onboardingComplete = o.onboardingComplete !== false;
  __hasNoHistory = !!o.hasNoHistory;
  __allowed = o.allowed !== false;
  __compliance = o.compliance || { handled: false };
  __budgetGate = o.budgetGate || { paused: false, reason: null, degraded: false };
  __cardResult = o.cardResult || { handled: false, reply: null };
  __outbound = []; __calls = []; __openaiInvocations = [];
  __crisisSignals = []; __suppressionWindows = [];
}

const __lastOut = () => (__outbound.length ? __outbound[__outbound.length - 1] : null);

// ── Service doubles ─────────────────────────────────────────────────────────
const logger = {
  event: () => {}, info: () => {}, warn: () => {}, error: () => {},
  addContext: () => {}, runWithContext: (_s, fn) => fn(),
};

const users = {
  findOrCreateByPhone: async () => ({ user: { id: 'u1', onboarding_complete: __onboardingComplete }, isNew: __isNew }),
  touchActive: async () => {},
  markOnboarded: async () => { __calls.push('markOnboarded'); },
};

const messages = {
  logInbound: async () => ({ message: { id: 'm1' }, duplicate: false }),
  logOutbound: async ({ body, messageType }) => { __outbound.push({ body: body, type: messageType }); },
  hasNoHistory: async () => __hasNoHistory,
  buildContext: async () => { __calls.push('buildContext'); return { recent: [] }; },
};

const people = { renameSelf: async () => {} };
const usage = { logAgentRun: async () => {} };

async function handleCompliance() { __calls.push('handleCompliance'); return __compliance; }
async function checkRateLimit() { __calls.push('checkRateLimit'); return { allowed: __allowed, quota: null }; }
async function getBudgetGate() { __calls.push('getBudgetGate'); return __budgetGate; } // services/budget.js double (item 1)
const cards = { handleCardReply: async () => { __calls.push('handleCardReply'); return __cardResult; } }; // services/cards.js double (item 2)
async function isInSuppressionWindow() { return false; }
async function resolveEntities() { return {}; }
async function persist() { return {}; }

// Safety side-effects that live in 05_understand.js, recorded here so the suite
// can assert a bypassed crisis still records the signal and opens the §6 window.
function recordCrisisSignal(a) { __crisisSignals.push(a); }
async function openSuppressionWindow(a) { __suppressionWindows.push(a); return { persisted: true }; }

// ── understand() double ─────────────────────────────────────────────────────
// MIRRORS src/pipeline/05_understand.js:41-54 — the Priority 0 gate, in order:
// evaluateSafety -> isSafetyOverride -> record + open window -> return the fixed
// template, WITHOUT reaching the model. Both predicates below are the REAL
// exported functions, not reimplementations, so the branch condition here is
// production's condition. `__openaiInvocations` is the model seam: anything that
// gets past the gate lands in it.
//
// The mirror is a double, so section 3 of the suite ALSO asserts the gate
// condition directly against the real functions for every crisis body used —
// that assertion, not this stub, is what proves the production short-circuit.
async function understand({ user, body }) {
  __calls.push('understand');
  const safety = evaluateSafety(body);
  if (isSafetyOverride(safety)) {
    recordCrisisSignal({ userId: user.id, category: safety.category, boundary: safety.boundary });
    if (safety.suppressionWindow) openSuppressionWindow({ userId: user.id, category: safety.category });
    return { reply: safety.reply, _suppressPersistence: true, _model: 'safety-shortcircuit' };
  }
  __openaiInvocations.push(body);
  return { reply: 'MODEL_AUTHORED_REPLY', people: [], facts: [] };
}

// MIRRORS src/services/clarifications.js:241 — a crisis/boundary turn never
// touches pending state and passes the fixed reply through verbatim. The rest of
// the state machine is Bundle 16's job, not this suite's.
const clarifications = {
  dispatch: async ({ parsed }) => {
    const base = (parsed && parsed.reply) || 'Got it.';
    if (parsed && parsed._suppressPersistence) return { reply: base };
    return { reply: base };
  },
};

// ── Assertion harness (same shape as test/reliability-core.js) ──────────────
function makeChecker() {
  let failures = 0;
  function check(name, cond, detail) {
    if (cond) println('  PASS  ' + name);
    else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
  }
  return { check, done: () => failures };
}
