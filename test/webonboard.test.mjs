// Web onboarding suite — POST /api/onboard/start (BE-WEB-ONBOARD).
// Run: bun test/webonboard.test.mjs
//
// What runs REAL: the express router (createOnboardRouter) exactly as
// production builds it, the whole webOnboarding service, the real
// onboardValidation + rateLimiter utils, and the real messages/consent
// services beneath the flow. Two seams are faked via bun's mock.module: the
// Supabase client (in-memory tables, WITH the app_users.phone UNIQUE
// constraint enforced so the race path is exercised) and the Twilio client.
// The SMS sender is additionally injected into the router so every send can be
// asserted.
//
// Brief coverage (BE-WEB-ONBOARD item 4):
//   • consent script sent verbatim, exactly once
//   • duplicate submit -> no second SMS
//   • rate limits (per IP and per phone)
//   • phone normalization
//   • no account-existence leak (identical response new vs existing)
// Plus: consent recorded correctly, outbound onboarding message logged (inbound
// pipeline integration), email capture as brief_email 'pending', invalid
// phone/email -> 422, the create race (unique violation) never double-texts,
// dry-run, and a drift guard tying the copy to the pipeline's approved script.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock } from 'bun:test';

// ── Env BEFORE any src import (config.js fail-closed-requires these). Dummy
// values only; every network seam is faked.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';
process.env.DEFAULT_TIMEZONE = 'America/New_York';

// ── In-memory Supabase double ────────────────────────────────────────────────
// Supports exactly the ops the onboarding flow uses: app_users select/insert
// (unique phone enforced), messages count/insert, consent_events insert.
// `cloakPhoneOnce` hides a phone from the FIRST maybeSingle() read so we can
// simulate the create race (find sees nothing, insert loses to the winner).
const db = { app_users: [], messages: [], consent_events: [] };
const cloakPhoneOnce = new Set();

function makeFakeSupabase() {
  function table(name) {
    if (!db[name]) db[name] = [];
    const state = { op: 'select', payload: null, filters: [], single: false, maybe: false, count: false, head: false, returning: false, eqPhone: null };
    const api = {
      select(_c, opts = {}) {
        if (state.op === 'select') { state.count = !!opts.count; state.head = !!opts.head; }
        else state.returning = true;
        return api;
      },
      insert(rows) { state.op = 'insert'; state.payload = rows; return api; },
      update(patch) { state.op = 'update'; state.payload = patch; return api; },
      eq(f, v) { if (f === 'phone') state.eqPhone = v; state.filters.push((r) => r[f] === v); return api; },
      maybeSingle() { state.maybe = true; return api; },
      single() { state.single = true; return api; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject ? reject(e) : (() => { throw e; })(); } },
    };

    function matched() { return db[name].filter((r) => state.filters.every((fn) => fn(r))); }

    function run() {
      if (state.op === 'select') {
        // Cloak: a phone in the set is invisible to its first read.
        if (name === 'app_users' && state.eqPhone && cloakPhoneOnce.has(state.eqPhone)) {
          cloakPhoneOnce.delete(state.eqPhone);
          if (state.count) return { data: null, count: 0, error: null };
          if (state.maybe) return { data: null, error: null };
          if (state.single) return { data: null, error: { message: 'no rows' } };
          return { data: [], error: null };
        }
        const found = matched();
        if (state.count) return { data: state.head ? null : found, count: found.length, error: null };
        if (state.single) return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { message: 'single(): not 1 row' } };
        if (state.maybe) return { data: found[0] || null, error: null };
        return { data: found, error: null };
      }
      if (state.op === 'insert') {
        const raw = Array.isArray(state.payload) ? state.payload[0] : state.payload;
        if (name === 'app_users' && db.app_users.some((r) => r.phone === raw.phone)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "app_users_phone_key"' } };
        }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(name === 'app_users' ? { onboarding_complete: false, opted_out: false } : {}), ...raw };
        db[name].push(row);
        return state.returning || state.single || state.maybe ? { data: row, error: null } : { data: null, error: null };
      }
      if (state.op === 'update') {
        const found = matched();
        for (const r of found) Object.assign(r, state.payload);
        return { data: null, error: null };
      }
      throw new Error(`fake supabase: unsupported op ${state.op}`);
    }
    return api;
  }
  return { from: table };
}

