// Bundle 43 — programs data foundation (BUILD_PLAN R6.2a).
// Run: bun test/programs-foundation.test.mjs
//
// WHAT THIS SUITE IS FOR
// Three additive tables with the interface's approved columns, RLS enabled
// AND forced, user_id everywhere; a publish that is one transaction and is
// idempotent BY THE DATABASE; a today's-program block computed from rows for
// one owner in each program's own time zone. Every claim below runs against
// a REAL Postgres (PGlite, in-process) with the REAL migration files applied
// — foundation, provision_user, programs — and every "nothing" has a control:
//
//   user B reads ZERO of A's rows      alongside   A reads them
//   the table OWNER reads zero          alongside   the superuser reads them
//   the same source twice: ONE revision alongside   a changed source: TWO
//   B gets NO today's-program block     alongside   A gets one
//
// WHAT RUNS REAL HERE
//   • the three migrations, verbatim, including their in-transaction self-proof
//   • src/services/programs/compile.js on the two synthetic fixtures
//   • src/services/programs/publish.js through a client whose rpc() runs the
//     real function on the real database
//   • src/services/programs/today.js, the reader and the block formatter
//   • src/jobs/cosDailyBrief.js, the real job, with the CoS side faked as in
//     Bundle 38 and the program side REAL against the database
//   • scripts/load-program.mjs, SPAWNED, to read its exit codes
//
// WHAT IS A FIXTURE (Lesson 20): app_users, auth.users, auth.identities, the
// three API roles and auth.uid() — recreated from what this repo's code writes
// and reads. auth.uid() here reads request.jwt.claim.sub so a test can BE a
// signed-in person by setting one GUC, which is how Supabase's own does it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// DYNAMIC imports: config.js calls required() at module scope (bundles 36–42).
const compile = await import('../src/services/programs/compile.js');
const { publishProgramRevision, PUBLISH_RPC } = await import('../src/services/programs/publish.js');
const { readTodaysProgram, computeTodaysProgram, resolveProgramOwner, TODAY_RPC } = await import('../src/services/programs/today.js');
const { runCosDailyBrief } = await import('../src/jobs/cosDailyBrief.js');
const { renderBriefEmail } = await import('../src/services/cos/renderer.js');
const ledger = await import('../src/services/cos/ledger.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SQL = (f) => readFileSync(join(REPO, 'supabase/migrations', f), 'utf8');
const FIXTURE = (f) => readFileSync(join(REPO, 'test/fixtures/programs', f), 'utf8');

const p = console.log;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };
function finish() {
  p('');
  if (failures) { p(`BUNDLE 43: ${failures} FAILURE(S)`); process.exit(1); }
  p('BUNDLE 43: ALL PASSED');
  process.exit(0);
}

p('=== Bundle 43 — programs data foundation (R6.2a) ===');

// ── the database ────────────────────────────────────────────────────────────
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const count = async (sql, params) => Number((await one(`select count(*)::int as n from ${sql}`, params)).n);

const A_AUTH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_AUTH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const FIXTURE_SQL = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
-- Supabase's auth.uid() reads the JWT claim; here the claim is a GUC a test sets.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  phone text unique default null, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  confirmation_token varchar(255), recovery_token varchar(255), email_change_token_new varchar(255), email_change varchar(255),
  created_at timestamptz, updated_at timestamptz
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, created_at timestamptz, updated_at timestamptz,
  unique (provider_id, provider)
);
create table app_users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  timezone text not null default 'America/New_York',
  auth_user_id uuid,
  sms_consent_at timestamptz, consent_source text,
  trial_ends_at timestamptz not null default now() + interval '14 days',
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into auth.users (id, phone) values ('${A_AUTH}', '17860000001'), ('${B_AUTH}', '17860000002');
insert into app_users (phone, name, auth_user_id, created_at) values
  ('17860000001', 'Emil', '${A_AUTH}', now() - interval '2 days'),
  ('17860000002', 'Person B', '${B_AUTH}', now() - interval '1 day');
