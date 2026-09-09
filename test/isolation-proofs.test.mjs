// Bundle 48 — the remaining isolation proofs: A2, A5, A10 (BUILD_PLAN P1.5).
// Run: bun test/isolation-proofs.test.mjs
//
// WHAT THIS SUITE IS FOR
// Three claims from the multi-user charter's proof manifest, each with the
// control that makes it mean something, each mutation-checked by
// test/mutate-bundle-48.sh:
//
//   A2  a write against another person's record is refused
//       control: the same write against the caller's own record succeeds
//   A5  the public key reads nothing: with the database role set to anon,
//       every table holding a person's data returns zero rows or a permission
//       error — and the table list is enumerated from the migration files,
//       then asserted complete against the catalog
//       control: service_role reads the same rows; an UNPROTECTED table IS
//       readable by anon in this same database, so "nothing" is a refusal,
//       not a broken read
//   A10 no person's identifier appears in another person's log trace
//       control: the identifier DOES appear in that person's own trace, and
//       an empty log is a failure, never a pass
//
// WHAT RUNS REAL HERE
//   • the three migrations, verbatim, including their in-transaction
//     self-proof, on PGlite (a real Postgres, in-process) — the same harness
//     as Bundles 42 and 43, not a second one
//   • src/services/programs/publish.js through a client whose rpc() runs the
//     real publish_program_revision() on the real database
//   • src/jobs/cosDailyBrief.js, the real job, in writeback-only and live
//     modes, with the CoS side faked exactly as Bundle 38 fakes it
//   • src/services/cos/writer.js — resolveCosUserId, buildBriefRow and
//     writeBriefToCos — with the one supabase-js insert replaced by a real
//     INSERT into a PGlite table
//   • src/services/cos/ledger.js — claimSend / markSent / releaseClaim —
//     against Bundle 41's Map-backed fake with a real unique key
//   • src/utils/logger.js — the real logger, its AsyncLocalStorage context and
//     its scrubber; lines are captured off console, parsed as the JSON they are
//
// WHAT IS A FIXTURE, AND WHERE EACH ONE COMES FROM (Lesson 20)
//   • The three API roles and Supabase's DEFAULT PRIVILEGES. Stock Supabase
//     grants anon ALL on every new table in public (the supabase_admin default
//     ACL, read from both projects on 2026-09-09: anon=arwdDxtm). This fixture
//     reproduces that WORST CASE so an unprotected table is readable by anon
//     here — the migrations' explicit revokes then have to do real work, and
//     the A5 control below proves the fixture discriminates.
//   • app_users, auth.users, auth.identities, auth.uid() — recreated from what
//     this repo's code writes and reads, as in Bundles 42/43. app_users
//     predates every migration in this repo, so its RLS posture is NOT
//     declared here; it is reproduced from a READ-ONLY METADATA READ OF
//     PRODUCTION on 2026-09-09 (pg_class / pg_policies / table_privileges,
//     no row of any table): RLS enabled, not forced; two policies, both
//     `to authenticated` on auth.uid() = auth_user_id; anon holds no SELECT.
//     If prod moves, this fixture is stale and must be re-read, not trusted.
//   • cos.today_briefs — CoS's writeback table, in its own schema, from the
//     column list buildBriefRow() writes and the three CHECK constraints
//     writer.js documents. CoS's migrations live in the CoS project, not here.
//
// WHAT IS NOT PROVEN HERE, SAID PLAINLY
//   The eight CoS tables the reader touches are in a different Supabase
//   project whose DDL is not in this repo, so their anon posture cannot be a
//   battery stage on this machine. It was verified LIVE on 2026-09-09 by the
//   same read-only metadata read: 15 public tables, RLS enabled on all, no
//   policy naming anon or public, anon holding no table privilege at all.
//   That is recorded in docs/SESSION_N3_2026-09-09.md and announced by this
//   suite as NOT RE-VERIFIED, so a green run never implies it ran.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// DYNAMIC imports: config.js calls required() at module scope (bundles 36–43).
const compile = await import('../src/services/programs/compile.js');
const { publishProgramRevision, PUBLISH_RPC } = await import('../src/services/programs/publish.js');
const { readTodaysProgram, TODAY_RPC } = await import('../src/services/programs/today.js');
const { runCosDailyBrief } = await import('../src/jobs/cosDailyBrief.js');
const writer = await import('../src/services/cos/writer.js');
const clientMod = await import('../src/services/cos/client.js');
const ledger = await import('../src/services/cos/ledger.js');
const { logger } = await import('../src/utils/logger.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
// EVERY migration file in the directory, in version order — read from disk, not
// listed here, so a migration that lands after this suite joins the proof on
// its own: its tables are enumerated, read as anon, and asserted against the
// catalog without anyone remembering to add them.
const MIGRATIONS = readdirSync(join(REPO, 'supabase/migrations')).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
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
  if (failures) { p(`BUNDLE 48: ${failures} FAILURE(S)`); process.exit(1); }
  p('BUNDLE 48: ALL PASSED');
  process.exit(0);
}
async function attempt(fn) { try { return { result: await fn(), error: null }; } catch (e) { return { result: null, error: e }; } }

