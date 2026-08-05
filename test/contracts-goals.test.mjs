// Bundle 35 — CONTRACTS: the vendored contracts package enforced on one live
// path, POST /api/goals. Run: bun test/contracts-goals.test.mjs
//
// What runs REAL here: the compiled contracts package (contracts/dist/), the
// real contract guard (src/services/contractGuard.js), the real goals service,
// the real express router and the real auth middleware, over a really booted
// server. One seam is faked, via bun's mock.module: the Supabase client
// (test/web-fakes.mjs). NOTHING about the contract is stubbed.
//
// This is the suite the concat rig cannot host. Bundle 19 runs goals.js against
// test/stub-contract-guard.js, which proves only that the call site exists; the
// two branches of the flag are proven here, against the real guard.
//
// THE CONTROL DISCIPLINE (Law 3). The claim is "with the flag off a violating
// payload logs and succeeds; with the flag on it is refused." Both halves need
// a control, because each on its own is satisfiable by a broken guard:
//
//   flag off, violating payload succeeds   ← also true if the guard never runs
//     control: the same payload with the flag ON must be refused, and the log
//              line must have been emitted in BOTH runs with its mode named.
//   flag on, violating payload is refused  ← also true if the flag refuses
//                                             everything
//     control: a LEGAL payload with the flag ON must still succeed.
//
// And for the mount, per CEDRUS.md II.5: a 401 proves nothing about whether a
// route is mounted, because the /api catch-all authenticates before matching.
// The mount control is therefore an AUTHENTICATED request to an unmounted path
// returning 404, against an authenticated request to the real path returning
// 200.

import crypto from 'node:crypto';
import { mock } from 'bun:test';

// ── Env BEFORE any src import: config.js fail-closed-requires these. Dummy
// values only — the Supabase seam is faked, nothing can reach a real host.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// The shipped default. Set explicitly rather than left unset, so this suite
// states the state it is testing instead of inheriting one.
delete process.env.CONTRACTS_VALIDATE;

import { makeFakeSupabase } from './web-fakes.mjs';

const uid = () => crypto.randomUUID();
const uA = uid();

const db = {
  app_users: [
    { id: uA, auth_user_id: 'auth-a', name: 'Alba', phone: '15551110001',
      timezone: 'America/New_York', plan: 'trialing', onboarding_complete: true },
  ],
  user_goals: [],
  people: [],
};

const TOKENS = { 'tok-a': 'auth-a' };
const fakeSupabase = makeFakeSupabase({ db, tokens: TOKENS });
mock.module('../src/lib/supabase.js', () => ({ supabase: fakeSupabase }));

// ── Capture the structured logger's output. The guard's whole flag-off
// contribution IS a log line, so a suite that cannot read log lines cannot tell
// "checked and fine" from "never ran" (Lesson 7).
// The sink is `console.log` / `.warn` / `.error` (see logger.js `emit`), not
// process.stdout directly, so the console methods are the seam. Patched here
// rather than mocked, so the records still print and a human reading the
// battery output sees the same lines this suite is asserting on.
const logLines = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const capture = (method) => (...args) => {
  const first = args[0];
  if (typeof first === 'string' && first.startsWith('{')) {
    try { logLines.push(JSON.parse(first)); } catch { /* not a log record */ }
  }
  return realConsole[method].apply(console, args);
};
console.log = capture('log');
console.warn = capture('warn');
console.error = capture('error');
const violations = () => logLines.filter((l) => l.event === 'contract.violation');
const resetLog = () => { logLines.length = 0; };

const express = (await import('express')).default;
const { createGoalsRouter } = await import('../src/routes/api/goals.js');
const guard = await import('../src/services/contractGuard.js');
const contracts = await import('../contracts/dist/index.js');

// ── Harness ─────────────────────────────────────────────────────────────────
let failures = 0;
const p = (...a) => console.log(...a);
function check(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}