`;

let applied = false; let applyError = null;
try {
  await db.exec(FIXTURE_SQL);
  await db.exec(SQL('20260830120000_multiuser_foundation.sql'));
  await db.exec(`update app_users set role = 'admin' where phone = '17860000001';`);
  await db.exec(SQL('20260909120000_provision_user.sql'));
  await db.exec(SQL('20260909180000_programs_foundation.sql'));
  applied = true;
} catch (e) { applyError = { message: e.message, code: e.code, detail: e.detail }; }

section('the migrations, with their own in-transaction self-proof');
ok('foundation, provision_user and programs migrations all applied — every assertion and control inside them passed', applied, applyError);
if (!applied) finish();

const A = (await one(`select id from app_users where phone = '17860000001'`)).id;
const B = (await one(`select id from app_users where phone = '17860000002'`)).id;

ok('the programs migration\'s controls left no rows behind (0 programs, 0 revisions, 0 items)',
  (await count('programs')) === 0 && (await count('program_revisions')) === 0 && (await count('program_items')) === 0);

// ═══════════════════════════════════════════════════════════════════════════
section('the contract — exactly these columns, DATE not timestamp, RLS forced, no anon');
{
  const cols = async (t) => (await all(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name`, [t]));
  const names = (rows) => rows.map((r) => r.column_name).join(',');
  ok('programs: id, user_id, kind, title, description, start_date, end_date, time_zone, current_revision_id, status — nothing else',
    names(await cols('programs')) === 'current_revision_id,description,end_date,id,kind,start_date,status,time_zone,title,user_id', names(await cols('programs')));
  ok('program_revisions: id, user_id, program_id, revision_number, created_at, source_name, source_text, source_sha256, supersedes_revision_id',
    names(await cols('program_revisions')) === 'created_at,id,program_id,revision_number,source_name,source_sha256,source_text,supersedes_revision_id,user_id', names(await cols('program_revisions')));
  ok('program_items: the twenty contract columns including item_key, scheduled_date, category, the planned/proposed/actual triplets, source_locator, reminder_id',
    names(await cols('program_items')) === 'actual_duration_minutes,actual_finished_at,actual_note,actual_started_at,category,id,instructions,item_key,planned_duration_minutes,planned_start_local,program_id,program_revision_id,proposed_duration_minutes,proposed_start_at,reminder_id,scheduled_date,source_locator,status,title,user_id', names(await cols('program_items')));
  const sd = (await cols('program_items')).find((c) => c.column_name === 'scheduled_date');
  ok('program_items.scheduled_date is a DATE, never a timestamp', sd && sd.data_type === 'date', sd);
  const ends = (await cols('programs')).filter((c) => ['start_date', 'end_date'].includes(c.column_name));
  ok('programs.start_date and end_date are DATEs', ends.length === 2 && ends.every((c) => c.data_type === 'date'), ends);

  const rls = await all(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('programs','program_revisions','program_items') order by relname`);
  ok('RLS is enabled AND forced on all three tables', rls.length === 3 && rls.every((r) => r.relrowsecurity && r.relforcerowsecurity), rls);
  const pol = await all(`select tablename, policyname, cmd, roles from pg_policies where tablename in ('programs','program_revisions','program_items') order by tablename`);
  ok('exactly three policies, all SELECT, all to authenticated only — none names anon or public',
    pol.length === 3 && pol.every((x) => x.cmd === 'SELECT' && x.roles.length === 1 && x.roles[0] === 'authenticated'), pol);
  const anonPrivs = await count(`information_schema.table_privileges where table_schema = 'public' and table_name in ('programs','program_revisions','program_items') and grantee = 'anon'`);
  ok('anon holds no privilege on any program table', anonPrivs === 0, anonPrivs);

  const chk = await one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'program_items_category_check'`);
  const inDb = [...(chk.def.matchAll(/'([a-z_]+)'/g))].map((m) => m[1]).sort();
  ok('the compiler\'s CATEGORIES mirror is byte-identical to program_items_category_check (Lesson 20: the two copies are tested to agree)',
    JSON.stringify(inDb) === JSON.stringify([...compile.CATEGORIES].sort()), { inDb, compiler: [...compile.CATEGORIES].sort() });
  const uq = await one(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'program_revisions_program_id_source_sha256_key'`);
  ok('UNIQUE (program_id, source_sha256) exists on program_revisions', !!uq && /UNIQUE \(program_id, source_sha256\)/.test(uq.def), uq);

  const fns = await all(`select proname, prosecdef, proconfig,
      has_function_privilege('anon', oid, 'execute') as anon,
      has_function_privilege('authenticated', oid, 'execute') as authenticated,
      has_function_privilege('service_role', oid, 'execute') as service_role
    from pg_proc where proname in ('publish_program_revision','todays_program_items') order by proname`);
  ok('both functions: SECURITY DEFINER, search_path pinned, execute anon NO / authenticated NO / service_role YES',
    fns.length === 2 && fns.every((f) => f.prosecdef && f.proconfig.includes('search_path=public, pg_temp') && !f.anon && !f.authenticated && f.service_role), fns);
}

// ═══════════════════════════════════════════════════════════════════════════
section('compile — the day count is derived from the source\'s own dates');
const TRAINING = FIXTURE('miami-man-2026.synthetic.txt');
const ROUTINE = FIXTURE('care-routine.synthetic.txt');
let training; let routine;
{
  training = compile.compileSource(TRAINING, { sourceName: 'miami-man-2026.synthetic.txt' });
  const s = training.stats;
  ok('training: start and end come from the source header (2026-09-08 .. 2026-11-15)',
    s.start_date === '2026-09-08' && s.end_date === '2026-11-15' && /source header/.test(s.dates_from), s);
  ok('training: days is derived — end_date - start_date + 1 = 69, not the handoff\'s 70',
    s.days === 69 && compile.daysInclusive('2026-09-08', '2026-11-15') === 69, s.days);
  ok('training: rows == days (69 == 69), every day covered, one item per day', s.rows === 69 && s.distinct_dates === 69 && s.rows === s.days, s);
  const sum = Object.values(s.per_category).reduce((a, b) => a + b, 0);
  ok('training: per-category counts sum to the row count and use only the closed union',
    sum === 69 && Object.keys(s.per_category).every((c) => compile.CATEGORIES.includes(c)), s.per_category);
  ok('training: the sha256 is of the exact source text', training.source.sha256 === compile.sha256Hex(TRAINING) && /^[0-9a-f]{64}$/.test(training.source.sha256));
  ok('training: every item is dated inside the plan and carries a stable item_key and a source locator',
    training.items.every((i) => i.scheduled_date >= '2026-09-08' && i.scheduled_date <= '2026-11-15' && /^\d{4}-\d{2}-\d{2}:[a-z_]+:/.test(i.item_key) && /^line \d+$/.test(i.source_locator)));

  // A source whose dates say otherwise WINS: header removed, the dates come from the lines.
  const noHeader = TRAINING.split('\n').filter((l) => !/^(start|end):/.test(l)).join('\n');
  const t2 = compile.compileSource(noHeader, { sourceName: 'x' });
  ok('training: without a header, start/end come from the earliest and latest item line and days is still 69',
    t2.stats.start_date === '2026-09-08' && t2.stats.end_date === '2026-11-15' && t2.stats.days === 69 && /item lines/.test(t2.stats.dates_from), t2.stats);
  const shorter = TRAINING.replace('end: 2026-11-15', 'end: 2026-11-14').split('\n').filter((l) => !l.startsWith('2026-11-15')).join('\n');
  const t3 = compile.compileSource(shorter, { sourceName: 'x' });
  ok('control: a source ending a day earlier derives 68 days and 68 rows — the count follows the source, not this suite', t3.stats.days === 68 && t3.stats.rows === 68, t3.stats);

  let gapErr = null;
  try { compile.compileSource(TRAINING.split('\n').filter((l) => !l.startsWith('2026-10-01')).join('\n'), { sourceName: 'x' }); } catch (e) { gapErr = e.message; }
  ok('a plan with a day missing is refused, naming the first missing day', !!gapErr && /2026-10-01/.test(gapErr) && /no item/.test(gapErr), gapErr);
  let catErr = null;
  try { compile.compileSource(TRAINING.replace('| swim ', '| yoga '), { sourceName: 'x' }); } catch (e) { catErr = e.message; }
  ok('a category outside the closed union is refused by name, with the line number', !!catErr && /yoga/.test(catErr) && /^line \d+/.test(catErr), catErr);
  let outsideErr = null;
  try { compile.compileSource(TRAINING.replace('end: 2026-11-15', 'end: 2026-11-10'), { sourceName: 'x' }); } catch (e) { outsideErr = e.message; }
  ok('an item outside the header\'s dates is refused', !!outsideErr && /outside/.test(outsideErr), outsideErr);

  routine = compile.compileSource(ROUTINE, { sourceName: 'care-routine.synthetic.txt', start: '2026-09-09' });
  const r = routine.stats;
  ok('routine: the source is dateless; start comes from --start, end_date is NULL (open-ended)',
    r.start_date === '2026-09-09' && r.end_date === null && routine.program.end_date === null && /--start/.test(r.dates_from), r);
  ok('routine: 28-day horizon materialised, 84 rows over 28 distinct dates (2 daily + weekday extras)',
    r.days === 28 && r.distinct_dates === 28 && r.rows === 84, r);
  ok('routine: a Monday carries shampoo and condition, a Sunday carries oil, every day carries two face items',
    routine.items.filter((i) => i.scheduled_date === '2026-09-14').map((i) => i.category).sort().join(',') === 'condition,face,face,shampoo'
      && routine.items.filter((i) => i.scheduled_date === '2026-09-13').some((i) => i.category === 'oil'));
  const rToday = compile.compileSource(ROUTINE, { sourceName: 'x', now: new Date('2026-09-15T03:30:00Z') });
  ok('routine: with no start anywhere, start is TODAY in the program\'s zone — 03:30Z on the 15th is still the 14th in New York',
    rToday.stats.start_date === '2026-09-14' && /today in America\/New_York/.test(rToday.stats.dates_from), rToday.stats);
  let startErr = null;
  try { compile.compileSource(TRAINING, { sourceName: 'x', start: '2026-09-01' }); } catch (e) { startErr = e.message; }
  ok('--start is refused for a training plan (its dates are its own)', !!startErr && /--start/.test(startErr), startErr);
}

// ── the client: rpc() runs the real function on the real database ───────────
const calls = [];
function makeClient() {
  return {
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args: { ...args } });
      const keys = Object.keys(args);
      const cast = (k) => (k === 'p_items' ? '::jsonb' : /_id$/.test(k) ? '::uuid' : /_date$/.test(k) ? '::date' : k === 'p_at' ? '::timestamptz' : '::text');
      const named = keys.map((k, i) => `${k} => $${i + 1}${cast(k)}`).join(', ');
      try {
        if (name === TODAY_RPC) {
          const r = await db.query(`select * from ${name}(${named})`, keys.map((k) => args[k]));
          return { data: r.rows, error: null };
        }
        const r = await db.query(`select ${name}(${named}) as data`, keys.map((k) => k === 'p_items' ? JSON.stringify(args[k]) : args[k]));
        return { data: r.rows[0].data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } };
      }
    },
  };
}
const client = makeClient();
const publish = (compiled, userId) => publishProgramRevision(compiled, { userId, db: client });
async function attempt(fn) { try { return { result: await fn(), error: null }; } catch (e) { return { result: null, error: e }; } }

// ═══════════════════════════════════════════════════════════════════════════
section('publish — the same source twice creates ONE revision; a changed source creates a second, superseding the first');
let rev1; let rev2; let programId;
{
  calls.length = 0;
  const first = await attempt(() => publish(training, A));
  ok('publishing the synthetic training plan for A resolves', !first.error, first.error && { message: first.error.message, code: first.error.code });
  rev1 = first.result;
  programId = rev1 && rev1.program_id;
  ok('revision 1: 69 items, no supersedes, sha matches the compiler\'s (the DB hashed the stored text itself)',
    !!rev1 && rev1.revision_number === 1 && rev1.items === 69 && rev1.supersedes_revision_id === null && rev1.source_sha256 === training.source.sha256, rev1);
  ok('the JS caller made exactly ONE rpc call — no second write anywhere', calls.length === 1 && calls[0].kind === 'rpc' && calls[0].name === PUBLISH_RPC, calls.map((c) => c.name));
  const prog = rev1 && await one(`select user_id, kind, title, start_date::text as s, end_date::text as e, time_zone, current_revision_id, status from programs where id = $1`, [programId]);
  ok('the program row: A\'s, training, Miami Man 2026 (synthetic), 2026-09-08..2026-11-15, America/New_York, active, current = revision 1',
    !!prog && prog.user_id === A && prog.kind === 'training' && prog.title === 'Miami Man 2026 (synthetic)' && prog.s === '2026-09-08' && prog.e === '2026-11-15'
      && prog.time_zone === 'America/New_York' && prog.status === 'active' && prog.current_revision_id === rev1.revision_id, prog);
  const stored = rev1 && await one(`select source_name, source_text, source_sha256 from program_revisions where id = $1`, [rev1.revision_id]);
  ok('the source is stored VERBATIM on the revision, with its name', !!stored && stored.source_text === TRAINING && stored.source_name === 'miami-man-2026.synthetic.txt');
  ok('every item of revision 1 belongs to A, is planned, and has NULL actuals',
    rev1 && (await count(`program_items where program_revision_id = $1 and user_id = $2 and status = 'planned' and actual_started_at is null and actual_finished_at is null and actual_duration_minutes is null and actual_note is null`, [rev1.revision_id, A])) === 69);
  ok('the DB\'s item count for the plan equals the derived day count (69 = 69), with 69 distinct dates',
    rev1 && (await count('program_items where program_revision_id = $1', [rev1.revision_id])) === training.stats.days
      && Number((await one('select count(distinct scheduled_date)::int as n from program_items where program_revision_id = $1', [rev1.revision_id])).n) === 69);

  // THE IDEMPOTENCY RULE — same bytes again
  calls.length = 0;
  const again = await attempt(() => publish(training, A));
  ok('the SAME source again is refused with 23505 and alreadyPublished, naming revision 1',
    !!again.error && again.error.code === '23505' && again.error.alreadyPublished === true && /already published as revision 1/.test(again.error.message),
    again.error && { code: again.error.code, message: again.error.message });
  ok('the same source twice creates ONE revision (still 1), 69 items (not 138), current_revision_id unchanged',
    (await count('program_revisions where program_id = $1', [programId])) === 1
      && (await count('program_items where program_id = $1', [programId])) === 69
      && (await one('select current_revision_id from programs where id = $1', [programId])).current_revision_id === rev1.revision_id);

  // mark something done in revision 1, then CHANGE the source — the control
  await db.query(`update program_items set status = 'completed', actual_duration_minutes = 42, actual_note = 'felt good' where program_revision_id = $1 and scheduled_date = '2026-09-08'`, [rev1.revision_id]);
  const changedText = TRAINING.replaceAll('Trainer intervals       | 06:15 | 60', 'Trainer intervals       | 06:00 | 75');
  const changedLines = changedText.split('\n').filter((l, i) => l !== TRAINING.split('\n')[i]).length;
  ok('(the changed source really differs: the nine 60-minute Tuesday bike lines, and nothing else)', changedLines === 9 && changedText.split('\n').length === TRAINING.split('\n').length, changedLines);
  const changed = compile.compileSource(changedText, { sourceName: 'miami-man-2026.v2.txt' });
  const second = await attempt(() => publish(changed, A));
  rev2 = second.result;
  ok('control: a CHANGED source creates revision 2 with supersedes_revision_id = revision 1',
    !second.error && !!rev2 && rev2.revision_number === 2 && rev2.supersedes_revision_id === rev1.revision_id && rev2.program_id === programId, second.error && second.error.message);
  ok('current_revision_id now points at revision 2; both revisions exist (2), items 138 (69 + 69)',
    (await one('select current_revision_id from programs where id = $1', [programId])).current_revision_id === rev2.revision_id
      && (await count('program_revisions where program_id = $1', [programId])) === 2
      && (await count('program_items where program_id = $1', [programId])) === 138);
  ok('actuals do NOT carry: every revision-2 item starts at planned with NULL actuals, including 2026-09-08 which was completed in revision 1',
    (await count(`program_items where program_revision_id = $1 and (status <> 'planned' or actual_note is not null or actual_duration_minutes is not null)`, [rev2.revision_id])) === 0
      && (await one(`select status from program_items where program_revision_id = $1 and scheduled_date = '2026-09-08'`, [rev2.revision_id])).status === 'planned');
  ok('control: revision 1\'s completed item is untouched by publishing revision 2',
    (await one(`select status, actual_note from program_items where program_revision_id = $1 and scheduled_date = '2026-09-08'`, [rev1.revision_id])).actual_note === 'felt good');
  ok('item_key is stored and stable across revisions for a later carry-forward (the 2026-09-08 keys match)',
    (await one(`select item_key from program_items where program_revision_id = $1 and scheduled_date = '2026-09-08'`, [rev1.revision_id])).item_key
      === (await one(`select item_key from program_items where program_revision_id = $1 and scheduled_date = '2026-09-08'`, [rev2.revision_id])).item_key);

  // the routine
  const r = await attempt(() => publish(routine, A));
  ok('publishing the synthetic routine for A resolves: revision 1, 84 items, end_date NULL',
    !r.error && r.result.revision_number === 1 && r.result.items === 84
      && (await one('select end_date from programs where id = $1', [r.result.program_id])).end_date === null, r.error && r.error.message);
  ok('A now owns two programs (Miami Man 2026 training, Care routine) — the two decided for day one', (await count('programs where user_id = $1', [A])) === 2);

  // refusals that write nothing
  const before = { p: await count('programs'), r: await count('program_revisions'), i: await count('program_items') };
  const noOwner = await attempt(() => publishProgramRevision(training, { db: client }));
  ok('a missing owner is refused by the caller before any rpc', !!noOwner.error && /userId/.test(noOwner.error.message));
  const ghost = await attempt(() => publish(routine, '00000000-0000-0000-0000-00000000dead'));
  ok('an unknown owner is refused by the database with 23503', !!ghost.error && ghost.error.code === '23503', ghost.error && ghost.error.code);
  const after = { p: await count('programs'), r: await count('program_revisions'), i: await count('program_items') };
  ok('the refused calls wrote nothing', JSON.stringify(before) === JSON.stringify(after), { before, after });
}

// ═══════════════════════════════════════════════════════════════════════════
section('owner consistency — a row cannot belong to a different person than its program');
{
  let code = null;
  try {
    await db.query(`insert into program_items (user_id, program_id, program_revision_id, item_key, scheduled_date, category, title)
                    values ($1, $2, $3, 'smuggled', '2026-09-08', 'swim', 'smuggled')`, [B, programId, rev2.revision_id]);
  } catch (e) { code = e.code; }
  ok('an item cannot belong to B while its program belongs to A (composite FK, 23503)', code === '23503', code);
  ok('control: nothing of B\'s exists in program_items', (await count('program_items where user_id = $1', [B])) === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section('cross-user isolation through RLS — B reads zero of A\'s rows, and the SAME query returns them for A');
const asUser = async (authId, fn) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${authId}';`);
  try { return await fn(); } finally { await db.exec(`reset role; set request.jwt.claim.sub = '';`); }
};
{
  const readAll = async () => ({
    programs: await count('programs'), revisions: await count('program_revisions'), items: await count('program_items'),
    aItems: await count('program_items where user_id = $1', [A]),
  });
  const seenByB = await asUser(B_AUTH, readAll);
  const seenByA = await asUser(A_AUTH, readAll);
  ok('user B, signed in, reads ZERO programs, revisions and items (all of them are A\'s)',
    seenByB.programs === 0 && seenByB.revisions === 0 && seenByB.items === 0 && seenByB.aItems === 0, seenByB);
  ok('control: user A, through the identical query, reads 2 programs, 3 revisions and 222 items (69 + 69 + 84)',
    seenByA.programs === 2 && seenByA.revisions === 3 && seenByA.items === 222 && seenByA.aItems === 222, seenByA);
  let writeCode = null;
  try { await asUser(A_AUTH, () => db.query(`update program_items set status = 'completed' where program_revision_id = $1`, [rev2.revision_id])); } catch (e) { writeCode = e.code; }
  ok('even the owner cannot write through the publishable role (no UPDATE policy/grant) — 42501', writeCode === '42501', writeCode);
  const unauth = await asUser('', readAll);
  ok('no JWT at all reads zero of everything', unauth.programs === 0 && unauth.items === 0, unauth);
}