p('=== Bundle 48 — isolation proofs A2, A5, A10 (P1.5) ===');

// ── the database ────────────────────────────────────────────────────────────
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const count = async (sql, params) => Number((await one(`select count(*)::int as n from ${sql}`, params)).n);
// Run a statement as a role. Returns { rows } or { code, message } — a refusal
// and a read are different answers and must stay different values.
const asRole = async (role, sql, params, jwtSub = '') => {
  await db.exec(`set role ${role}; set request.jwt.claim.sub = '${jwtSub}';`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { code: e.code, message: e.message.split('\n')[0] }; }
  finally { await db.exec(`reset role; set request.jwt.claim.sub = '';`); }
};

// Two people, in both id spaces the system uses.
const A_AUTH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_AUTH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A_COS = 'a0a0a0a0-c0c0-4c0c-8c0c-a0a0a0a0a0a0';   // A's user_id inside the CoS project
const B_COS = 'b0b0b0b0-c0c0-4c0c-8c0c-b0b0b0b0b0b0';   // B's

const FIXTURE_SQL = `
-- Supabase's three API roles, and Supabase's stock default privileges: a new
-- table in public is readable AND writable by anon until something revokes
-- it. Worst case on purpose — see the header.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

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
-- app_users' RLS posture, FROM THE 2026-09-09 PROD READ (see the header):
-- enabled, not forced; two policies to authenticated; anon without SELECT.
alter table app_users enable row level security;
create policy "own profile read"   on app_users for select to authenticated using (auth.uid() = auth_user_id);
create policy "own profile update" on app_users for update to authenticated using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);
revoke select, insert, update, delete on app_users from anon;

insert into auth.users (id, phone) values ('${A_AUTH}', '17860000001'), ('${B_AUTH}', '17860000002');
insert into app_users (phone, name, auth_user_id, created_at) values
  ('17860000001', 'Emil', '${A_AUTH}', now() - interval '2 days'),
  ('17860000002', 'Person B', '${B_AUTH}', now() - interval '1 day');

-- CoS's writeback table, in its own schema so the public-schema enumeration
-- below stays about THIS repo's tables. Columns are what buildBriefRow()
-- writes; the CHECKs are the three writer.js documents by name.
create schema cos;
create table cos.today_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  schema_version text not null,
  generation_mode text not null,
  model text,
  input_fingerprint text,
  structured_output jsonb,
  source_refs jsonb,
  status text not null default 'ok',
  error_category text,
  latency_bucket text,
  token_bucket text,
  expires_at timestamptz,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint today_briefs_ai_is_complete check (generation_mode <> 'ai' or (structured_output is not null and model is not null)),
  constraint today_briefs_error_has_category check ((status = 'error') = (error_category is not null)),
  constraint today_briefs_source_refs_is_array check (source_refs is null or jsonb_typeof(source_refs) = 'array')
);
`;

let applied = false; let applyError = null;
try {
  await db.exec(FIXTURE_SQL);
  for (const f of MIGRATIONS) {
    await db.exec(SQL(f));
    // The bootstrap admin (II.5): one hand promotion, after the foundation and
    // before provisioning exists — exactly as Bundles 42/43 stage it.
    if (/multiuser_foundation/.test(f)) await db.exec(`update app_users set role = 'admin' where phone = '17860000001';`);
  }
  applied = true;
} catch (e) { applyError = { message: e.message, code: e.code, detail: e.detail }; }

section('the migrations, with their own in-transaction self-proof, under Supabase-shaped default privileges');
ok(`every migration file applied, in order (${MIGRATIONS.length}: ${MIGRATIONS.map((f) => f.replace(/^\d{14}_|\.sql$/g, '')).join(', ')}) — every assertion and control inside them passed`, applied, applyError);
if (!applied) finish();

const A = (await one(`select id from app_users where phone = '17860000001'`)).id;
const B = (await one(`select id from app_users where phone = '17860000002'`)).id;