const fakeSupabase = makeFakeSupabase();

// Register seams BEFORE importing src. Twilio is mocked so importing lib
// modules constructs no real client; the router injects the recording fakeSms
// for assertions, so this mock's sendSms is never actually called.
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));
mock.module('../src/lib/twilio.js', () => ({
  sendSms: async () => ({ sid: 'SMunused' }),
  twilio: {}, validateTwilioSignature: () => true, statusCallbackUrl: () => null,
}));

const express = (await import('express')).default;
const { createOnboardRouter } = await import('../src/routes/api/onboard.js');
const { createRateLimiter } = await import('../src/services/rateLimiter.js');
const { MSG_COMPLIANCE, MSG_ONBOARD_OK } = await import('../src/services/onboardingCopy.js');
const { validatePhone, validateEmail } = await import('../src/utils/onboardValidation.js');
const {
  MSG_INVALID_PHONE, MSG_INVALID_EMAIL, MSG_RATE_LIMITED,
} = await import('../src/services/onboardingCopy.js');

// ── Harness ──────────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Recording SMS sender. Reset .calls per scenario as needed.
const sms = { calls: [], async send(to, body) { this.calls.push({ to, body }); return { sid: 'SM' + (this.calls.length), numSegments: 1 }; } };

// Build a server with injectable limiters / dryRun; shares the mocked db + sms.
function makeServer({ ipMax = 10000, phoneMax = 10000, windowMs = 3600000, dryRun } = {}) {
  const app = express();
  const deps = {
    sms,
    ipLimiter: createRateLimiter({ windowMs, max: ipMax }),
    phoneLimiter: createRateLimiter({ windowMs, max: phoneMax }),
  };
  if (dryRun !== undefined) deps.dryRun = dryRun;
  app.use('/api/onboard', createOnboardRouter(deps));
  const server = app.listen(0);
  return { server, base: `http://localhost:${server.address().port}/api/onboard` };
}