// ═══════════════════════════════════════════════════════════════════════════
section('forced RLS — the table OWNER reads zero (no policy applies to it), and the superuser reads everything');
{
  const superRows = await count('program_items');
  await db.exec(`create role cedrus_owner nologin;
                 alter table programs owner to cedrus_owner;
                 alter table program_revisions owner to cedrus_owner;
                 alter table program_items owner to cedrus_owner;
                 set role cedrus_owner;`);
  let ownerRows = null; let ownerErr = null;
  try { ownerRows = await count('program_items'); } catch (e) { ownerErr = e.message; }
  await db.exec(`reset role;
                 alter table programs owner to postgres;
                 alter table program_revisions owner to postgres;
                 alter table program_items owner to postgres;`);
  ok('the table OWNER reads zero of A\'s items — forced RLS filters even the owner',
    ownerRows === 0 && ownerErr === null, { ownerRows, ownerErr });
  ok('control: the superuser (bypasses RLS) reads all 222 in the same table', superRows === 222, superRows);
}

// ═══════════════════════════════════════════════════════════════════════════
section('today\'s program — one owner\'s items for the day it is in the program\'s time zone');
{
  // 2026-09-15 12:00Z is Tue 2026-09-15 08:00 in New York: the plan's Tuesday
  // (bike, per the changed revision 2: 06:00, 75 min) and the routine's two face items.
  const aToday = await all(`select * from todays_program_items($1, $2)`, [A, '2026-09-15T12:00:00Z']);
  ok('A at 2026-09-15T12:00Z gets 3 items: the plan\'s Tuesday bike (from revision 2, the CURRENT one) and the routine\'s two face items',
    aToday.length === 3 && aToday.filter((r) => r.category === 'bike').length === 1 && aToday.filter((r) => r.category === 'face').length === 2
      && aToday.find((r) => r.category === 'bike').planned_start_local === '06:00' && aToday.find((r) => r.category === 'bike').planned_duration_minutes === 75,
    aToday.map((r) => [r.program_title, r.category, r.planned_start_local]));
  ok('every returned row carries local_date \'2026-09-15\' as text and the program\'s time zone', aToday.every((r) => r.local_date === '2026-09-15' && r.time_zone === 'America/New_York'), aToday.map((r) => r.local_date));
  const bToday = await all(`select * from todays_program_items($1, $2)`, [B, '2026-09-15T12:00:00Z']);
  ok('control: B at the same instant gets ZERO rows', bToday.length === 0, bToday.length);

  // the time-zone edge: 03:30Z on the 15th is 23:30 on the 14th in New York
  const late = await all(`select category from todays_program_items($1, $2)`, [A, '2026-09-15T03:30:00Z']);
  ok('at 2026-09-15T03:30Z the day is still MONDAY the 14th in New York: swim + shampoo + condition + 2 face, no bike',
    late.map((r) => r.category).sort().join(',') === 'condition,face,face,shampoo,swim', late.map((r) => r.category));
  const early = await all(`select category from todays_program_items($1, $2)`, [A, '2026-09-15T04:30:00Z']);
  ok('control: one hour later (04:30Z = 00:30 local) it is Tuesday: bike + 2 face', early.map((r) => r.category).sort().join(',') === 'bike,face,face', early.map((r) => r.category));
  let nullErr = null;
  try { await all(`select * from todays_program_items(null, now())`); } catch (e) { nullErr = e.code; }
  ok('a NULL owner returns nothing (the WHERE refuses it) rather than everything', nullErr === null && (await all(`select * from todays_program_items(null, now())`)).length === 0);
  const paused = await db.query(`update programs set status = 'paused' where user_id = $1 and kind = 'routine'`, [A]);
  const pausedToday = await all(`select category from todays_program_items($1, $2)`, [A, '2026-09-15T12:00:00Z']);
  ok('a PAUSED program contributes nothing; the training plan still does (1 row)', paused.affectedRows === 1 && pausedToday.length === 1 && pausedToday[0].category === 'bike');
  await db.query(`update programs set status = 'active' where user_id = $1 and kind = 'routine'`, [A]);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the brief block — computed from rows, first in the email, and a second user with no items gets NO block');
{
  const at = new Date('2026-09-15T12:00:00Z');
  const readA = await readTodaysProgram({ appUserId: A, at, db: client });
  const readB = await readTodaysProgram({ appUserId: B, at, db: client });
  ok('readTodaysProgram for A: ok, 3 rows, through ONE rpc to todays_program_items', readA.ok && readA.rows.length === 3 && calls.filter((c) => c.name === TODAY_RPC).length === 2, readA.error);
  ok('readTodaysProgram for B: ok, 0 rows', readB.ok && readB.rows.length === 0, readB.error);
  const linesA = computeTodaysProgram(readA.rows);
  const linesB = computeTodaysProgram(readB.rows);
  ok('A\'s block: a header line per program and one line per item — 2 programs, 3 items, 5 lines',
    linesA.length === 5 && linesA.filter((l) => !l.startsWith('  ')).length === 2 && linesA.some((l) => /^Miami Man 2026 \(synthetic\) \(training\) — Tue 2026-09-15 in America\/New_York: 1 item\.$/.test(l))
      && linesA.some((l) => /^Care routine \(synthetic\) \(routine\) — Tue 2026-09-15 in America\/New_York: 2 items\.$/.test(l))
      && linesA.some((l) => /^  bike: Trainer intervals at 06:00, 75 min — 10 min easy/.test(l)), linesA);
  ok('B\'s block is EMPTY — no block, not an empty heading', Array.isArray(linesB) && linesB.length === 0, linesB);
  const noOwner = await readTodaysProgram({ appUserId: '', at, db: client });
  ok('readTodaysProgram refuses a missing owner (never reads unscoped)', !noOwner.ok && noOwner.error.code === 'no_owner');

  // resolveProgramOwner: rows first, env second, then announced-unresolved
  const settingsDb = (rows) => ({ from: (t) => ({ select: () => ({ eq: (c, v) => ({ limit: async () => ({ data: t === 'user_settings' && c === 'cos_user_id' ? rows.filter((r) => r.cos_user_id === v) : [], error: null }) }) }) }) });
  const viaSettings = await resolveProgramOwner({ env: { COS_BRIEF_USAGE_USER_ID: 'env-id' }, cosUserId: 'cos-1', db: settingsDb([{ cos_user_id: 'cos-1', user_id: A }]) });
  const viaEnv = await resolveProgramOwner({ env: { COS_BRIEF_USAGE_USER_ID: 'env-id' }, cosUserId: 'cos-1', db: settingsDb([]) });
  const none = await resolveProgramOwner({ env: {}, cosUserId: 'cos-1', db: settingsDb([]) });
  ok('the program owner comes from user_settings.cos_user_id first (rows, not env)', viaSettings.appUserId === A && viaSettings.source === 'settings', viaSettings);
  ok('…then COS_BRIEF_USAGE_USER_ID', viaEnv.appUserId === 'env-id' && viaEnv.source === 'env', viaEnv);
  ok('…else unresolved (no block, announced by the job)', none.appUserId === null && none.source === 'unresolved', none);

  // THE JOB, real, with the CoS side faked as Bundle 38 does and the program side REAL
  const rawData = () => ({
    workstreams: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Cedrus launch', status: 'active', priority: 'high', health: 'ok', archived_at: null, created_at: '2026-09-01T00:00:00Z' }],
    open_loops: [], decisions: [], captures: [], agent_runs: [], email_messages: [], email_ai_analyses: [],
  });
  const modelBrief = () => ({
    schema_version: 'today_brief_v1', generated_at: '2026-09-15T11:00:00Z', summary: 'One launch workstream, nothing overdue.',
    top_priorities: [{ rank: 1, title: 'Keep the launch moving', reason: 'It is the only active workstream', recommended_action: 'Pick the next action',
      urgency: 'medium', confidence: 0.6, source_refs: [{ type: 'workstream', id: '11111111-1111-1111-1111-111111111111' }] }],
    decisions_to_make: [], people_or_dependencies_waiting: [], risks: [], not_enough_evidence: [], model_disclaimer: 'x',
  });
  const env = { COS_SUPABASE_URL: 'https://cos.invalid', COS_SERVICE_ROLE_KEY: 'cos-key', COS_BRIEF_DRY_RUN: 'true', COS_USER_ID: 'cos-owner' };
  const runFor = async (appUserId, extra = {}) => {
    let modelCalls = 0;
    const lines = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    const grab = (x) => lines.push(String(x));
    console.log = grab; console.warn = grab; console.error = grab;
    let result;
    try {
      result = await runCosDailyBrief({ env, now: at, deps: {
        gather: async () => ({ ok: true, data: rawData() }),
        callModel: async () => { modelCalls++; return { parsed: modelBrief(), model: 'gpt-4.1-mini', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }; },
        logRun: async () => {},
        programOwner: async () => ({ appUserId, source: 'test' }),
        readProgram: (a) => readTodaysProgram({ ...a, db: client }),
        ...extra,
      } });
    } finally { Object.assign(console, orig); }
    return { result, modelCalls, log: lines.join('\n') };
  };
  const forA = await runFor(A);
  const forB = await runFor(B);
  ok('the job composes a brief for A with a todays_program block of 5 lines', forA.result.ran && forA.result.reason === 'dry_run' && Array.isArray(forA.result.brief.todays_program) && forA.result.brief.todays_program.length === 5, forA.result.reason);
  ok('control: the SAME job for B composes a brief with an EMPTY todays_program (no block)', forB.result.ran && forB.result.reason === 'dry_run' && forB.result.brief.todays_program.length === 0, forB.result.brief && forB.result.brief.todays_program);
  ok('the job announces what it read for each: 3 items for A, none for B (Lesson 7)', /programs\.today\.read/.test(forA.log) && /programs\.today\.read/.test(forB.log) && /no items scheduled today/.test(forB.log));
  const renderedA = renderBriefEmail(forA.result.brief, at);
  const renderedB = renderBriefEmail(forB.result.brief, at);
  const idx = (s, re) => s.search(re);
  ok('A\'s email: TODAY\'S PROGRAM is the FIRST section — before the summary and before State of the workspace, in text and html',
    idx(renderedA.text, /TODAY'S PROGRAM/) > -1 && idx(renderedA.text, /TODAY'S PROGRAM/) < idx(renderedA.text, /One launch workstream/) && idx(renderedA.text, /TODAY'S PROGRAM/) < idx(renderedA.text, /STATE OF THE WORKSPACE/)
      && idx(renderedA.html, /Today's program/) > -1 && idx(renderedA.html, /Today's program/) < idx(renderedA.html, /One launch workstream/),
    renderedA.text.slice(0, 300));
  ok('A\'s email carries the item line and NO citation for it (computed, not model-cited)', /bike: Trainer intervals at 06:00, 75 min/.test(renderedA.text) && !/Based on:.*program/i.test(renderedA.text));
  ok('control: B\'s email has NO today\'s-program section in text or html', !/TODAY'S PROGRAM/.test(renderedB.text) && !/Today's program/.test(renderedB.html));
  const unresolved = await runFor(null, { programOwner: async () => ({ appUserId: null, source: 'unresolved' }) });
  ok('an unresolved owner SKIPS the block, announces it, and the brief still composes', unresolved.result.ran && unresolved.result.brief.todays_program.length === 0 && /programs\.today\.skipped/.test(unresolved.log));
  const broken = await runFor(A, { readProgram: async () => ({ ok: false, rows: [], error: { code: '42883', message: 'function todays_program_items does not exist' } }) });
  ok('an UNREADABLE program table fails the run closed BEFORE the model is paid (Law 11 tripwire)', !broken.result.ran && broken.result.reason === 'program_read_failed' && broken.modelCalls === 0 && /Law 11/.test(broken.log), broken.result);
  ok('control: the model was called exactly once for each successful run', forA.modelCalls === 1 && forB.modelCalls === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('the load script — spawned: a dry run writes nothing and needs no database; --commit is the switch');
{
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME };
  const run = (args, env = clean) => {
    const r = spawnSync('bun', ['scripts/load-program.mjs', ...args], { cwd: REPO, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  const t = run(['test/fixtures/programs/miami-man-2026.synthetic.txt', '--user-id', A]);
  ok('dry run: exit 0 with NO database environment at all (no client is ever constructed)', t.code === 0, { code: t.code, err: t.err.slice(0, 300) });
  ok('dry run: prints the full dated table — 69 dated rows — and per-category counts', (t.out.match(/^2026-\d{2}-\d{2}  /gm) || []).length === 69 && /per category/.test(t.out) && /total\s+69/.test(t.out), t.out.slice(0, 200));
  ok('dry run: prints rows and the derived days side by side, and where the dates came from', /days\s+69\s+= end_date - start_date \+ 1/.test(t.out) && /rows\s+69/.test(t.out) && /from the source header/.test(t.out));
  ok('dry run: says nothing was written', /DRY RUN — nothing written/.test(t.out));
  const r = run(['test/fixtures/programs/care-routine.synthetic.txt', '--user-id', A, '--start', '2026-09-09']);
  ok('dry run (routine): exit 0, 84 rows over a 28-day horizon from --start, end_date open', r.code === 0 && /rows\s+84/.test(r.out) && /horizon\s+28/.test(r.out) && /--start argument/.test(r.out) && /open-ended/.test(r.out), r.out.slice(0, 200));
  const noPath = run([]);
  ok('no path: usage error, exit 1 (no default path, nothing under ~/Downloads)', noPath.code === 1 && /source PATH is required/.test(noPath.err));
  const bad = run(['test/fixtures/programs/miami-man-2026.synthetic.txt', '--user-id', A, '--start', '2026-09-01']);
  ok('a source that does not compile: exit 1 with the reason', bad.code === 1 && /did not compile/.test(bad.err));
  const commitNoUser = run(['test/fixtures/programs/miami-man-2026.synthetic.txt', '--commit']);
  ok('--commit without --user-id: refused, exit 1', commitNoUser.code === 1 && /--user-id is required with --commit/.test(commitNoUser.err));
  // control: with --commit the script DOES reach for a database — against an
  // unreachable one it fails loudly, which is the proof the flag is the switch.
  const commit = run(['test/fixtures/programs/miami-man-2026.synthetic.txt', '--user-id', A, '--commit'],
    { ...clean, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'k', OPENAI_API_KEY: 'k', TWILIO_ACCOUNT_SID: 'ACx', TWILIO_AUTH_TOKEN: 'k', TWILIO_FROM_NUMBER: '+15550000000' });
  ok('control: --commit against an unreachable database FAILS loudly (exit 1, "--commit FAILED") — the flag is what opens the write path',
    commit.code === 1 && /--commit FAILED/.test(commit.err) && /Nothing written/.test(commit.err), { code: commit.code, err: commit.err.slice(0, 300) });
}

await db.close();
finish();