// ── the rpc client: runs the real function on the real database ─────────────
function makeClient() {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const cast = (k) => (k === 'p_items' ? '::jsonb' : /_id$/.test(k) ? '::uuid' : /_date$/.test(k) ? '::date' : k === 'p_at' ? '::timestamptz' : '::text');
      const named = keys.map((k, i) => `${k} => $${i + 1}${cast(k)}`).join(', ');
      try {
        if (name === TODAY_RPC) {
          const r = await db.query(`select * from ${name}(${named})`, keys.map((k) => args[k]));
          return { data: r.rows, error: null };
        }
        const r = await db.query(`select ${name}(${named}) as data`, keys.map((k) => (k === 'p_items' ? JSON.stringify(args[k]) : args[k])));
        return { data: r.rows[0].data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } };
      }
    },
  };
}
const client = makeClient();
const publish = (compiled, userId) => publishProgramRevision(compiled, { userId, db: client });

// ═══════════════════════════════════════════════════════════════════════════
section('A2 (programs) — publish_program_revision for B cannot touch A\'s program; a revision for B against A\'s program_id is refused');
let programA = null;
{
  const TRAINING = FIXTURE('miami-man-2026.synthetic.txt');
  const training = compile.compileSource(TRAINING, { sourceName: 'miami-man-2026.synthetic.txt' });

  const first = await attempt(() => publish(training, A));
  ok('A publishes the synthetic training plan (revision 1, 69 items)', !first.error && first.result.revision_number === 1 && first.result.items === 69, first.error && first.error.message);
  programA = first.result && first.result.program_id;
  const snapA = async () => one(`select p.user_id, p.current_revision_id, p.title,
      (select count(*)::int from program_revisions r where r.program_id = p.id) as revisions,
      (select count(*)::int from program_items i where i.program_id = p.id) as items
    from programs p where p.id = $1`, [programA]);
  const before = await snapA();

  // THE WRITE: B publishes a CHANGED source under the IDENTICAL kind and
  // title. The only way to name A's program is by (kind, title) — the function
  // has no program_id argument — and the function must find-or-create by
  // OWNER first. (Changed bytes, so that if the owner filter ever went, the
  // per-program idempotency key would not mask it by refusing the same sha.)
  const changedText = TRAINING.replaceAll('Trainer intervals       | 06:15 | 60', 'Trainer intervals       | 06:00 | 75');
  const changed = compile.compileSource(changedText, { sourceName: 'miami-man-2026.b.txt' });
  ok('(the changed source really differs from A\'s, and only on the nine Tuesday lines)', changedText !== TRAINING && changedText.split('\n').filter((l, i) => l !== TRAINING.split('\n')[i]).length === 9);
  const second = await attempt(() => publish(changed, B));
  ok('B publishing under the same kind and title RESOLVES (it is B\'s own write, not a refused one)', !second.error, second.error && { code: second.error.code, message: second.error.message });
  const programB = second.result && second.result.program_id;
  ok('…and it landed on a DIFFERENT program, owned by B, at revision 1', !!programB && programB !== programA && second.result.revision_number === 1
    && (await one('select user_id from programs where id = $1', [programB])).user_id === B, { programA, programB });
  // The very bytes A published, now for B: accepted, as revision 2 of B's OWN
  // program. UNIQUE (program_id, source_sha256) is per program — a source two
  // people both use is never a cross-owner refusal, and never a shared row.
  const identical = await attempt(() => publish(training, B));
  ok('the identical bytes A published are accepted for B as revision 2 of B\'s own program — the idempotency key is per program, not per source',
    !identical.error && identical.result.program_id === programB && identical.result.revision_number === 2, identical.error && { code: identical.error.code, message: identical.error.message });
  const after = await snapA();
  ok('A\'s program is untouched by B\'s publish: still 1 revision, 69 items, same current_revision_id, owner A',
    JSON.stringify(before) === JSON.stringify(after) && after.revisions === 1 && after.items === 69 && after.user_id === A, { before, after });
  ok('every row B\'s publishes wrote carries B\'s user_id — 2 revisions, 138 items, none owned by anyone else',
    (await count('program_revisions where program_id = $1 and user_id <> $2', [programB, B])) === 0
    && (await count('program_items where program_id = $1 and user_id <> $2', [programB, B])) === 0
    && (await count('program_revisions where program_id = $1', [programB])) === 2
    && (await count('program_items where program_id = $1', [programB])) === 138);

  // THE REFUSAL, at the database, on the backend's own role. A revision that
  // names A's program_id but B as its owner is exactly "a write against
  // another person's record". service_role bypasses RLS, so this refusal must
  // come from the composite owner FK, and it does: 23503.
  const forged = await asRole('service_role',
    `insert into program_revisions (user_id, program_id, revision_number, source_name, source_text, source_sha256)
     values ($1, $2, 99, 'forged.txt', 'forged', repeat('0', 64))`, [B, programA]);
  ok('a revision for B against A\'s program_id is REFUSED by the database (23503, composite owner FK), even as service_role',
    forged.code === '23503', forged);
  // CONTROL — the same statement, same role, the caller's own record: succeeds.
  const own = await asRole('service_role',
    `insert into program_revisions (user_id, program_id, revision_number, source_name, source_text, source_sha256)
     values ($1, $2, 99, 'own.txt', 'own', repeat('1', 64)) returning id`, [A, programA]);
  ok('CONTROL: the identical revision insert for A against A\'s own program_id SUCCEEDS', !!own.rows && own.rows.length === 1, own);
  if (own.rows) await db.query('delete from program_revisions where id = $1', [own.rows[0].id]);
  ok('(the control row was removed; A\'s program is back to 1 revision)', (await count('program_revisions where program_id = $1', [programA])) === 1);

  // The same refusal one level down: an item for B on A's program.
  const revA = (await one('select current_revision_id as r from programs where id = $1', [programA])).r;
  const item = await asRole('service_role',
    `insert into program_items (user_id, program_id, program_revision_id, item_key, scheduled_date, category, title)
     values ($1, $2, $3, 'forged', '2026-09-08', 'swim', 'forged')`, [B, programA, revA]);
  ok('an item for B on A\'s program/revision is REFUSED too (23503)', item.code === '23503', item);

  // Signed in as B through the publishable role: not even a read of A's rows,
  // and no write path at all (Bundle 43 proves the owner cannot write either).
  const bReads = await asRole('authenticated', 'select count(*)::int as n from programs where id = $1', [programA], B_AUTH);
  const aReads = await asRole('authenticated', 'select count(*)::int as n from programs where id = $1', [programA], A_AUTH);
  ok('signed in as B, A\'s program is invisible (0 rows); CONTROL: signed in as A it is there (1 row)',
    bReads.rows && bReads.rows[0].n === 0 && aReads.rows && aReads.rows[0].n === 1, { bReads, aReads });
}

