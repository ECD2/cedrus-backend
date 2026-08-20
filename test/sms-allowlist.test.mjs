// Bundle 36 — inbound SMS number allow-list (routes/sms.js STAGE A2).
// (NOT 35: CEDRUS.md II.5 still says "Next free: 35", but the contracts-v0
// merge took 35 in run-all.sh. II.5 needs correcting — see the session report.)
// Run: bun test/sms-allowlist.test.mjs
//
// What runs REAL here: the express route exactly as production wires it
// (createSmsRouter), the real pure decision (lib/smsAllowlist.js), the real
// normalizer (utils/phone.js), the real TwiML builder (twilio), and a real
// booted express server answering real HTTP requests. II.2's proof row for a
// route mount is a real request through a real booted server — not a unit call.
//
// Three seams are injected, and each is injected for a stated reason:
//   • allowedPhones — the whole arm/disarm matrix in one process, with no
//     module-cache tricks and no dependence on ambient env.
//   • validateSignature — STAGE A is not what is under test; forging a real
//     Twilio HMAC per request would test Twilio, not this guard. One case
//     drives it false to prove STAGE A still outranks STAGE A2.
//   • runPipeline — a COUNTING SPY. This is the load-bearing assertion of the
//     whole suite: every app_users row, every messages row and the single
//     OpenAI call live inside runInboundPipeline (STAGE B1 / B4 / C). Proving
//     it was never invoked proves none of them happened. The armed+allowlisted
//     case is the CONTROL: it must show exactly one call, otherwise "0 calls"
//     would be consistent with a route that is simply broken for everyone.
//
// Coverage:
//   • armed + allowlisted        → pipeline runs, reply delivered  (the control)
//   • armed + NOT allowlisted    → 0 pipeline calls, 200, EMPTY TwiML, no reply
//   • armed + odd formatting     → same number in another format still passes
//   • armed + unparseable From   → blocked, still empty TwiML
//   • DISARMED (unset/empty)     → everything passes AND the mode is announced
//   • bad signature              → 403, pipeline never reached (STAGE A first)
//   • log hygiene                → the raw number and the body appear in NO
//                                  log line, in any state

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

const express = (await import('express')).default;
const { createSmsRouter } = await import('../src/routes/sms.js');
const { evaluateAllowlist, phoneFingerprint } = await import('../src/lib/smsAllowlist.js');

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
function section(name) { p(''); p('— ' + name + ' —'); }

const MINE = '+17869727469';
const MINE_DIGITS = '17869727469';
const STRANGER = '+13055551234';
const SECRET_BODY = 'remember to call mom about the surprise party';

// ── Harness ─────────────────────────────────────────────────────────────────
// Boots a real server with the real router. Returns the captured log records
// and the pipeline call count alongside the HTTP response.
async function withRoute({ allowedPhones, signatureValid = true, reply = 'ack from cedrus' }, fn) {
  const logs = [];
  const calls = [];
  const logger = {
    event: (name, fields) => logs.push({ name, ...(fields || {}) }),
    addContext: () => {},
    runWithContext: (_ctx, f) => f(),
    info: () => {}, warn: () => {}, error: () => {},
  };
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '100kb' })); // mirror index.js
  app.use(express.json({ limit: '100kb' }));
  app.use('/sms', createSmsRouter({
    allowedPhones,
    validateSignature: () => signatureValid,
    runPipeline: async (payload) => { calls.push(payload); return reply; },
    logger,
  }));
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await fn({ base, logs, calls });
  } finally {
    server.close();
  }
}

function post(base, from, body = SECRET_BODY) {
  return fetch(base + '/sms/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, Body: body, MessageSid: 'SM' + '0'.repeat(30) + '01', NumSegments: '1' }),
  });
}

const hasMessageEl = (xml) => /<Message>/i.test(xml);
const logText = (logs) => logs.map((l) => JSON.stringify(l)).join('\n');

// ── The pure decision ───────────────────────────────────────────────────────
section('pure decision (evaluateAllowlist)');
{
  const armedList = [MINE_DIGITS];
  ok('empty list ⇒ disarmed and allowed',
    JSON.stringify(evaluateAllowlist(MINE, [])) === JSON.stringify({ armed: false, allowed: true, reason: 'disarmed' }));
  ok('undefined list ⇒ disarmed and allowed',
    evaluateAllowlist(MINE, undefined).armed === false && evaluateAllowlist(MINE, undefined).allowed === true);
  ok('armed + match ⇒ allowed',
    evaluateAllowlist(MINE, armedList).allowed === true && evaluateAllowlist(MINE, armedList).armed === true);
  ok('armed + miss ⇒ blocked with reason not_allowlisted',
    evaluateAllowlist(STRANGER, armedList).allowed === false
    && evaluateAllowlist(STRANGER, armedList).reason === 'not_allowlisted');
  ok('armed + bare 10-digit form of the same number ⇒ allowed (one normalizer)',
    evaluateAllowlist('786-972-7469', armedList).allowed === true);
  ok('armed + unparseable From ⇒ blocked, reason unparseable_from',
    evaluateAllowlist('', armedList).allowed === false
    && evaluateAllowlist('', armedList).reason === 'unparseable_from');
  ok('fingerprint is stable, prefixed, and contains no digits of the number',
    phoneFingerprint(MINE) === phoneFingerprint('786-972-7469')
    && phoneFingerprint(MINE).startsWith('ph_')
    && !phoneFingerprint(MINE).includes('7869'));
}

