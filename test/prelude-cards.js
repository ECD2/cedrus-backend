// Doubles for Bundle 30 (card rail state machine). Concatenated AFTER
// test/reliability-core.js (which provides the working in-memory supabase,
// println, makeChecker) and BEFORE the stripped src files:
//   src/utils/time.js  src/services/cards.js  src/jobs/cardSender.js
//   src/jobs/cardFollowup.js
//
// Happy-path state machine + caps + dry-run live here against the REAL fake
// DB; failure branches live in Bundle 31 with a programmable seam.

// knobs + recorders (NOT redeclaring reliability-core's names)
let __events = [];
let __sentSms = [];
let __sendFail = null;
let __outboundLog = [];
let __contactLogs = [];
let __inSuppression = false;

const logger = {
  info() {}, warn() {}, error() {},
  event(name, fields) { __events.push({ name, fields: fields || {} }); return name; },
  addContext() {}, runWithContext: (_s, fn) => fn(),
};
const __eventsNamed = (n) => __events.filter((e) => e.name === n);

const config = { briefDryRun: true };

async function sendSms(to, body) {
  if (__sendFail) throw __sendFail;
  __sentSms.push({ to, body });
  return { sid: 'SM_' + __sentSms.length, status: 'queued' };
}

const messages = {
  logOutbound: async (row) => { __outboundLog.push(row); return { id: 'msg_' + __outboundLog.length }; },
};

const rel = {
  logContact: async (args) => { __contactLogs.push(args); },
};

async function isInSuppressionWindow() { return __inSuppression; }

function __resetCards() {
  __reset(); // reliability-core: wipe the fake DB
  __events = []; __sentSms = []; __sendFail = null;
  __outboundLog = []; __contactLogs = []; __inSuppression = false;
  config.briefDryRun = true;
}