// ═══════════════════════════════════════════════════════════════════════════
section('A2 (CoS writeback) — the real job\'s writeback for B lands on B, never on A, even when the deployment names A');
// Real records for two people, distinguishable, so the brief for each cites
// only that person's ids.
const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const rawData = (wsId, name) => ({
  workstreams: [{ id: wsId, name, status: 'active', priority: 'high', health: 'ok', archived_at: null, created_at: '2026-09-01T00:00:00Z' }],
  open_loops: [], decisions: [], captures: [], agent_runs: [], email_messages: [], email_ai_analyses: [],
});
const modelBrief = (wsId, summary) => ({
  schema_version: 'today_brief_v1', generated_at: '2026-09-15T11:00:00Z', summary,
  top_priorities: [{ rank: 1, title: 'Keep it moving', reason: 'Only active workstream', recommended_action: 'Pick the next action',
    urgency: 'medium', confidence: 0.6, source_refs: [{ type: 'workstream', id: wsId }] }],
  decisions_to_make: [], people_or_dependencies_waiting: [], risks: [], not_enough_evidence: [], model_disclaimer: 'x',
});
const PEOPLE = {
  [A_COS]: { app: A, ws: WS_A, name: 'A launch', summary: 'A: one launch workstream.' },
  [B_COS]: { app: B, ws: WS_B, name: 'B move',   summary: 'B: one move workstream.' },
};
const AT = new Date('2026-09-15T12:00:00Z');
const ARMED = { COS_SUPABASE_URL: 'https://cos.invalid', COS_SERVICE_ROLE_KEY: 'cos-key' };