// Production wiring: default deps, the fake arrives via the mocked lib module.
// An UNMOUNTED sibling path is deliberately absent from this app, so a request
// to it exercises express's own 404 rather than a hand-written one.
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api/goals', createGoalsRouter());
const server = app.listen(0);
const origin = `http://localhost:${server.address().port}`;

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(origin + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// The divergence this wiring actually catches today: `cleanGoalText` accepts any
// non-empty string, `cedrus.goal` requires three characters. Recorded in
// contracts/VENDORED_FROM.md under "Divergences".
const VIOLATING = { goal_text: 'gy' };
const LEGAL = { goal_text: 'swim twice a week' };

const goalCount = () => db.user_goals.length;

// ════════════════════════════════════════════════════════════════════════════
p('── 1. The mount is real (II.5: a 401 proves nothing here) ──');
{
  const unauth = await call('/api/goals', { method: 'GET' });
  check('unauthenticated GET → 401 (and this proves NOTHING about the mount)',
    unauth.status === 401, unauth);

  const mounted = await call('/api/goals', { method: 'GET', token: 'tok-a' });
  check('authenticated GET /api/goals → 200 (the real path)',
    mounted.status === 200 && Array.isArray(mounted.json?.goals), mounted);

  const control = await call('/api/goals-definitely-not-a-route', { method: 'GET', token: 'tok-a' });
  check('authenticated GET of an UNMOUNTED control path → 404',
    control.status === 404, { status: control.status });

  check('the control discriminates: mounted 200 vs unmounted 404',
    mounted.status === 200 && control.status === 404);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 2. Flag OFF (the shipped default): log only, behaviour unchanged ──');
{
  delete process.env.CONTRACTS_VALIDATE;
  check('the guard reports itself disarmed', guard.contractsValidateEnabled() === false);

  resetLog();
  const before = goalCount();
  const res = await call('/api/goals', { method: 'POST', token: 'tok-a', body: VIOLATING });

  check('a violating payload still SUCCEEDS', res.status === 200 && res.json?.created === true, res);
  check('...and the row was really written', goalCount() === before + 1, goalCount());
  check('...with the member\'s text stored exactly as before',
    db.user_goals[db.user_goals.length - 1].goal_text === 'gy');

  const v = violations();
  check('exactly one contract.violation was logged', v.length === 1, v.length);
  check('the log line names the mode it ran in (Lesson 7)',
    v[0]?.reason === 'contracts_validate_off_log_only', v[0]?.reason);
  check('the log line names the contract', v[0]?.category === 'cedrus.goal', v[0]?.category);
  check('the log line carries the issue code', String(v[0]?.error_code).includes('string/too_short'), v[0]?.error_code);
  check('the log line does NOT carry the member\'s words',
    !JSON.stringify(v[0] ?? {}).includes('"gy"'), v[0]);

  resetLog();
  const legal = await call('/api/goals', { method: 'POST', token: 'tok-a', body: LEGAL });
  check('a legal payload succeeds and logs NOTHING (silence means clean, and only clean)',
    legal.status === 200 && violations().length === 0, violations());
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 3. Flag ON (test env only): 422 shaped as cedrus.api_error ──');
{
  process.env.CONTRACTS_VALIDATE = 'true';
  check('the guard reports itself armed', guard.contractsValidateEnabled() === true);

  resetLog();
  const before = goalCount();
  const res = await call('/api/goals', { method: 'POST', token: 'tok-a', body: VIOLATING });

  check('the same violating payload is now REFUSED with 422', res.status === 422, res.status);
  check('...and NOTHING was written', goalCount() === before, { before, after: goalCount() });

  const body = res.json ?? {};
  check('the body names the contract', body.contract === 'cedrus.goal', body.contract);
  check('the body carries the issue paths',
    Array.isArray(body.issues) && body.issues.some((i) => i.path === 'stated_text'),
    body.issues);
  check('the body carries the issue codes',
    Array.isArray(body.issues) && body.issues.some((i) => i.code === 'string/too_short'),
    body.issues);
  check('the body is traceable back to a request (Lesson 17)',
    typeof body.request_id === 'string' && body.request_id.startsWith('request:')
      && body.request_id !== 'request:unknown',
    body.request_id);

  // The response is not merely 422-shaped: it satisfies the contract package's
  // own api_error contract. Checked with the real validator, not by eye.
  const parsed = contracts.apiErrorContract.safeParse(body);
  check('the 422 body VALIDATES against cedrus.api_error',
    parsed.ok, parsed.ok ? null : parsed.issues);

  const v = violations();
  check('the violation is still logged when enforcing', v.length === 1, v.length);
  check('...and the log line names the ENFORCING mode',
    v[0]?.reason === 'contracts_validate_on', v[0]?.reason);
  check('...at warn level, because it now costs the caller something',
    v[0]?.level === 'warn', v[0]?.level);

  // THE CONTROL. Without this, "flag on refuses" is also satisfied by a flag
  // that refuses everything.
  resetLog();
  const legalCount = goalCount();
  const legal = await call('/api/goals', { method: 'POST', token: 'tok-a', body: LEGAL });
  check('CONTROL: a legal payload still succeeds with the flag ON',
    legal.status === 200 && legal.json?.created === true, legal);
  check('CONTROL: ...and was written', goalCount() === legalCount + 1);
  check('CONTROL: ...and logged no violation', violations().length === 0, violations());
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 4. The flag is read per call, not frozen at module load ──');
{
  // If the flag were cached at import time, section 3 could not have flipped it,
  // and this suite would be proving one branch twice. Assert the mechanism
  // directly rather than trusting that the sections above ran in order.
  process.env.CONTRACTS_VALIDATE = 'true';
  const armed = guard.contractsValidateEnabled();
  process.env.CONTRACTS_VALIDATE = 'false';
  const disarmedByFalse = guard.contractsValidateEnabled();
  delete process.env.CONTRACTS_VALIDATE;
  const disarmedByUnset = guard.contractsValidateEnabled();
  check('true → armed', armed === true);
  check('the literal string "false" → disarmed', disarmedByFalse === false);
  check('unset → disarmed (the shipped default)', disarmedByUnset === false);
  check('only the exact string "true" arms it', armed && !disarmedByFalse && !disarmedByUnset);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 5. The adapter maps the live row honestly ──');
{
  // Two mappings are deliberate and would otherwise produce permanent false
  // violations. Both are recorded in contracts/VENDORED_FROM.md; both are
  // asserted here so a future "simplification" of the adapter goes red.
  const projected = guard.goalRowToContract({
    id: '11111111-2222-4333-8444-555555555555',
    user_id: uA,
    goal_text: 'swim twice a week',
    origin: 'user_set',
    status: 'open',
    created_at: '2026-08-05T10:00:00.000Z',
    updated_at: '2026-08-05T10:00:00.000Z',
  });
  check('ids are prefixed to the contract id shape',
    projected.goal_id === 'goal:11111111-2222-4333-8444-555555555555'
      && projected.member_id === `member:${uA}`, projected.goal_id);
  check('the service\'s ranking weight is NOT sent as the contract\'s member-set rank',
    projected.priority === null);
  check('lane is null (the column does not exist yet), not guessed',
    projected.lane === null);
  check('a fully mapped live row satisfies the contract',
    contracts.goalContract.safeParse(projected).ok,
    contracts.goalContract.safeParse(projected));

  const pending = guard.goalRowToContract({ user_id: uA, goal_text: 'swim twice a week',
    origin: 'user_set', status: 'open',
    created_at: '2026-08-05T10:00:00.000Z', updated_at: '2026-08-05T10:00:00.000Z' });
  check('a pre-insert row uses the named placeholder id, not an empty one',
    pending.goal_id === guard.GOAL_ID_PENDING && pending.goal_id === 'goal:pending',
    pending.goal_id);
  check('...and still validates, so the id is honestly out of scope rather than silently broken',
    contracts.goalContract.safeParse(pending).ok);
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 6. dist/ is the amended source, not a stale build ──');
{
  // dist/ is committed build output. If someone edits contracts/src/ without
  // running `npm run build`, the runtime silently keeps enforcing the old rules.
  // This does not catch every possible drift; it catches the values Slice 1
  // depends on, which is the drift that would matter first.
  check('dist carries the deployed goal status domain',
    contracts.GOAL_STATUSES.join('|') === 'open|completed|missed|canceled',
    contracts.GOAL_STATUSES);
  check('dist carries the widened origin domain',
    contracts.GOAL_ORIGINS.join('|') === 'user_set|cedrus_inferred|operator_entered',
    contracts.GOAL_ORIGINS);
  check('dist carries the 280 character cap', contracts.GOAL_TEXT_MAX_CHARS === 280);
  check('dist carries the rejection scope and reason',
    contracts.REJECTION_SCOPES.join('|') === 'this_action|today'
      && contracts.REJECTION_REASONS.includes('unspecified'));
  check('dist carries the disconnected connection status',
    contracts.CONNECTION_STATUSES.includes('disconnected'));
  check('dist carries the re-derived assistant jobs',
    contracts.ASSISTANT_JOBS.join('|')
      === 'find_somewhere_to_work|suggest_for_open_window|make_or_schedule_plan|record_what_happened|answer_goal_or_progress',
    contracts.ASSISTANT_JOBS);
  check('dist carries no retired job name',
    !JSON.stringify(contracts.ASSISTANT_JOBS).includes('workday')
      && !contracts.ASSISTANT_JOBS.includes('answer_calendar_of_events'));
}

// ════════════════════════════════════════════════════════════════════════════
p('\n── 7. The shipped state ──');
{
  delete process.env.CONTRACTS_VALIDATE;
  check('CONTRACTS_VALIDATE is unset at the end of this suite (default off ships)',
    process.env.CONTRACTS_VALIDATE === undefined);
  check('BRIEF_DRY_RUN was not touched by any of this',
    process.env.BRIEF_DRY_RUN === undefined || process.env.BRIEF_DRY_RUN === 'true',
    process.env.BRIEF_DRY_RUN);
}

console.log = realConsole.log;
console.warn = realConsole.warn;
console.error = realConsole.error;
server.close();
p(`\n${failures === 0 ? 'ALL CONTRACTS-GOALS TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
