// BE-ADMIN-AUTH — admin login (email + password + TOTP) suite.
// Run: bun test/adminAuth.test.mjs   (wrapper: sh test/run-admin-auth-tests.sh)
//
// What runs REAL here: the login/enroll routes + session adapter
// (createAdminAuth with injected fakes for logger/clock/limiter), AND the two
// existing /admin routers exactly as production mounts them — the N1 panel
// (src/routes/adminPanel.js) and the founder-admin router (src/routes/admin.js)
// — so "session accepted by existing routes" and "legacy key still works" are
// proven against the actual handlers, not stand-ins. Only two seams are faked
// via bun's mock.module: the Supabase client (never reached on the auth-gate
// paths we exercise) and config.js (to seed a legacy ADMIN_KEY without real env).
//
// Spec coverage (BE-ADMIN-AUTH brief, item 4):
//   • wrong password rejected            • reused TOTP window rejected
//   • wrong TOTP rejected                • rate limit triggers (+ Retry-After)
//   • session expiry enforced            • legacy x-admin-key still works
//   • enrollment locks after first use   • audit entries written, no secrets
//   • a valid session is accepted by BOTH existing routers

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { mock } from 'bun:test';

process.env.NODE_ENV = 'test';

// ── faked seams (must precede the dynamic imports below) ────────────────────
const FAKE_ADMIN_KEY = 'legacy-admin-key-abc123';
const fakeSupabase = {
  from() { throw new Error('supabase.from() reached in an auth-gate test (unexpected)'); },
};
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));
mock.module('../src/config.js', () => ({
  config: { adminKey: FAKE_ADMIN_KEY, testerPhones: ['15550001111'], isProduction: false, nodeEnv: 'test' },
  assertSecureBoot() {},
}));

const express = (await import('express')).default;
const { createAdminAuth } = await import('../src/routes/adminAuth.js');
const adminPanelRouter = (await import('../src/routes/adminPanel.js')).default;
const adminFounderRouter = (await import('../src/routes/admin.js')).default;
const { signSession, verifySession, RateLimiter } = await import('../src/services/adminSession.js');

// ── fixtures ────────────────────────────────────────────────────────────────
const EMAIL = 'emil@cedrus.test';
const PASSWORD = 'S3cure-Admin-Pass!';
const HASH = bcrypt.hashSync(PASSWORD, 10);
const SECRET = authenticator.generateSecret();
const SESSION_SECRET = 'unit-test-session-secret-please-rotate';
const codeNow = () => authenticator.generate(SECRET);

// ── tiny harness (manual, matches test/safety.test.mjs; non-zero exit = fail)─
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

// Build a fresh app per scenario so rate-limit / replay state is isolated.
function buildApp(authOverrides = {}, { real = true } = {}) {
  const events = [];
  const logger = {
    event: (name, fields = {}) => { events.push(Object.assign({ __name: name }, fields)); return name; },
    info() {}, warn() {}, error() {}, addContext() {}, runWithContext(_s, fn) { return fn(); },
  };
  const auth = createAdminAuth(Object.assign({
    logger, sessionSecret: SESSION_SECRET, adminEmail: EMAIL, adminPasswordHash: HASH,
    totpSecret: SECRET, adminKey: FAKE_ADMIN_KEY,
  }, authOverrides));

  const app = express();
  app.use(express.json());
  app.use('/admin', auth.router);       // /admin/auth/login, /admin/auth/enroll (else falls through)
  app.use('/admin', auth.adapter);      // Bearer → req.adminSession + injected x-admin-key
  if (real) {
    app.use('/admin', adminPanelRouter);   // real N1 panel
    app.use('/admin', adminFounderRouter); // real founder admin
  }
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, events, auth, close: () => new Promise((r) => server.close(r)) };
}

async function req(base, path, { method = 'POST', headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (e.g. 404 text) */ }
  return { status: res.status, json, retryAfter: res.headers.get('retry-after') };
}
const named = (events, name) => events.filter((e) => e.__name === name);
const login = (base, over = {}) => req(base, '/admin/auth/login', { body: Object.assign({ email: EMAIL, password: PASSWORD, totp: codeNow() }, over) });