// The one seam on the writeback: supabase-js's insert becomes a real INSERT.
const pgInsert = async (row) => {
  try {
    const r = await db.query(
      `insert into cos.today_briefs (user_id, schema_version, generation_mode, model, input_fingerprint, structured_output, source_refs, status, latency_bucket, token_bucket, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [row.user_id, row.schema_version, row.generation_mode, row.model, row.input_fingerprint, JSON.stringify(row.structured_output), JSON.stringify(row.source_refs), row.status, row.latency_bucket, row.token_bucket, row.expires_at]);
    return { id: r.rows[0].id, error: null, disarmed: false };
  } catch (e) { return { id: null, error: { code: e.code, message: e.message }, disarmed: false }; }
};

// Drive the REAL job for one person. `deps.resolveOwner` stands in for the
// per-person resolution P1.4 builds; everything downstream is the real code.
async function runJobFor(cosUserId, { env, mode = 'writeback_only', transport = null, gatherDelayMs = 0, ledgerDb = null, correlationId = null } = {}) {
  const who = PEOPLE[cosUserId];
  const gatherCalls = [];
  const modeEnv = mode === 'writeback_only'
    ? { COS_BRIEF_WRITEBACK_ONLY: 'true' }
    : mode === 'live' ? { COS_BRIEF_LIVE: 'true', RESEND_API_KEY: 'k', COS_BRIEF_TO: 'x@y.test' } : { COS_BRIEF_DRY_RUN: 'true' };
  const fullEnv = { ...ARMED, ...modeEnv, ...env };
  const deps = {
    resolveOwner: async () => ({ userId: cosUserId, source: 'settings' }),
    gather: async (a) => { gatherCalls.push(a.userId); if (gatherDelayMs) await new Promise((r) => setTimeout(r, gatherDelayMs)); return { ok: true, data: rawData(who.ws, who.name) }; },
    callModel: async () => ({ parsed: modelBrief(who.ws, who.summary), model: 'gpt-4.1-mini', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    logRun: async () => {},
    programOwner: async () => ({ appUserId: who.app, source: 'settings' }),
    readProgram: (a) => readTodaysProgram({ ...a, db: client }),
    write: (a) => writer.writeBriefToCos({ ...a, deps: { insert: pgInsert } }),
  };
  if (mode === 'live') {
    deps.transportFactory = () => transport;
    deps.precheck = (a) => ledger.alreadySentToday({ ...a, db: ledgerDb });
    deps.claim = (a) => ledger.claimSend({ ...a, db: ledgerDb });
    deps.mark = (a) => ledger.markSent({ ...a, db: ledgerDb });
    deps.release = (a) => ledger.releaseClaim({ ...a, db: ledgerDb });
  }
  const run = () => runCosDailyBrief({ env: fullEnv, now: AT, deps });
  // Each tick runs inside its own correlation context — the exact fields
  // scheduler.guard() sets — so every line the job emits shares one id.
  const result = correlationId
    ? await logger.runWithContext({ correlation_id: correlationId, trace_stage: 'dispatch' }, run)
    : await run();
  return { result, gatherCalls };
}
// Capture every line the logger emits (it writes JSON to console.log / warn /
// error by level) and parse it back. A line that is not JSON is a failure of
// the capture, not a pass.
async function captureLog(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (x) => lines.push(String(x));
  console.log = grab; console.warn = grab; console.error = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  const parsed = []; const unparseable = [];
  for (const l of lines) { try { parsed.push(JSON.parse(l)); } catch { unparseable.push(l); } }
  return { parsed, unparseable, raw: lines };
}
const briefRows = async () => all(`select id, user_id, model, generation_mode, status, structured_output->>'summary' as summary from cos.today_briefs order by created_at, id`);
{
  // A already has a brief in CoS — the row B's writeback must never touch.
  await db.query(`insert into cos.today_briefs (user_id, schema_version, generation_mode, model, structured_output, source_refs, status)
                  values ($1, 'today_brief_v1', 'ai', 'gpt-4.1-mini', '{"summary":"A: yesterday"}', '[]', 'ok')`, [A_COS]);
  const seeded = await briefRows();
  ok('(seed) exactly one row in cos.today_briefs and it is A\'s', seeded.length === 1 && seeded[0].user_id === A_COS, seeded);
  const aRowBefore = JSON.stringify(await one('select * from cos.today_briefs where user_id = $1', [A_COS]));

  // THE WRITE: the job runs for B while the deployment's COS_USER_ID names A —
  // today's production shape, where that variable names Emil. B's writeback
  // must land on B: the resolved caller wins over the environment, and the
  // row's user_id is set from the resolved caller, never from anything else.
  let forB; const capB = await captureLog(async () => { forB = await runJobFor(B_COS, { env: { COS_USER_ID: A_COS } }); });
  ok('(the run\'s own log lines were captured, not spilled: cos.brief.written present)', capB.parsed.some((l) => l.event === 'cos.brief.written'), capB.parsed.map((l) => l.event));
  ok('the job ran writeback-only for B and reports written', forB.result.ran && forB.result.reason === 'writeback_only' && forB.result.written === true, forB.result);
  const afterB = await briefRows();
  const newRows = afterB.filter((r) => r.id !== seeded[0].id);
  ok('exactly ONE new row, and it is B\'s (user_id = B), with B\'s own summary — NOT A\'s, although COS_USER_ID names A',
    newRows.length === 1 && newRows[0].user_id === B_COS && /^B:/.test(newRows[0].summary), newRows);
  ok('A\'s existing row is byte-identical before and after B\'s writeback', aRowBefore === JSON.stringify(await one('select * from cos.today_briefs where user_id = $1', [A_COS])));
  ok('the job gathered B\'s records and only B\'s (every CoS read scoped to B)', forB.gatherCalls.length === 1 && forB.gatherCalls[0] === B_COS, forB.gatherCalls);
  ok('the brief B received cites B\'s record id and not A\'s',
    JSON.stringify(forB.result.brief.top_priorities).includes(WS_B) && !JSON.stringify(forB.result.brief).includes(WS_A));

  // CONTROL — the same run for A writes A's row.
  let forA; await captureLog(async () => { forA = await runJobFor(A_COS, { env: { COS_USER_ID: A_COS } }); });
  const afterA = await briefRows();
  ok('CONTROL: the identical run for A writes a row owned by A with A\'s summary (3 rows now: A seed, B, A)',
    forA.result.written === true && afterA.length === 3 && afterA[2].user_id === A_COS && /^A:/.test(afterA[2].summary), afterA);
  ok('CONTROL: B\'s row is untouched by A\'s writeback (still exactly one row for B)', (await count('cos.today_briefs where user_id = $1', [B_COS])) === 1);

  // The resolution rule itself, pinned on the real function: a named caller is
  // returned as named; the environment is consulted only when nobody is named.
  const named = await writer.resolveCosUserId({ env: { COS_USER_ID: A_COS }, cosUserId: B_COS, cosUserSource: 'settings' });
  const unnamed = await writer.resolveCosUserId({ env: { COS_USER_ID: A_COS } });
  ok('resolveCosUserId: a caller naming B gets B (source as declared), never the env\'s A', named.userId === B_COS && named.source === 'settings', named);
  ok('CONTROL: with nobody named, the env\'s A is returned (source env)', unnamed.userId === A_COS && unnamed.source === 'env', unnamed);

  // And the door itself refuses a row with no owner at all (Bundle 41 pins the
  // export surface; this pins the refusal happens BEFORE any client exists).
  let ownerless = null;
  try { await clientMod.cosInsertTodayBrief({ schema_version: 'today_brief_v1' }, { env: {} }); } catch (e) { ownerless = e.message; }
  ok('cosInsertTodayBrief refuses a row with no user_id before reaching any client', !!ownerless && /must carry an explicit user_id/.test(ownerless), ownerless);
}

// ═══════════════════════════════════════════════════════════════════════════
section('A5 — the public key reads nothing: every table holding a person\'s data, enumerated from the migrations, refuses anon');
{
  // ENUMERATED FROM THE MIGRATION FILES, not from memory. Every table a
  // migration creates, plus every pre-existing table a migration alters.
  const declared = new Set();
  for (const f of MIGRATIONS) {
    const text = SQL(f);
    for (const m of text.matchAll(/create table if not exists\s+([a-z_]+)/g)) declared.add(m[1]);
    for (const m of text.matchAll(/^alter table\s+([a-z_]+)\s*$/gm)) declared.add(m[1]);
  }
  const fromMigrations = [...declared].sort();
  ok('the migrations declare exactly these tables: admin_audit, app_users, program_items, program_revisions, programs, user_capabilities, user_settings',
    fromMigrations.join(',') === 'admin_audit,app_users,program_items,program_revisions,programs,user_capabilities,user_settings', fromMigrations);

  // COMPLETENESS: every table in public with a column naming a user is on the
  // list. A new person-table added without joining this proof fails here.
  const inCatalog = (await all(`select distinct table_name from information_schema.columns
      where table_schema = 'public' and column_name ~ 'user_id' order by 1`)).map((r) => r.table_name);
  ok('the list is COMPLETE against the catalog: every public table with a *user_id* column is enumerated (and nothing else is)',
    inCatalog.join(',') === fromMigrations.join(','), { inCatalog, fromMigrations });

  // SELF-CHECK on the fixture, first: an unprotected table IS readable by anon
  // here, so the refusals below are refusals and not a role that can read
  // nothing. Created, read, dropped — it never joins the enumeration.
  await db.exec(`create table leak_control (id int, user_id uuid); insert into leak_control values (1, gen_random_uuid());`);
  const leak = await asRole('anon', 'select count(*)::int as n from leak_control');
  await db.exec('drop table leak_control');
  ok('SELF-CHECK: under this fixture\'s Supabase-shaped defaults, anon DOES read an unprotected table (1 row) — the fixture discriminates',
    leak.rows && leak.rows[0].n === 1, leak);

  // Rows exist to be leaked: every table has at least one row for A or B
  // (the seeded accounts, B's program from A2, and a settings/capability/audit
  // row created here through the real provisioning function).
  const prov = await db.query(`select provision_user($1::uuid, $2::text, $3::text, $4::text[], $5::text) as r`,
    [A, '17860000003', 'Person C', ['receive_brief'], 'bundle 48: rows to be refused']);
  ok('(seed) a third account was provisioned through the real function, so user_settings, user_capabilities and admin_audit each hold a row',
    !!prov.rows[0].r && (await count('user_settings')) >= 1 && (await count('user_capabilities')) >= 1 && (await count('admin_audit')) >= 1);

  // THE PROOF, per table, with the CONTROL beside it.
  for (const t of fromMigrations) {
    const superRows = await count(t);
    const anon = await asRole('anon', `select count(*)::int as n from ${t}`);
    const svc = await asRole('service_role', `select count(*)::int as n from ${t}`);
    const refused = anon.code === '42501';
    const empty = !!anon.rows && anon.rows[0].n === 0;
    ok(`anon reads ZERO rows from ${t}: ${refused ? 'permission denied (42501)' : empty ? '0 rows' : 'LEAK'} — CONTROL: service_role reads ${svc.rows ? svc.rows[0].n : 'ERR'} of ${superRows}`,
      (refused || empty) && !!svc.rows && svc.rows[0].n === superRows && superRows >= 1, { anon, svc, superRows });
    // Structure, beside behaviour: the two ways anon could ever get in.
    const pols = await all(`select policyname, roles::text as roles from pg_policies where schemaname = 'public' and tablename = $1 and ('anon' = any (roles) or 'public' = any (roles))`, [t]);
    ok(`no policy on ${t} names anon or public`, pols.length === 0, pols);
    const privs = (await all(`select privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = $1 and grantee = 'anon' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') order by 1`, [t])).map((r) => r.privilege_type);
    ok(`anon holds no SELECT/INSERT/UPDATE/DELETE privilege on ${t}`, privs.length === 0, privs);
  }
  // No JWT at all (the publishable key without a session) reads nothing either.
  const noJwt = await asRole('authenticated', 'select count(*)::int as n from user_settings', undefined, '');
  ok('CONTROL 2: authenticated with NO JWT reads 0 rows of user_settings; CONTROL 3: the provisioned person, signed in, reads their own 1 row',
    noJwt.rows && noJwt.rows[0].n === 0
    && (await (async () => { const c = await one(`select auth_user_id as a from app_users where phone = '17860000003'`); const r = await asRole('authenticated', 'select count(*)::int as n from user_settings', undefined, c.a); return r.rows && r.rows[0].n === 1; })()),
    noJwt);

  // The CoS tables the reader touches — enumerated from the reader's own
  // allowlist, and announced as NOT re-verified here (Lesson 7).
  const cosTables = [...clientMod.READABLE_TABLES];
  ok('the CoS reader touches exactly eight tables (READABLE_TABLES): workstreams, open_loops, decisions, captures, agent_runs, email_messages, email_ai_analyses, today_briefs',
    cosTables.join(',') === 'workstreams,open_loops,decisions,captures,agent_runs,email_messages,email_ai_analyses,today_briefs', cosTables);
  p('  NOTE  A5/CoS: the anon posture of those eight tables is NOT RE-VERIFIED by this suite — their DDL is in the CoS project, not this repo.');
  p('        Verified LIVE on 2026-09-09 by a read-only metadata read (docs/SESSION_N3_2026-09-09.md): RLS enabled on all 15 CoS tables,');
  p('        no policy naming anon/public, anon holding no table privilege. Re-read prod before trusting that line again.');
}

// ═══════════════════════════════════════════════════════════════════════════
section('A10 — no person\'s identifier appears in another person\'s log trace (the real job, twice in one process, log captured)');
// Bundle 41's ledger fake: a Map with a REAL unique key, so claimSend's 23505
// path is the mechanism and not a boolean.
const ledgerFake = () => {
  const rows = new Map();
  return {
    rows,
    from(table) {
      if (table !== 'system_flags') throw new Error('unexpected table: ' + table);
      const api = {
        _key: null,
        select() { return api; },
        eq(_c, v) { api._key = v; return api; },
        maybeSingle: async () => ({ data: rows.has(api._key) ? { value: rows.get(api._key) } : null, error: null }),
        insert: async (row) => {
          if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } };
          rows.set(row.key, row.value);
          return { error: null };
        },
        update: (patch) => ({ eq: async (_c, v) => { rows.set(v, patch.value); return { error: null }; } }),
        delete: () => ({ eq: async (_c, v) => { rows.delete(v); return { error: null }; } }),
      };
      return api;
    },
  };
};
// A transport that fails AFTER the wire might have been touched: the one path
// on which the job names the ledger key — and the key carries the user's id.
// That is the real line a person's identifier rides on, so it is the line
// this proof has to see in the right trace and never in the wrong one.
const explodingTransport = { send: async () => { throw new Error('provider exploded mid-flight'); } };

