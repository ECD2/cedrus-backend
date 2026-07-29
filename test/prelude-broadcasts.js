// Doubles for Bundle 33 (admin broadcasts). Concatenated AFTER
// test/reliability-core.js and BEFORE the stripped src/utils/time.js +
// src/services/broadcasts.js. Happy paths + gate refusals over the real fake
// DB; sendSms / logOutbound / budget gate are recorded doubles.

let __events = [];
let __sentSms = [];
let __sendFailFor = null;   // phone string → throw on that recipient
let __outboundLog = [];
let __budgetGate = { paused: false, reason: null, degraded: false };

const logger = {
  info() {}, warn() {}, error() {},
  event(name, fields) { __events.push({ name, fields: fields || {} }); return name; },
  addContext() {}, runWithContext: (_s, fn) => fn(),
};
const __eventsNamed = (n) => __events.filter((e) => e.name === n);

const config = { briefDryRun: true };

async function sendSms(to, body) {
  if (__sendFailFor && to === __sendFailFor) throw new Error('twilio rejected ' + to);
  __sentSms.push({ to, body });
  return { sid: 'SM_' + __sentSms.length, status: 'queued' };
}

const messages = {
  logOutbound: async (row) => { __outboundLog.push(row); return { id: 'msg_' + __outboundLog.length }; },
};

async function getBudgetGate() { return __budgetGate; }

function __resetBroadcasts() {
  __reset(); // reliability-core: wipe the fake DB
  __events = []; __sentSms = []; __sendFailFor = null; __outboundLog = [];
  __budgetGate = { paused: false, reason: null, degraded: false };
  config.briefDryRun = true;
}
