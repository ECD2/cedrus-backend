// Bundle 46 — the brief's identity comes from user_settings ROWS, never from
// an environment variable (P1.4); a missing row announces itself (B2.3); and
// resolution for one person can never answer with another's id, from a read or
// from any cache (A9).
// Run: bun test/person-settings.test.mjs
//
// What runs REAL here: personSettings.js against a fake user_settings table (a
// programmable { data, error } source with a real user_id filter and a real
// NOT NULL filter), the real resolveCosUserId() in services/cos/writer.js, and
// the real exported defaultLogRun() in jobs/cosDailyBrief.js with agent_runs
// faked at its insert seam. Nothing about the decisions under test is
// reimplemented here. The job end to end — whose records, whose ledger slot,
// whose writeback, whose spend — is proven in Bundle 38's P1.4 section, which
// drives the real runCosDailyBrief() against the same fake table.
//
// EVERY ASSERTION CARRIES A CONTROL (II.2). "B is not A" is worthless without
// "A is A" in the same test; "no warning for a present row" is the control for
// "a warning for a missing one"; "the env is not read" is asserted with the env
// SET to a nonsense value, so a code path that still reads it produces a value
// the test can see rather than an absence it cannot. test/mutate-bundle-46.sh
// breaks each guard and proves this suite goes red.

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// DYNAMIC imports: config.js calls required() at module scope, and static
// imports are hoisted above the assignments (Bundle 38's note).
const settings = await import('../src/services/cos/personSettings.js');
const writer = await import('../src/services/cos/writer.js');
const job = await import('../src/jobs/cosDailyBrief.js');
const loggerMod = await import('../src/utils/logger.js');

// Same instrument Bundle 38 arms: any field a new event hands the logger that
// the allowlist would silently drop is reported at the bottom.
loggerMod.armDropRecorder();

let failures = 0;
const p = (...a) => console.log(...a);
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };

async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (x) => { lines.push(String(x)); };
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const eventNamed = (evts, name) => evts.find((e) => e.event === name) || null;