const CORR_A = 'ca000000-0000-4000-8000-00000000000a';
const CORR_B = 'cb000000-0000-4000-8000-00000000000b';
const idsOf = (who) => (who === 'A' ? [A_COS, A] : [B_COS, B]);
const mentions = (line, ids) => { const s = JSON.stringify(line); return ids.some((id) => s.includes(id)); };

function judgeTraces(cap, label) {
  const byCorr = (c) => cap.parsed.filter((l) => l.correlation_id === c);
  const linesA = byCorr(CORR_A); const linesB = byCorr(CORR_B);
  const strays = cap.parsed.filter((l) => l.correlation_id !== CORR_A && l.correlation_id !== CORR_B);
  ok(`${label}: every captured line is JSON (${cap.parsed.length} lines, 0 unparseable)`, cap.unparseable.length === 0 && cap.parsed.length > 0, cap.unparseable.slice(0, 3));
  ok(`${label}: every line carries one of the two runs' correlation ids — no shared, unattributed line`, strays.length === 0, strays.map((l) => l.event));
  // THE CONTROL FIRST. An empty trace is not a pass, and a trace in which the
  // owner's own id never appears would make the assertion below vacuous.
  ok(`${label}: CONTROL — A's trace is non-empty (${linesA.length} lines) and A's own id appears in it`, linesA.length >= 5 && linesA.some((l) => mentions(l, idsOf('A'))), linesA.map((l) => l.event));
  ok(`${label}: CONTROL — B's trace is non-empty (${linesB.length} lines) and B's own id appears in it`, linesB.length >= 5 && linesB.some((l) => mentions(l, idsOf('B'))), linesB.map((l) => l.event));
  const aInB = linesB.filter((l) => mentions(l, idsOf('A')));
  const bInA = linesA.filter((l) => mentions(l, idsOf('B')));
  ok(`${label}: A's identifier appears in NO line carrying B's correlation id`, aInB.length === 0, aInB.map((l) => [l.event, l.message]));
  ok(`${label}: B's identifier appears in NO line carrying A's correlation id`, bInA.length === 0, bInA.map((l) => [l.event, l.message]));
  // The id travels on the line this proof expects it to (the ledger key on
  // the post-wire failure), so the capture is looking at the real thing.
  ok(`${label}: the line carrying each id is cos.send.failed naming that person's ledger row`,
    linesA.some((l) => l.event === 'cos.send.failed' && /ledger row 'cos_brief_send:/.test(l.message || '') && (l.message || '').includes(A_COS))
    && linesB.some((l) => l.event === 'cos.send.failed' && (l.message || '').includes(B_COS)));
}
{
  // SEQUENTIAL — A then B, one process, as the iterating job will run them.
  const seqLedger = ledgerFake();
  const results = {};
  const seq = await captureLog(async () => {
    results.A = await runJobFor(A_COS, { mode: 'live', transport: explodingTransport, ledgerDb: seqLedger, correlationId: CORR_A });
    results.B = await runJobFor(B_COS, { mode: 'live', transport: explodingTransport, ledgerDb: seqLedger, correlationId: CORR_B });
  });
  ok('both live runs reached the wire and failed there (reason send_failed) — the path that names the ledger key', results.A.result.reason === 'send_failed' && results.B.result.reason === 'send_failed', [results.A.result, results.B.result]);
  ok('each person\'s claim is their own row in the ledger, both left claimed (unknown transmission)', seqLedger.rows.size === 2 && [...seqLedger.rows.keys()].some((k) => k.includes(A_COS)) && [...seqLedger.rows.keys()].some((k) => k.includes(B_COS)));
  judgeTraces(seq, 'sequential');

  // CONCURRENT — the two runs interleave on purpose (A's gather is slow, B's
  // is fast), which is what makes a process-global context leak visible: A's
  // late lines would be stamped with whatever run set the context last.
  const conLedger = ledgerFake();
  const con = await captureLog(async () => {
    await Promise.all([
      runJobFor(A_COS, { mode: 'live', transport: explodingTransport, ledgerDb: conLedger, correlationId: CORR_A, gatherDelayMs: 60 }),
      runJobFor(B_COS, { mode: 'live', transport: explodingTransport, ledgerDb: conLedger, correlationId: CORR_B, gatherDelayMs: 5 }),
    ]);
  });
  const orderOk = (() => {
    const idx = (c, ev) => con.parsed.findIndex((l) => l.correlation_id === c && l.event === ev);
    return idx(CORR_B, 'cos.send.failed') !== -1 && idx(CORR_A, 'cos.send.failed') !== -1 && idx(CORR_B, 'cos.send.failed') < idx(CORR_A, 'cos.send.failed');
  })();
  ok('the runs really interleaved: B finished before A (B\'s cos.send.failed precedes A\'s in the capture)', orderOk);
  judgeTraces(con, 'concurrent');
}

await db.close();
finish();