// ─────────────────────────────────────────────────────────────────────────
async function run() {
  // T1 — fail closed when the admin identity isn't configured
  p('\n── login fail-closed ──');
  {
    const a = buildApp({ adminEmail: '', adminPasswordHash: '', sessionSecret: '' }, { real: false });
    const r = await login(a.base);
    check('unconfigured admin → 503', r.status === 503, `${r.status}`);
    check('audit reason=admin_not_configured', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'admin_not_configured'));
    await a.close();
  }
  {
    const a = buildApp({ totpSecret: '' }, { real: false });
    const r = await login(a.base, { totp: '123456' });
    check('TOTP not enrolled → 403', r.status === 403, `${r.status}`);
    check('audit reason=totp_not_enrolled', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'totp_not_enrolled'));
    await a.close();
  }

  // T2 — wrong password / wrong TOTP
  p('\n── credential failures ──');
  {
    const a = buildApp({}, { real: false });
    const r = await login(a.base, { password: 'not-the-password' });
    check('wrong password → 401', r.status === 401, `${r.status}`);
    check('generic message (no factor leak)', r.json && /invalid email, password, or code/.test(r.json.error || ''));
    check('audit reason=bad_password', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'bad_password'));
    await a.close();
  }
  {
    const a = buildApp({}, { real: false });
    const r = await login(a.base, { totp: '000000' });
    check('wrong TOTP → 401', r.status === 401, `${r.status}`);
    check('audit reason=bad_totp', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'bad_totp'));
    await a.close();
  }

  // T3 — happy path, then the SAME code is rejected as a replay
  p('\n── happy path + TOTP replay ──');
  {
    const a = buildApp({}, { real: false });
    const code = codeNow();
    const ok = await req(a.base, '/admin/auth/login', { body: { email: EMAIL, password: PASSWORD, totp: code } });
    check('valid login → 200', ok.status === 200, `${ok.status}`);
    check('returns Bearer token', ok.json && ok.json.token_type === 'Bearer' && typeof ok.json.token === 'string');
    check('returns expires_at', ok.json && typeof ok.json.expires_at === 'string');
    check('issued token verifies', ok.json && verifySession(ok.json.token, { secret: SESSION_SECRET }).valid === true);
    check('audit login.succeeded written', named(a.events, 'admin_auth.login.succeeded').length === 1);

    const replay = await req(a.base, '/admin/auth/login', { body: { email: EMAIL, password: PASSWORD, totp: code } });
    check('reused TOTP code → 401', replay.status === 401, `${replay.status}`);
    check('audit reason=totp_replayed', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'totp_replayed'));
    await a.close();
  }

  // T4 — rate limiting (+ Retry-After)
  p('\n── rate limiting ──');
  {
    const a = buildApp({ rateLimiter: new RateLimiter({ max: 3, windowMs: 60_000 }) }, { real: false });
    for (let i = 0; i < 3; i++) await login(a.base, { password: 'wrong' }); // 3 failures fill the window
    const limited = await login(a.base, { password: 'wrong' });
    check('over the limit → 429', limited.status === 429, `${limited.status}`);
    check('Retry-After header present', Number(limited.retryAfter) > 0, `${limited.retryAfter}`);
    check('audit reason=rate_limited', named(a.events, 'admin_auth.login.rejected').some((e) => e.reason === 'rate_limited'));
    await a.close();
  }

  // T5 — session expiry enforced by the adapter
  p('\n── session expiry ──');
  {
    const a = buildApp();
    const expired = signSession({ secret: SESSION_SECRET, ttlSeconds: -10 }).token; // exp in the past
    const r = await req(a.base, '/admin/testers', { method: 'GET', headers: { authorization: `Bearer ${expired}` } });
    check('expired session → 401', r.status === 401, `${r.status}`);
    check('audit session.rejected reason=expired', named(a.events, 'admin_auth.session.rejected').some((e) => e.reason === 'expired'));
    const forged = 'cadm_v1.' + Buffer.from('{"sub":"admin","exp":9999999999}').toString('base64url') + '.deadbeef';
    const rf = await req(a.base, '/admin/testers', { method: 'GET', headers: { authorization: `Bearer ${forged}` } });
    check('forged signature → 401', rf.status === 401, `${rf.status}`);
    await a.close();
  }

  // T6 — a valid session is accepted by BOTH real routers
  p('\n── session accepted by existing routers ──');
  {
    const a = buildApp();
    const token = signSession({ secret: SESSION_SECRET }).token;
    const panel = await req(a.base, '/admin/testers', { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    check('session → real panel /testers 200', panel.status === 200, `${panel.status}`);
    check('panel returned masked allowlist', panel.json && panel.json.count === 1 && panel.json.source === 'env:TESTER_PHONES');
    // founder-admin /user: empty body → 400 from the handler AFTER auth passes (a
    // 403 would mean the injected key didn't authenticate).
    const founder = await req(a.base, '/admin/user', { headers: { authorization: `Bearer ${token}` }, body: {} });
    check('session → real founder /user passes auth (400 not 403)', founder.status === 400, `${founder.status}`);
    await a.close();
  }

  // T7 — legacy x-admin-key still works; bad key rejected; no auth rejected
  p('\n── legacy key preserved ──');
  {
    const a = buildApp();
    const good = await req(a.base, '/admin/testers', { method: 'GET', headers: { 'x-admin-key': FAKE_ADMIN_KEY } });
    check('legacy key → panel /testers 200', good.status === 200, `${good.status}`);
    const foundLegacy = await req(a.base, '/admin/user', { headers: { 'x-admin-key': FAKE_ADMIN_KEY }, body: {} });
    check('legacy key → founder /user passes auth (400)', foundLegacy.status === 400, `${foundLegacy.status}`);
    const bad = await req(a.base, '/admin/testers', { method: 'GET', headers: { 'x-admin-key': 'nope' } });
    check('bad key → panel 403', bad.status === 403, `${bad.status}`);
    const none = await req(a.base, '/admin/user', { body: {} });
    check('no auth → founder /user 403', none.status === 403, `${none.status}`);
    await a.close();
  }

  // T8 — enrollment: provisions once, idempotent per process, locks after enrolled
  p('\n── enrollment lifecycle ──');
  {
    const a = buildApp({ totpSecret: '' }); // not yet enrolled
    const first = await req(a.base, '/admin/auth/enroll', { body: { email: EMAIL, password: PASSWORD } });
    check('enroll (unenrolled) → 200', first.status === 200, `${first.status}`);
    check('returns otpauth_uri', first.json && /^otpauth:\/\/totp\//.test(first.json.otpauth_uri || ''));
    check('returns QR svg', first.json && /^<svg/.test(first.json.qr_svg || ''));
    check('returns a base32 secret', first.json && /^[A-Z2-7]{16,}$/.test(first.json.secret || ''));
    const second = await req(a.base, '/admin/auth/enroll', { body: { email: EMAIL, password: PASSWORD } });
    check('enroll is idempotent (same secret)', second.json && second.json.secret === first.json.secret);
    check('audit enroll.provisioned written', named(a.events, 'admin_auth.enroll.provisioned').length >= 1);
    const wrong = await req(a.base, '/admin/auth/enroll', { body: { email: EMAIL, password: 'wrong' } });
    check('enroll requires password → 401', wrong.status === 401, `${wrong.status}`);
    await a.close();

    // End-to-end: adopt the provisioned secret → enroll now 404s, login works.
    const b = buildApp({ totpSecret: first.json.secret });
    const locked = await req(b.base, '/admin/auth/enroll', { body: { email: EMAIL, password: PASSWORD } });
    check('enroll after enrollment → 404 (locked)', locked.status === 404, `${locked.status}`);
    check('audit reason=already_enrolled', named(b.events, 'admin_auth.enroll.rejected').some((e) => e.reason === 'already_enrolled'));
    const liveCode = authenticator.generate(first.json.secret);
    const loggedIn = await req(b.base, '/admin/auth/login', { body: { email: EMAIL, password: PASSWORD, totp: liveCode } });
    check('login with the enrolled secret → 200', loggedIn.status === 200, `${loggedIn.status}`);
    await b.close();
  }

  // T9 — audit hygiene: no secret material ever reaches a log field
  p('\n── audit hygiene (no secrets) ──');
  {
    const a = buildApp({}, { real: false });
    const code = codeNow();
    const ok = await req(a.base, '/admin/auth/login', { body: { email: EMAIL, password: PASSWORD, totp: code } });
    await login(a.base, { password: 'leak-probe-password' }); // a failure too
    const blob = JSON.stringify(a.events);
    check('password never logged', !blob.includes(PASSWORD) && !blob.includes('leak-probe-password'));
    check('TOTP code never logged', !blob.includes(code));
    check('session secret never logged', !blob.includes(SESSION_SECRET));
    check('issued token never logged', ok.json && !blob.includes(ok.json.token));
    check('an ip_hash IS recorded (correlation)', a.events.some((e) => e.meta && typeof e.meta.ip_hash === 'string' && e.meta.ip_hash.startsWith('ip_')));
    await a.close();
  }

  p('');
  if (failures) { p(`❌ adminAuth: ${failures} check(s) failed.`); process.exit(1); }
  p('✅ adminAuth: all checks passed.');
}

run().catch((e) => { console.error('adminAuth suite crashed:', e); process.exit(1); });