// ── ARMED: the control — an allowlisted number is untouched ─────────────────
section('armed + allowlisted (the control)');
await withRoute({ allowedPhones: [MINE_DIGITS] }, async ({ base, logs, calls }) => {
  const res = await post(base, MINE);
  const xml = await res.text();
  ok('status 200', res.status === 200, res.status);
  ok('pipeline invoked exactly once', calls.length === 1, calls.length);
  ok('pipeline received the real From', calls[0]?.from === MINE, calls[0]?.from);
  ok('reply delivered in TwiML', hasMessageEl(xml) && xml.includes('ack from cedrus'), xml);
  ok('mode announced as armed', logs.some((l) => l.name === 'sms.allowlist.check' && /mode=armed/.test(l.message || '')));
  ok('sms.inbound.received still emitted', logs.some((l) => l.name === 'sms.inbound.received'));
  ok('no not_allowlisted event', !logs.some((l) => l.name === 'sms.inbound.not_allowlisted'));
});

// ── ARMED: a stranger creates nothing, is told nothing ──────────────────────
section('armed + NOT allowlisted');
await withRoute({ allowedPhones: [MINE_DIGITS] }, async ({ base, logs, calls }) => {
  const res = await post(base, STRANGER);
  const xml = await res.text();
  ok('status 200 (Twilio must not retry)', res.status === 200, res.status);
  ok('PIPELINE NEVER INVOKED — no app_users row, no messages row, no model call',
    calls.length === 0, calls.length);
  ok('TwiML is empty — no <Message> element', !hasMessageEl(xml), xml);
  ok('response is still valid TwiML', /<Response\s*\/?>|<Response>\s*<\/Response>/i.test(xml), xml);
  ok('sms.inbound.not_allowlisted logged', logs.some((l) => l.name === 'sms.inbound.not_allowlisted'));
  ok('not_allowlisted carries the fingerprint', logs.some((l) => l.name === 'sms.inbound.not_allowlisted'
    && (l.message || '').includes(phoneFingerprint(STRANGER))));
  ok('sms.inbound.received NOT emitted (gate sits above it)',
    !logs.some((l) => l.name === 'sms.inbound.received'));
  ok('log hygiene: raw number appears in no log line', !logText(logs).includes('3055551234'));
  ok('log hygiene: message body appears in no log line', !logText(logs).includes('surprise party'));
});

// ── ARMED: formatting must not decide access ────────────────────────────────
section('armed + alternate formatting of the same number');
await withRoute({ allowedPhones: [MINE_DIGITS] }, async ({ base, calls }) => {
  const res = await post(base, '(786) 972-7469');
  await res.text();
  ok('bare/formatted US number still reaches the pipeline', calls.length === 1, calls.length);
});

section('armed + unparseable From');
await withRoute({ allowedPhones: [MINE_DIGITS] }, async ({ base, calls }) => {
  const res = await post(base, '');
  const xml = await res.text();
  ok('blocked', calls.length === 0, calls.length);
  ok('still empty TwiML, still 200', res.status === 200 && !hasMessageEl(xml), xml);
});

// ── DISARMED: pre-guard behaviour, announced ────────────────────────────────
section('DISARMED (ALLOWED_PHONES unset/empty)');
await withRoute({ allowedPhones: [] }, async ({ base, logs, calls }) => {
  const res = await post(base, STRANGER);
  const xml = await res.text();
  ok('a stranger is served, exactly as before the guard existed', calls.length === 1, calls.length);
  ok('reply delivered', hasMessageEl(xml));
  ok('mode announced as DISARMED on this inbound',
    logs.some((l) => l.name === 'sms.allowlist.check' && /mode=DISARMED/.test(l.message || '')));
  ok('DISARMED line names the variable to set',
    logs.some((l) => l.name === 'sms.allowlist.check' && /set ALLOWED_PHONES/.test(l.message || '')));
  ok('no not_allowlisted event while disarmed',
    !logs.some((l) => l.name === 'sms.inbound.not_allowlisted'));
  ok('log hygiene: raw number still absent while disarmed', !logText(logs).includes('3055551234'));
});

// ── STAGE A still outranks STAGE A2 ─────────────────────────────────────────
section('bad Twilio signature (STAGE A precedence)');
await withRoute({ allowedPhones: [MINE_DIGITS], signatureValid: false }, async ({ base, logs, calls }) => {
  const res = await post(base, MINE);
  ok('403', res.status === 403, res.status);
  ok('pipeline never invoked', calls.length === 0, calls.length);
  ok('allow-list never consulted — signature is checked first',
    !logs.some((l) => l.name === 'sms.allowlist.check'));
});

p('');
if (failures === 0) p('ALL SMS ALLOWLIST TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