// ── a fake user_settings table ──────────────────────────────────────────────
// Rows live in `db.rows` and can be edited between calls, which is how the
// "nothing is cached" test works. `error` makes every read fail the way
// supabase-js fails: resolved { data: null, error }, never a throw.
function fakeSettingsDb(rows = [], { error = null } = {}) {
  const log = { selects: [] };
  const db = {
    rows, log,
    from(table) {
      if (table !== 'user_settings') throw new Error('unexpected table: ' + table);
      return {
        select(cols) {
          log.selects.push(cols);
          const filters = [];
          const q = {
            eq(col, val) { filters.push((r) => String(r[col]) === String(val)); return q; },
            not(col, op, val) {
              if (op !== 'is' || val !== null) throw new Error('fake supports only .not(col, "is", null)');
              filters.push((r) => r[col] !== null && r[col] !== undefined);
              return q;
            },
            _rows() { return db.rows.filter((r) => filters.every((f) => f(r))); },
            async maybeSingle() {
              if (error) return { data: null, error };
              const m = q._rows();
              if (m.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
              return { data: m[0] ? { ...m[0] } : null, error: null };
            },
            then(resolve, reject) {
              const out = error ? { data: null, error } : { data: q._rows().map((r) => ({ ...r })), error: null };
              return Promise.resolve(out).then(resolve, reject);
            },
          };
          return q;
        },
      };
    },
  };
  return db;
}

// People (app_users.id / user_settings.user_id) and their two CoS-side ids.
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';     // never has a row
const GHOST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // has a row, both ids NULL
const COS_A = '11111111-1111-4111-8111-111111111111';
const COS_B = '22222222-2222-4222-8222-222222222222';
const USAGE_A = '33333333-3333-4333-8333-333333333333';
const USAGE_B = '44444444-4444-4444-8444-444444444444';
// The legacy per-person variables, set to values that name NOBODY. If a code
// path still reads either one, this is the value the assertions will see.
const NONSENSE_COS = 'deadbeef-dead-4ead-8ead-deaddeaddead';
const NONSENSE_USAGE = 'beefdead-beef-4eef-8eef-beefbeefbeef';
const NONSENSE_ENV = { COS_USER_ID: NONSENSE_COS, COS_BRIEF_USAGE_USER_ID: NONSENSE_USAGE };

const table = () => [
  { user_id: A, cos_user_id: COS_A, usage_user_id: USAGE_A },
  { user_id: B, cos_user_id: COS_B, usage_user_id: USAGE_B },
  { user_id: GHOST, cos_user_id: null, usage_user_id: null },
];

// ═══════════════════════════════════════════════════════════════════════════
section('readPersonSettings — one scoped read, the row or null, and an error is never null');
{
  const db = fakeSettingsDb(table());
  const rowA = await settings.readPersonSettings(A, { db });
  const rowB = await settings.readPersonSettings(B, { db });
  ok('A\'s read returns A\'s row: cos_user_id and usage_user_id', rowA && rowA.user_id === A && rowA.cos_user_id === COS_A && rowA.usage_user_id === USAGE_A, rowA);
  ok('CONTROL: B\'s read returns B\'s row — the user_id filter discriminates', rowB && rowB.user_id === B && rowB.cos_user_id === COS_B && rowB.usage_user_id === USAGE_B, rowB);
  ok('the read asks for the identity columns by name (a renamed column fails loudly)',
    db.log.selects.length >= 1 && /cos_user_id/.test(db.log.selects[0]) && /usage_user_id/.test(db.log.selects[0]), db.log.selects);
  const rowC = await settings.readPersonSettings(C, { db });
  ok('a person with no row: null', rowC === null, rowC);
  const rowG = await settings.readPersonSettings(GHOST, { db });
  ok('a person with a row whose ids are NULL: the row, with NULLs (not null — the row exists)', rowG && rowG.user_id === GHOST && rowG.cos_user_id === null, rowG);

  let refused = null;
  try { await settings.readPersonSettings('', { db }); } catch (e) { refused = e; }
  ok('a blank id is REFUSED (an unscoped read is unexpressible)', refused && /required/.test(refused.message), refused && refused.message);
  refused = null;
  try { await settings.readPersonSettings(undefined, { db }); } catch (e) { refused = e; }
  ok('an undefined id is REFUSED', refused && /required/.test(refused.message));

  const broken = fakeSettingsDb(table(), { error: { code: '42703', message: 'column user_settings.cos_user_id does not exist' } });
  let threw = null; let got = 'not-set';
  try { got = await settings.readPersonSettings(A, { db: broken }); } catch (e) { threw = e; }
  ok('a read ERROR throws, carrying the SQLSTATE — it is never returned as null', threw && threw.code === '42703' && got === 'not-set', { threw: threw && threw.message, got });
}

// ═══════════════════════════════════════════════════════════════════════════
section('listCosIdentityHolders — who holds a CoS identity: rows with a cos_user_id, nobody else');
{
  const db = fakeSettingsDb(table());
  const holders = await settings.listCosIdentityHolders({ db });
  ok('the two bound people are listed', holders.length === 2 && holders.includes(A) && holders.includes(B), holders);
  ok('CONTROL: the ghost has a row and is NOT listed — a NULL cos_user_id is not an identity', !holders.includes(GHOST), holders);
  ok('an empty table lists nobody', (await settings.listCosIdentityHolders({ db: fakeSettingsDb([]) })).length === 0);
  let threw = null;
  try { await settings.listCosIdentityHolders({ db: fakeSettingsDb([], { error: { code: '42P01', message: 'relation "user_settings" does not exist' } }) }); } catch (e) { threw = e; }
  ok('an unreadable table THROWS with its SQLSTATE — it is never "nobody"', threw && threw.code === '42P01', threw && threw.message);
}

// ═══════════════════════════════════════════════════════════════════════════
section('A9 — resolveCosUserId for A, then B, then a third person: never one person\'s id for another');
{
  const db = fakeSettingsDb(table());

  const ra = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: A, db });
  const rb = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: B, db });
  ok('A resolves from A\'s row: cos_user_id, source settings, usage_user_id alongside',
    ra.userId === COS_A && ra.source === 'settings' && ra.usageUserId === USAGE_A, ra);
  ok('B, resolved NEXT in the same process, resolves from B\'s row',
    rb.userId === COS_B && rb.source === 'settings' && rb.usageUserId === USAGE_B, rb);
  ok('A9: the two answers differ — B was not answered from A', ra.userId !== rb.userId && ra.usageUserId !== rb.usageUserId);
  ok('P1.4: with COS_USER_ID set to nonsense, neither answer is the nonsense', ra.userId !== NONSENSE_COS && rb.userId !== NONSENSE_COS);

  // Nothing is cached: change A's row between two calls and the second call
  // must see the change. A memo of any kind — per person or global — would
  // return the first answer.
  const COS_A2 = '55555555-5555-4555-8555-555555555555';
  db.rows.find((r) => r.user_id === A).cos_user_id = COS_A2;
  const ra2 = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: A, db });
  ok('nothing is cached: A\'s row changed and the next resolution reads the change', ra2.userId === COS_A2, ra2);
  db.rows.find((r) => r.user_id === A).cos_user_id = COS_A;
  const ra3 = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: A, db });
  ok('CONTROL: restored, it reads the original again', ra3.userId === COS_A, ra3);

  // A third person with NO row. With no env and CoS disarmed there is nothing
  // to fall back to, so the refusal is visible as null — and it must never be
  // A's id, which is what a process-global slot would hand out here.
  let rc;
  const cEvents = await captureLogs(async () => { rc = await writer.resolveCosUserId({ env: {}, personId: C, db }); });
  ok('A9: a third person with no row is NOT handed A\'s (or B\'s) id', rc.userId !== COS_A && rc.userId !== COS_B && rc.source !== 'settings', rc);
  ok('...the refusal is null — not a guess', rc.userId === null, rc);
  const missing = eventNamed(cEvents, 'cos.owner.settings_missing');
  ok('B2.3: the missing row is ANNOUNCED at warn, naming the person',
    missing && missing.level === 'warn' && missing.outcome === 'no_row' && missing.message.includes(C), missing);

  let rg;
  const gEvents = await captureLogs(async () => { rg = await writer.resolveCosUserId({ env: {}, personId: GHOST, db }); });
  const nullId = eventNamed(gEvents, 'cos.owner.settings_missing');
  ok('B2.3: a row whose cos_user_id is NULL is announced too, distinguishably (null_id), naming the person',
    rg.userId === null && nullId && nullId.outcome === 'null_id' && nullId.message.includes(GHOST), nullId);

  const aEvents = await captureLogs(() => writer.resolveCosUserId({ env: {}, personId: A, db }));
  ok('B2.3 CONTROL: a present row emits neither settings_missing nor settings_unreadable',
    !eventNamed(aEvents, 'cos.owner.settings_missing') && !eventNamed(aEvents, 'cos.owner.settings_unreadable'), aEvents.map((e) => e.event));

  // Until the P1.3 backfill: a missing row falls back to COS_USER_ID, and the
  // label says so. This is the transitional shape and its label is the proof
  // it is transitional — cos.brief.written will read "owner id source: env".
  const rcEnv = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: C, db });
  ok('until the backfill: a missing row falls back to COS_USER_ID and SAYS SO (source env, never settings)',
    rcEnv.userId === NONSENSE_COS && rcEnv.source === 'env', rcEnv);

  // The caller-supplied branch is unchanged: an id the caller resolved wins,
  // with the caller's own label, and no row is read for it.
  const told = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: A, cosUserId: 'told-id', cosUserSource: 'env', db });
  ok('a caller-supplied id still wins over the person\'s row, with the caller\'s label (unchanged branch)',
    told.userId === 'told-id' && told.source === 'env', told);

  // Unreadable is not missing.
  const broken = fakeSettingsDb(table(), { error: { code: '42P01', message: 'relation "user_settings" does not exist' } });
  let ru;
  const uEvents = await captureLogs(async () => { ru = await writer.resolveCosUserId({ env: NONSENSE_ENV, personId: A, db: broken }); });
  const unreadable = eventNamed(uEvents, 'cos.owner.settings_unreadable');
  ok('an UNREADABLE row is announced as settings_unreadable at error with the SQLSTATE — never as missing',
    unreadable && unreadable.level === 'error' && unreadable.error_code === '42P01' && unreadable.message.includes(A) &&
    !eventNamed(uEvents, 'cos.owner.settings_missing'), uEvents.map((e) => e.event));
  ok('until the backfill: unreadable also falls back to env, labelled env', ru.userId === NONSENSE_COS && ru.source === 'env', ru);
}

