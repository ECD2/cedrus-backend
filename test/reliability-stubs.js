// Service-layer stubs shared by the reminders / brief / messages proof bundles.
// Concatenated AFTER reliability-core.js and BEFORE the stripped src file(s).
// Not used by the logger / people / signature bundles (which are self-contained
// or bring their own prelude), to avoid duplicate-declaration collisions.

let __sendMode = 'ok';   // 'ok' | 'throw'
let __sendCalls = 0;     // number of sendSms invocations
const __calls = [];      // ordered call log (fn names) for order assertions

const config = { briefDryRun: false };

const logger = {
  info() {}, warn() {}, error() {},
  event() {}, addContext() {},
  runWithContext(_store, fn) { return fn(); },
};

async function sendSms(_to, _body) {
  __calls.push('sendSms');
  __sendCalls++;
  if (__sendMode === 'throw') { const e = new Error('twilio unavailable'); e.code = 21610; throw e; }
  return { sid: 'SM' + __sendCalls, status: 'queued' };
}

// messages service double: records call order AND persists an outbound row so
// callers that read msg.id keep working.
const messages = {
  async logOutbound(a) {
    __calls.push('logOutbound');
    const row = Object.assign({ id: 'm_' + (++__idSeq) }, a);
    (__db.messages = __db.messages || []).push(row);
    return row;
  },
};

// people service double (only what messages.js buildContext touches).
const people = { async listForUser() { return []; } };

// briefs service double for the weekly-brief ordering test.
const briefs = {
  async createBrief({ userId, weekOf }) {
    __db.briefs = [];
    const row = { id: 'b1', user_id: userId, week_of: weekOf, status: 'generated' };
    __db.briefs.push(row);
    return { id: 'b1' };
  },
  async clearBriefItems() {},
  async addBriefItem() {},
  async markSent({ briefId }) {
    __calls.push('markSent');
    const b = (__db.briefs || []).find((x) => x.id === briefId);
    if (b) b.status = 'sent';
  },
};

const usersSvc = { async recordBriefSent() { __calls.push('recordBriefSent'); } };
const rel = { async openPendingPrompt() { __calls.push('openPendingPrompt'); } };
const usage = { async logAgentRun() {} };

function getUsersDueForBrief() { return []; }
function gatherCandidates() { return []; }

// §6 suppression-window double: toggle + call log, so the brief/sweep job tests
// can prove the jobs consult the window and thread the flag into selection.
let __suppressionActive = false;
async function isInSuppressionWindow(_userId) {
  __calls.push('isInSuppressionWindow');
  return __suppressionActive;
}

let __selectOpts = null; // records the opts sendBriefTo passed to selection
function selectBriefItems(_user, _candidates, opts) {
  __selectOpts = opts || null;
  return { items: [], teaser: null, goalFollowup: null, planTier: 'free', closingQuestion: 'Who did you reach out to?' };
}
async function composeBrief() { return { text: 'Here is your weekly brief.', model: 'gpt-4.1-mini', usage: {} }; }
function localWeekOf() { return '2026-07-06'; }
