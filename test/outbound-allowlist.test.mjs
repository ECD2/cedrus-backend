// Bundle 37 — outbound SMS number allow-list (lib/twilio.js STAGE O).
// Run: bun test/outbound-allowlist.test.mjs
//
// What runs REAL here: the real sendSms() exactly as production calls it, the
// real pure decision (lib/smsAllowlist.js), the real normalizer
// (utils/phone.js), and the real recipient loaders (services/users.js). Two
// seams are faked with bun's mock.module, each for a stated reason:
//   • the `twilio` package — so "did this reach the wire?" is a call count on
//     messages.create rather than a network call. THIS IS THE LOAD-BEARING
//     ASSERTION: a refused number must produce ZERO create() calls.
//   • the Supabase client — so the loaders can be driven with a fixed two-user
//     table (one allowlisted, one not) and we can prove a blocked recipient is
//     dropped at SELECTION, before any job composes or records anything.
//
// Why both layers are tested: sendSms() is the enforcement point, but the
// loaders are what stop a blocked recipient from costing an OpenAI call and
// leaving a row the next tick retries. Neither alone is the guarantee.
//
// Coverage:
//   • armed + allowlisted     → reaches Twilio (the control)
//   • armed + NOT allowlisted → throws OUTBOUND_REFUSED, ZERO create() calls
//   • armed + odd formatting  → same number in another format still sends
//   • DISARMED                → everything reaches Twilio, mode announced
//   • the refusal is tagged so callers can cancel instead of retrying
//   • loaders drop blocked recipients; disarmed loaders drop nobody
//   • log hygiene: the number and the body appear in NO log line

import { mock } from 'bun:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

const MINE = '17869727469';
const STRANGER = '13055551234';
const SECRET_BODY = 'remember the surprise party';

// ── Seam 1: the twilio package ──────────────────────────────────────────────
const created = [];
const fakeTwilio = () => ({ messages: { create: async (p) => { created.push(p); return { sid: 'SMfake', status: 'queued' }; } } });
fakeTwilio.validateRequest = () => true;
mock.module('twilio', () => ({ default: fakeTwilio, twilio: fakeTwilio }));

// ── Seam 2: the Supabase client used by services/users.js ───────────────────
const DB_USERS = [
  { id: 'u-mine', phone: MINE, name: 'Emil', opted_out: false },
  { id: 'u-other', phone: STRANGER, name: null, opted_out: false },
];
mock.module('../src/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: async () => ({ data: DB_USERS.map((u) => ({ ...u })), error: null }) }),
    }),
  },
}));

const { sendSms } = await import('../src/lib/twilio.js');
const { OUTBOUND_REFUSED, evaluateAllowlist, phoneFingerprint } = await import('../src/lib/smsAllowlist.js');
const users = await import('../src/services/users.js');

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

const logs = [];
const logger = { event: (name, f) => logs.push({ name, ...(f || {}) }), info() {}, warn() {}, error() {} };
const reset = () => { created.length = 0; logs.length = 0; };
const logText = () => logs.map((l) => JSON.stringify(l)).join('\n');

// ── ARMED + allowlisted: the control ────────────────────────────────────────
section('armed + allowlisted (the control)');
reset();
{
  const res = await sendSms(MINE, 'hello', { allowedPhones: [MINE], logger });
  ok('reached Twilio exactly once', created.length === 1, created.length);
  ok('addressed to the E.164 form of the number', created[0]?.to === '+' + MINE, created[0]?.to);
  ok('returned the provider result', res?.sid === 'SMfake', res);
  ok('mode announced as armed', logs.some((l) => l.name === 'sms.outbound.allowlist.check' && /mode=armed/.test(l.message || '')));
  ok('no refusal event', !logs.some((l) => l.name === 'sms.outbound.not_allowlisted'));
}

// ── ARMED + not allowlisted: nothing on the wire ────────────────────────────
section('armed + NOT allowlisted');
reset();
{
  let threw = null;
  try { await sendSms(STRANGER, SECRET_BODY, { allowedPhones: [MINE], logger }); }
  catch (e) { threw = e; }
  ok('sendSms THREW (so no caller can record a send)', threw !== null);
  ok('the throw is tagged OUTBOUND_REFUSED', threw?.code === OUTBOUND_REFUSED, threw?.code);
  ok('the error is flagged notAllowlisted', threw?.notAllowlisted === true);
  ok('NOTHING REACHED TWILIO — zero create() calls', created.length === 0, created.length);
  ok('refusal event logged', logs.some((l) => l.name === 'sms.outbound.not_allowlisted'));
  ok('refusal carries the fingerprint', logs.some((l) => (l.message || '').includes(phoneFingerprint(STRANGER))));
  ok('log hygiene: raw number in no log line', !logText().includes('3055551234'));
  ok('log hygiene: body in no log line', !logText().includes('surprise party'));
}

// ── formatting must not decide access ───────────────────────────────────────
section('armed + alternate formatting');
reset();
{
  await sendSms('(786) 972-7469', 'hi', { allowedPhones: [MINE], logger });
  ok('bare/formatted US number still reaches Twilio', created.length === 1, created.length);
}

// ── DISARMED ────────────────────────────────────────────────────────────────
section('DISARMED (ALLOWED_PHONES unset/empty)');
reset();
{
  await sendSms(STRANGER, 'hi', { allowedPhones: [], logger });
  ok('a stranger is served, exactly as before the guard existed', created.length === 1, created.length);
  ok('mode announced as DISARMED', logs.some((l) => /mode=DISARMED/.test(l.message || '')));
  ok('DISARMED line names the variable to set', logs.some((l) => /set ALLOWED_PHONES/.test(l.message || '')));
  ok('no refusal event while disarmed', !logs.some((l) => l.name === 'sms.outbound.not_allowlisted'));
}

// ── The recipient loaders drop blocked users at SELECTION ───────────────────
// This is the half that stops a blocked recipient from costing a model call and
// leaving a 'generated' brief row the next tick recomposes.
section('recipient loaders (selection-time filtering)');
{
  const { config } = await import('../src/config.js');

  config.allowedPhones = [MINE];
  const briefArmed = await users.listActiveForBrief();
  const nudgeArmed = await users.listNudgeable();
  ok('listActiveForBrief returns ONLY the allowlisted user', briefArmed.length === 1 && briefArmed[0].phone === MINE, briefArmed.map((u) => u.phone));
  ok('listNudgeable returns ONLY the allowlisted user', nudgeArmed.length === 1 && nudgeArmed[0].phone === MINE, nudgeArmed.map((u) => u.phone));

  config.allowedPhones = [];
  const briefDisarmed = await users.listActiveForBrief();
  const nudgeDisarmed = await users.listNudgeable();
  ok('DISARMED: listActiveForBrief returns everyone (no behaviour change)', briefDisarmed.length === 2, briefDisarmed.length);
  ok('DISARMED: listNudgeable returns everyone (no behaviour change)', nudgeDisarmed.length === 2, nudgeDisarmed.length);
}

// ── The pure decision, incl. the disarmed/armed matrix ──────────────────────
section('pure decision');
{
  ok('empty list ⇒ disarmed + allowed', evaluateAllowlist(STRANGER, []).armed === false && evaluateAllowlist(STRANGER, []).allowed === true);
  ok('armed + miss ⇒ blocked', evaluateAllowlist(STRANGER, [MINE]).allowed === false);
  ok('armed + hit ⇒ allowed', evaluateAllowlist(MINE, [MINE]).allowed === true);
}

p('');
if (failures === 0) p('ALL OUTBOUND ALLOWLIST TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