// ═══════════════════════════════════════════════════════════════════════════
section('defaultLogRun — the spend is billed to the ROW\'s usage_user_id, and says which path ran');
{
  const calls = [];
  const record = async (a) => { calls.push(a); };
  const base = { model: 'gpt-4.1-mini', usage: { prompt_tokens: 10, completion_tokens: 5 }, latencyMs: 42, record };

  const e1 = await captureLogs(() => job.defaultLogRun({ ...base, env: NONSENSE_ENV, usageUserId: USAGE_A }));
  const rec1 = eventNamed(e1, 'cos.usage.recorded');
  ok('the spend row is written against the ROW\'s usage_user_id, not COS_BRIEF_USAGE_USER_ID',
    calls.length === 1 && calls[0].userId === USAGE_A && calls[0].runType === 'cos_daily_brief' && calls[0].promptTokens === 10, calls[0]);
  ok('...and announces its source: settings', rec1 && rec1.outcome === 'settings' && /usage id source: settings/.test(rec1.message), rec1);
  ok('...and does NOT say unrecorded', !eventNamed(e1, 'cos.usage.unrecorded'));

  calls.length = 0;
  const e2 = await captureLogs(() => job.defaultLogRun({ ...base, env: NONSENSE_ENV, usageUserId: null }));
  const rec2 = eventNamed(e2, 'cos.usage.recorded');
  ok('CONTROL, until the backfill: no row id ⇒ COS_BRIEF_USAGE_USER_ID, announced as env',
    calls.length === 1 && calls[0].userId === NONSENSE_USAGE && rec2 && rec2.outcome === 'env', { calls, rec2 });

  calls.length = 0;
  const e3 = await captureLogs(() => job.defaultLogRun({ ...base, env: {}, usageUserId: null }));
  ok('neither ⇒ nothing recorded, and the job SAYS SO (cos.usage.unrecorded, warn)',
    calls.length === 0 && eventNamed(e3, 'cos.usage.unrecorded') && eventNamed(e3, 'cos.usage.unrecorded').level === 'warn', e3.map((e) => e.event));
}

// ═══════════════════════════════════════════════════════════════════════════
section('the logger allowlist — no new event silently lost a field');
{
  const seen = loggerMod.dropRecordsSeen();
  const lost = loggerMod.dropRecords();
  ok('CONTROL: the recorder saw this suite\'s events', seen > 0, seen);
  ok('no event emitted by this suite dropped a field to the allowlist', lost.length === 0, lost);
}

p('');
if (failures === 0) p('ALL PERSON-SETTINGS TESTS PASSED');
else { p(failures + ' TEST(S) FAILED'); process.exit(1); }