async function post(base, body, { ip } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (ip) headers['x-forwarded-for'] = ip;
  const res = await fetch(base + '/start', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const usersWith = (phone) => db.app_users.filter((u) => u.phone === phone);
const outboundFor = (userId) => db.messages.filter((m) => m.user_id === userId && m.direction === 'outbound');
const consentFor = (userId) => db.consent_events.filter((c) => c.user_id === userId);

// ════════════════════════════════════════════════════════════════════════════
p('\n── 1. Drift guard: copy is byte-identical to the pipeline\'s approved script ──');
{
  const pipelineSrc = readFileSync(new URL('../src/pipeline/index.js', import.meta.url), 'utf8');
  const m = pipelineSrc.match(/const MSG_COMPLIANCE\s*=\s*\n?\s*"([\s\S]*?)";/);
  check('found MSG_COMPLIANCE in pipeline/index.js', !!m, null);
  check('onboardingCopy MSG_COMPLIANCE === pipeline MSG_COMPLIANCE (verbatim)', !!m && m[1] === MSG_COMPLIANCE,
    m ? { pipeline: m[1].slice(0, 40), copy: MSG_COMPLIANCE.slice(0, 40) } : null);

  const COPY = [MSG_COMPLIANCE, MSG_ONBOARD_OK, MSG_INVALID_PHONE, MSG_INVALID_EMAIL, MSG_RATE_LIMITED];
  check('no em dashes in any onboarding copy', COPY.every((s) => !s.includes('—')), COPY.filter((s) => s.includes('—')));
  check('no exclamation marks in any onboarding copy', COPY.every((s) => !s.includes('!')), COPY.filter((s) => s.includes('!')));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. Pure validators ──');
{
  check('valid US mobile normalizes to digits-only+1', validatePhone('+1 (786) 972-7469').digits === '17869727469', validatePhone('+1 (786) 972-7469'));
  check('bare 10-digit gets the 1', validatePhone('7869727469').digits === '17869727469', null);
  check('empty -> missing', validatePhone('').ok === false && validatePhone('').reason === 'missing', null);
  check('letters -> not_a_number', validatePhone('call-me-maybe').ok === false, validatePhone('call-me-maybe'));
  check('non-NANP (+44) -> unsupported_country', validatePhone('+441234567890').reason === 'unsupported_country', validatePhone('+441234567890'));
  check('N11 area code (111) -> rejected', validatePhone('+1 (111) 111-1111').ok === false, validatePhone('+11111111111'));
  check('area code starting 1 -> invalid_nxx', validatePhone('1000000000').ok === false, validatePhone('1000000000'));
  check('555-01xx fictional -> rejected', validatePhone('+13055550142').ok === false, validatePhone('+13055550142'));
  check('all-same-digit -> repeated', validatePhone('+12222222222').reason === 'repeated', validatePhone('+12222222222'));

  check('valid email lowercased', validateEmail('Test.User@Example.COM').email === 'test.user@example.com', validateEmail('Test.User@Example.COM'));
  check('no-at -> invalid', validateEmail('nope.example.com').ok === false, null);
  check('no-dot domain -> invalid', validateEmail('a@b').ok === false, null);
  check('disposable -> rejected', validateEmail('x@mailinator.com').reason === 'disposable', null);
  check('empty -> missing', validateEmail('').ok === false, null);
}

const main = makeServer();

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Happy path: new number texted once, consent + history recorded ──');
const NEW_PHONE = '17869727469';
let newResponse = null;
{
  const before = sms.calls.length;
  const r = await post(main.base, { phone: '+1 (786) 972-7469' }, { ip: '11.11.11.11' });
  newResponse = r;
  check('new submit -> 200 ok', r.status === 200 && r.json?.ok === true, r);
  check('response is the generic message', r.json?.message === MSG_ONBOARD_OK, r.json);

  const sent = sms.calls.slice(before);
  check('exactly one SMS sent', sent.length === 1, sent.length);
  check('SMS body is MSG_COMPLIANCE verbatim', sent[0]?.body === MSG_COMPLIANCE, sent[0]?.body);
  check('SMS addressed to the normalized number', sent[0]?.to === NEW_PHONE, sent[0]?.to);

  const rows = usersWith(NEW_PHONE);
  check('one app_users row created', rows.length === 1, rows.length);
  check('consent_source = web_onboarding', rows[0]?.consent_source === 'web_onboarding', rows[0]?.consent_source);
  check('sms_consent_at set', !!rows[0]?.sms_consent_at, rows[0]?.sms_consent_at);
  check('timezone derived from area code (786 -> New_York)', rows[0]?.timezone === 'America/New_York', rows[0]?.timezone);
  check('not marked onboarded (their reply is the onboarding answer)', rows[0]?.onboarding_complete === false, rows[0]?.onboarding_complete);

  const user = rows[0];
  const ob = outboundFor(user.id);
  check('outbound onboarding message logged', ob.length === 1 && ob[0].message_type === 'onboarding', ob);
  check('logged body is MSG_COMPLIANCE (inbound pipeline will see history)', ob[0]?.body === MSG_COMPLIANCE, null);

  const ce = consentFor(user.id);
  check('one consent_events row', ce.length === 1, ce.length);
  check('consent event_type = consent_captured', ce[0]?.event_type === 'consent_captured', ce[0]?.event_type);
  check('consent source = web', ce[0]?.source === 'web', ce[0]?.source);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. Duplicate submit: no second SMS, response unchanged ──');
{
  const before = sms.calls.length;
  const r = await post(main.base, { phone: '786-972-7469' }, { ip: '22.22.22.22' }); // same number, different format+IP
  check('duplicate -> 200 ok', r.status === 200, r);
  check('duplicate response identical to first', JSON.stringify(r.json) === JSON.stringify(newResponse.json), r.json);
  check('NO second SMS sent', sms.calls.length === before, sms.calls.length - before);
  check('still exactly one app_users row', usersWith(NEW_PHONE).length === 1, usersWith(NEW_PHONE).length);
  check('still exactly one consent event', consentFor(usersWith(NEW_PHONE)[0].id).length === 1, null);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. No account-existence leak: existing SMS user answers identically ──');
{
  // Seed an established SMS user (has message history) directly.
  const EXIST = '13125551212'; // 312 area, 555 exchange but subscriber 1212 (not 01xx) -> valid
  const existUser = { id: crypto.randomUUID(), phone: EXIST, timezone: 'America/Chicago', consent_source: 'first_message', sms_consent_at: new Date().toISOString(), onboarding_complete: true };
  db.app_users.push(existUser);
  db.messages.push({ id: crypto.randomUUID(), user_id: existUser.id, direction: 'inbound', channel: 'sms', body: 'hi', created_at: new Date().toISOString() });

  const before = sms.calls.length;
  const r = await post(main.base, { phone: '+1 312 555 1212' }, { ip: '33.33.33.33' });
  check('existing user -> 200 ok', r.status === 200, r);
  check('response byte-identical to a brand-new signup (no leak)', JSON.stringify(r.json) === JSON.stringify(newResponse.json), r.json);
  check('NO SMS sent to an established user', sms.calls.length === before, sms.calls.length - before);
  check('no new consent event on the existing user', consentFor(existUser.id).length === 0, null);
  check('no duplicate app_users row', usersWith(EXIST).length === 1, usersWith(EXIST).length);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 6. Email capture: valid stored pending; invalid -> 422, nothing created ──');
{
  const EPHONE = '14045551234'; // 404 area, 555 exch, 1234 sub -> valid
  const before = sms.calls.length;
  const r = await post(main.base, { phone: '+1 404 555 1234', email: 'New.Fan@Example.COM' }, { ip: '44.0.0.1' });
  check('valid email submit -> 200', r.status === 200, r);
  check('one SMS sent', sms.calls.length === before + 1, null);
  const u = usersWith(EPHONE)[0];
  check('brief_email stored lowercased', u?.brief_email === 'new.fan@example.com', u?.brief_email);
  check('brief_email_status = pending (unverified, not sent to)', u?.brief_email_status === 'pending', u?.brief_email_status);

  const IPHONE = '12065551234';
  const before2 = sms.calls.length;
  const bad = await post(main.base, { phone: '+1 206 555 1234', email: 'not-an-email' }, { ip: '44.0.0.2' });
  check('invalid email -> 422 invalid_email', bad.status === 422 && bad.json?.error === 'invalid_email', bad);
  check('invalid email response uses the email copy', bad.json?.message === MSG_INVALID_EMAIL, bad.json);
  check('invalid email -> NO SMS', sms.calls.length === before2, null);
  check('invalid email -> NO user created', usersWith(IPHONE).length === 0, usersWith(IPHONE).length);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 7. Invalid phone -> 422, nothing created or sent ──');
{
  for (const bad of ['', '123', 'hello', '+441234567890', '+1 (111) 111-1111']) {
    const before = sms.calls.length;
    const usersBefore = db.app_users.length;
    const r = await post(main.base, { phone: bad }, { ip: '55.0.0.1' });
    check(`phone ${JSON.stringify(bad)} -> 422 invalid_phone`, r.status === 422 && r.json?.error === 'invalid_phone', r);
    check(`phone ${JSON.stringify(bad)} -> no SMS, no user`, sms.calls.length === before && db.app_users.length === usersBefore, null);
  }
  check('invalid phone response uses the phone copy', (await post(main.base, { phone: 'xyz' }, { ip: '55.0.0.1' })).json?.message === MSG_INVALID_PHONE, null);
  const missing = await post(main.base, {}, { ip: '55.0.0.2' });
  check('missing phone field -> 422', missing.status === 422, missing);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 8. Normalization: many formats of the SAME number collapse to one ──');
{
  const NPHONE = '13035557788'; // 303 area
  const forms = ['+1 (303) 555-7788', '303-555-7788', '3035557788', '+13035557788', '1 303 555 7788'];
  const before = sms.calls.length;
  for (const f of forms) await post(main.base, { phone: f }, { ip: '66.0.0.' + Math.floor(Math.random() * 200) });
  check('all formats -> exactly one app_users row', usersWith(NPHONE).length === 1, usersWith(NPHONE).length);
  check('all formats -> exactly one SMS', sms.calls.length === before + 1, sms.calls.length - before);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 9. Rate limits: per IP and per phone ──');
{
  // Per-IP: 2 allowed, 3rd from the same IP is 429 (distinct valid phones).
  const ipSrv = makeServer({ ipMax: 2 });
  const r1 = await post(ipSrv.base, { phone: '+1 305 236 0001' }, { ip: '77.77.77.77' });
  const r2 = await post(ipSrv.base, { phone: '+1 305 236 0002' }, { ip: '77.77.77.77' });
  const r3 = await post(ipSrv.base, { phone: '+1 305 236 0003' }, { ip: '77.77.77.77' });
  check('IP: first two allowed', r1.status === 200 && r2.status === 200, [r1.status, r2.status]);
  check('IP: third -> 429 rate_limited', r3.status === 429 && r3.json?.error === 'rate_limited', r3);
  check('IP: 429 uses the rate-limit copy', r3.json?.message === MSG_RATE_LIMITED, r3.json);
  const r4 = await post(ipSrv.base, { phone: '+1 305 236 0004' }, { ip: '88.88.88.88' });
  check('IP: a different IP is unaffected', r4.status === 200, r4);
  ipSrv.server.close();

  // Per-phone: same number from different IPs still trips the phone bucket.
  const phSrv = makeServer({ phoneMax: 2 });
  const P = { phone: '+1 305 236 5000' };
  const p1 = await post(phSrv.base, P, { ip: '90.0.0.1' });
  const p2 = await post(phSrv.base, P, { ip: '90.0.0.2' });
  const p3 = await post(phSrv.base, P, { ip: '90.0.0.3' });
  check('phone: first two allowed', p1.status === 200 && p2.status === 200, [p1.status, p2.status]);
  check('phone: third (same number, new IP) -> 429', p3.status === 429 && p3.json?.error === 'rate_limited', p3);
  phSrv.server.close();
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 10. Create race: unique violation is adopted, never double-texts ──');
{
  // Winner already created the row (has NO history yet). Cloak it from the
  // first read so our request tries to insert, loses to the unique constraint,
  // re-fetches, adopts, and sends exactly once.
  const RACE = '15125559090'; // 512 area
  const winner = { id: crypto.randomUUID(), phone: RACE, timezone: 'America/Chicago', consent_source: 'web_onboarding', sms_consent_at: new Date().toISOString(), onboarding_complete: false };
  db.app_users.push(winner);
  cloakPhoneOnce.add(RACE);

  const before = sms.calls.length;
  const r = await post(main.base, { phone: '+1 512 555 9090' }, { ip: '99.0.0.1' });
  check('raced submit -> 200 ok (no crash)', r.status === 200 && r.json?.message === MSG_ONBOARD_OK, r);
  check('race adopted the winner row (no duplicate)', usersWith(RACE).length === 1, usersWith(RACE).length);
  check('race sent exactly one SMS to the adopted row', sms.calls.length === before + 1 && sms.calls[sms.calls.length - 1].to === RACE, sms.calls.slice(before));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 11. Dry run: records the flow, sends no SMS ──');
{
  const drySrv = makeServer({ dryRun: true });
  const DPHONE = '19045551234'; // 904 area
  const before = sms.calls.length;
  const r = await post(drySrv.base, { phone: '+1 904 555 1234' }, { ip: 'AA.0.0.1' });
  check('dry-run -> 200 ok', r.status === 200 && r.json?.message === MSG_ONBOARD_OK, r);
  check('dry-run sends NO real SMS', sms.calls.length === before, sms.calls.length - before);
  const u = usersWith(DPHONE)[0];
  check('dry-run still created the user', !!u, null);
  const ob = outboundFor(u.id);
  check('dry-run logged the onboarding message (marked dry_run)', ob.length === 1 && ob[0].provider_status === 'dry_run', ob);
  drySrv.server.close();
}

// ════════════════════════════════════════════════════════════════════════════
main.server.close();
p('');
if (failures === 0) p('ALL WEB-ONBOARD TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
