// Bundle 44 — backfill through the provisioning path (BUILD_PLAN P1.3).
// Run: bun test/normalize-account.test.mjs
//
// WHAT THIS SUITE IS FOR
// Two accounts predate provision_user() and cannot go through it (their phones
// already exist). They must get the shape a fresh account gets — FROM THE SAME
// CODE. So provision_user's tail became normalize_account(), provision_user
// calls it, and the claim is: a backfilled account and a freshly provisioned
// one have the SAME SHAPE, by construction. The done-when is a diff, and a diff
// is only evidence when it is known to see a difference, so every empty diff
// here sits next to a non-empty one:
//
//   Emil (backfilled) vs fresh        EMPTY    alongside   an un-shaped row vs fresh   NON-EMPTY
//   fresh vs fresh                    EMPTY    (the ledger's control)
//   the ghost (empty set) vs fresh({}) EMPTY   alongside   the fresh row HAS settings + an audit row
//
// Everything runs against a REAL Postgres (PGlite, in-process) with the FOUR
// real migration files applied verbatim, including their self-proof. The
// backfill script — the thing that will write to production — is SPAWNED, the
// real Python, and its real SQL reaches this database through an in-process
// fake of the Management API endpoint (SUPABASE_MGMT_API_BASE). Its dry run
// is proven to write nothing; its --commit is proven to produce the shape.
//
// WHAT IS A FIXTURE (Lesson 20): app_users, auth.users, auth.identities, the
// three API roles, auth.uid() and supabase_migrations.schema_migrations —
// recreated from what this repo's code writes and reads and from GoTrue's and
// the CLI's published schemas. Emil's row is given his real id (c6cf9fb9-…)
// because the script identifies him by it. The ghost is a suspended member
// with no name, created 2026-07-10, which is what F0.2 left in prod.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_FROM_NUMBER = '+15550000000';

// DYNAMIC import: config.js calls required() at module scope (bundles 36–43).
const { provisionUser } = await import('../src/services/provisioning.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SQL = (f) => readFileSync(join(REPO, 'supabase/migrations', f), 'utf8');
const SCRIPT = join(REPO, 'scripts/backfill-accounts-via-api.py');

const p = console.log;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };
let server = null;
async function finish() {
  if (server) server.stop(true);
  try { await db.close(); } catch {}
  p('');
  if (failures) { p(`BUNDLE 44: ${failures} FAILURE(S)`); process.exit(1); }
  p('BUNDLE 44: ALL PASSED');
  process.exit(0);
}

p('=== Bundle 44 — backfill through the provisioning path (P1.3) ===');

// ── the database ────────────────────────────────────────────────────────────
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const count = async (sql, params) => Number((await one(`select count(*)::int as n from ${sql}`, params)).n);

const EMIL = 'c6cf9fb9-0c71-4cb6-a4c8-df9121abd76b';

const FIXTURE_SQL = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255), recovery_sent_at timestamptz,
  email_change_token_new varchar(255), email_change varchar(255), email_change_sent_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text unique default null, phone_confirmed_at timestamptz, phone_change text default '', phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '', email_change_confirm_status smallint default 0, banned_until timestamptz,
  reauthentication_token varchar(255) default '', reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false, deleted_at timestamptz, is_anonymous boolean not null default false
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data->>'email')) stored,
  unique (provider_id, provider)
);

-- The CLI's migration history table, which the backfill script reads.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
insert into supabase_migrations.schema_migrations (version) values ('20260830120000'), ('20260909120000'), ('20260909180000');

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
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_app_users_updated_at before update on app_users for each row execute function set_updated_at();

-- EMULATION of prod's link_or_create_app_user_from_auth (Bundle 42): link by phone, else create.
create function link_or_create_app_user_from_auth() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.phone is null then return new; end if;
  update app_users set auth_user_id = new.id where phone = new.phone;
  if not found then insert into app_users (phone, auth_user_id) values (new.phone, new.id); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function link_or_create_app_user_from_auth();

-- The two July rows, as prod has them: Emil (his real id) and the unnamed ghost.
insert into app_users (id, phone, name, sms_consent_at, consent_source, created_at) values
  ('${EMIL}', '17860000001', 'Emil', now(), 'first_message', '2026-07-02 14:00:00+00'),
  (gen_random_uuid(), '17860000002', null, null, null, '2026-07-10 09:00:00+00');
`;

let applied = false;
let applyError = null;
try {
  await db.exec(FIXTURE_SQL);
  await db.exec(SQL('20260830120000_multiuser_foundation.sql'));
  // F0.1 (the bootstrap promotion) and F0.2 (the ghost suspended) — the state prod is in.
  await db.exec(`
    update app_users set role = 'admin' where id = '${EMIL}';
    update app_users set account_status = 'suspended' where phone = '17860000002';
  `);
  await db.exec(SQL('20260909120000_provision_user.sql'));
  await db.exec(SQL('20260909180000_programs_foundation.sql'));
  await db.exec(SQL('20260909210000_normalize_account.sql'));
  applied = true;
} catch (e) {
  applyError = { message: e.message, code: e.code, detail: e.detail };
}

section('the four migrations, with their own in-transaction self-proof');
ok('foundation, provision_user, programs and normalize_account migrations all applied — every assertion and control inside them passed', applied, applyError);
if (!applied) await finish();

const GHOST = (await one(`select id from app_users where phone = '17860000002'`)).id;
ok('the migration\'s controls left no rows behind (control phones, backfill audit rows, settings)',
  (await count(`app_users where phone in ('15550100145','15550100146','15550100147','15550100148')`)) === 0
  && (await count(`auth.users where phone in ('15550100145','15550100146','15550100147','15550100148')`)) === 0
  && (await count(`admin_audit where action in ('normalize_account','bind_cos_identity','provision_user')`)) === 0
  && (await count('user_settings')) === 0 && (await count('user_capabilities')) === 0);
ok('the starting state is prod\'s: two accounts, Emil admin/active, the ghost member/suspended, NO settings, NO capabilities',
  (await count('app_users')) === 2
  && (await count(`app_users where id = $1 and role = 'admin' and account_status = 'active'`, [EMIL])) === 1
  && (await count(`app_users where id = $1 and role = 'member' and account_status = 'suspended'`, [GHOST])) === 1);

// ── helpers ─────────────────────────────────────────────────────────────────
// THE SHAPE: the settings row minus identity and timestamps, the set of
// GRANTED capabilities, and whether at least one audit row names the account.
async function shape(uid) {
  const s = await one(`select brief_email, brief_enabled, brief_hour_utc, cos_user_id, usage_user_id, timezone from user_settings where user_id = $1`, [uid]);
  const granted = (await all(`select capability from user_capabilities where user_id = $1 and granted order by capability`, [uid])).map((r) => r.capability);
  const audited = (await count('admin_audit where target_user_id = $1', [uid])) >= 1;
  return { settings: s || null, granted, audited };
}
function diff(a, b) {
  const out = [];
  const sa = JSON.stringify(a.settings), sb = JSON.stringify(b.settings);
  if (sa !== sb) out.push(`settings: ${sa} vs ${sb}`);
  if (a.granted.join(',') !== b.granted.join(',')) out.push(`granted: [${a.granted}] vs [${b.granted}]`);
  if (a.audited !== b.audited) out.push(`audited: ${a.audited} vs ${b.audited}`);
  return out;
}
const hasFreshShape = (s) => !!s.settings && s.settings.brief_enabled === false && s.settings.brief_hour_utc === 11
  && s.settings.brief_email === null && s.settings.cos_user_id === null && s.settings.usage_user_id === null && s.audited === true;
async function totals() {
  return {
    app_users: await count('app_users'), settings: await count('user_settings'),
    capabilities: await count('user_capabilities'), audit: await count('admin_audit'),
  };
}
async function call(fn, sql, params) {
  try { return { result: (await one(sql, params)).r, error: null }; }
  catch (e) { return { result: null, error: { message: e.message, code: e.code } }; }
}
const normalize = (actor, uid, caps) => call('normalize_account', 'select normalize_account($1::uuid, $2::uuid, $3::text[]) as r', [actor, uid, caps]);
const bind = (actor, uid, cos, usage) => call('bind_cos_identity', 'select bind_cos_identity($1::uuid, $2::uuid, $3::uuid, $4::uuid) as r', [actor, uid, cos, usage]);

// The service-role client for provisionUser(): rpc() runs the real function.
const client = {
  async rpc(name, args) {
    const keys = Object.keys(args);
    const cast = (k) => (k === 'p_capabilities' ? '::text[]' : k === 'p_actor_user_id' ? '::uuid' : '::text');
    const named = keys.map((k, i) => `${k} => $${i + 1}${cast(k)}`).join(', ');
    try {
      const r = await db.query(`select ${name}(${named}) as data`, keys.map((k) => args[k]));
      return { data: r.rows[0].data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } };
    }
  },
};
let phoneSeq = 0;
async function fresh(capabilities, displayName = 'Fresh') {
  const phone = '1786555' + String(1000 + (++phoneSeq)).slice(-4);
  return provisionUser({ actorUserId: EMIL, phone, displayName, capabilities }, { db: client });
}

// ── the fake Management API: the script's real SQL runs on this database ────
// Answers the one endpoint the helper calls, with the endpoint's real status
// (201) and row shape. Every query is recorded so the dry run can be proven
// to have sent reads only.
const received = [];
const jsonSafe = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
server = Bun.serve({
  port: 0, hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/database/query')) return new Response('not found', { status: 404 });
    if (req.headers.get('authorization') !== 'Bearer sbp_test_not_real') return new Response(jsonSafe({ message: 'bad token' }), { status: 401 });
    const { query } = await req.json();
    received.push(query);
    try {
      const results = await db.exec(query);
      const last = results[results.length - 1];
      return new Response(jsonSafe(last ? last.rows : []), { status: 201, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(jsonSafe({ message: e.message, code: e.code }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  },
});
const API_BASE = `http://127.0.0.1:${server.port}`;
function runScript(args, stdin = '') {
  return new Promise((resolve) => {
    const child = spawn('python3', [SCRIPT, ...args], {
      cwd: REPO,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_ACCESS_TOKEN: 'sbp_test_not_real', SUPABASE_MGMT_API_BASE: API_BASE,
             // A trap: if the script ever read these, the values would land on the row.
             COS_USER_ID: 'deadbeef-dead-4ead-8ead-deaddeaddead', COS_BRIEF_USAGE_USER_ID: 'deadbeef-dead-4ead-8ead-deaddeaddead' },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
    child.on('close', (code) => resolve({ code, out, err, all: out + err }));
  });
}
const COS_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const USAGE_ID = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const ARGS = ['--cos-user-id', COS_ID, '--usage-user-id', USAGE_ID];
const isWrite = (q) => /\bselect\s+(normalize_account|bind_cos_identity|provision_user)\s*\(/i.test(q) || /\b(insert|update|delete)\b/i.test(q);

section('the backfill script — python3 present, and it never reads Railway or the CoS env variables');
{
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  ok('python3 is available (a missing interpreter is a battery FAILURE, not a skip — this is the only stage that runs the script)', py.status === 0, py.stderr);
  const src = readFileSync(SCRIPT, 'utf8');
  const code = src.replace(/^"""[\s\S]*?"""/m, '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  // The help strings NAME the Railway variables so Emil knows where to read
  // them; strip string literals, then require no environment read, no
  // subprocess, and no mention of railway or the variables in code.
  const codeNoStrings = code.replace(/\"\"\"[\s\S]*?\"\"\"/g, '""').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const wordHits = codeNoStrings.split('\n').filter((l) => /railway/i.test(l) || /COS_USER_ID|COS_BRIEF_USAGE_USER_ID/.test(l));
  ok('the script\'s code never runs railway (no subprocess) and never reads COS_USER_ID / COS_BRIEF_USAGE_USER_ID from the environment (no environ/getenv) — the two ids come from the command line only',
    !/environ|getenv|subprocess/.test(code) && wordHits.length === 0, { hits: code.match(/environ|getenv|subprocess/g), wordHits });
  ok('the script carries no copy of the capability vocabulary (it reads the check constraint)', !/write_workspace|receive_sms/.test(code));
}

section('the backfill script — DRY RUN by default writes nothing');
{
  const before = await totals();
  received.length = 0;
  const r = await runScript(ARGS);
  ok('dry run exits 0 and says so', r.code === 0 && /DRY RUN — nothing written/.test(r.out), { code: r.code, tail: r.all.slice(-600) });
  ok('dry run identified Emil by his id and the ghost as the one suspended member, and printed the plan',
    r.out.includes(`Emil  = ${EMIL}`) && r.out.includes(`ghost = ${GHOST}`) && /normalize_account\(.*\) as result/.test(r.out) && /bind_cos_identity\(/.test(r.out));
  ok('dry run read the vocabulary from the constraint (four names)', /capability vocabulary, from the check constraint: \['receive_brief', 'receive_sms', 'run_agents', 'write_workspace'\]|\['run_agents', 'write_workspace', 'receive_brief', 'receive_sms'\]/.test(r.out), r.out.match(/vocabulary.*\n/)?.[0]);
  const writes = received.filter(isWrite);
  ok('every request the dry run sent was a READ — no normalize_account, bind_cos_identity or provision_user call, no INSERT/UPDATE/DELETE',
    received.length >= 2 && writes.length === 0, { sent: received.length, writes });
  const after = await totals();
  ok('dry run: the database did not move (settings 0, capabilities 0, audit unchanged)',
    JSON.stringify(before) === JSON.stringify(after) && after.settings === 0, { before, after });
  const noArgs = await runScript([]);
  ok('without the two ids the script refuses before sending anything', noArgs.code !== 0 && /required: --cos-user-id/.test(noArgs.err));
  const badId = await runScript(['--cos-user-id', COS_ID, '--usage-user-id', 'not-a-uuid']);
  ok('a non-uuid id is refused before sending anything', badId.code !== 0 && /is not a uuid/.test(badId.all));
  ok('…and nothing was written by either refusal', JSON.stringify(await totals()) === JSON.stringify(before));
}

section('the backfill script — --commit shapes both accounts and binds Emil\'s CoS identity');
{
  const before = await totals();
  received.length = 0;
  const r = await runScript([...ARGS, '--commit'], 'yes\n');
  ok('--commit exits 0 with the post-check passed', r.code === 0 && /Done\. Both accounts now have the shape/.test(r.out), { code: r.code, tail: r.all.slice(-900) });
  const writes = received.filter(isWrite);
  ok('exactly three writes were sent, in order: normalize Emil, normalize the ghost, bind Emil',
    writes.length === 3 && new RegExp(`normalize_account\\('${EMIL}'::uuid, '${EMIL}'::uuid`).test(writes[0])
      && new RegExp(`normalize_account\\('${EMIL}'::uuid, '${GHOST}'::uuid, '\\{\\}'::text\\[\\]`).test(writes[1])
      && new RegExp(`bind_cos_identity\\('${EMIL}'::uuid, '${EMIL}'::uuid, '${COS_ID}'::uuid, '${USAGE_ID}'::uuid`).test(writes[2]), writes);
  const es = await shape(EMIL);
  ok('Emil: a settings row with the defaults, delivery NOT armed, every capability granted, audited',
    !!es.settings && es.settings.brief_enabled === false && es.settings.brief_hour_utc === 11
      && es.granted.join(',') === 'receive_brief,receive_sms,run_agents,write_workspace' && es.audited, es);
  ok('Emil: cos_user_id and usage_user_id are the two COMMAND-LINE values — not the trap values in the environment',
    es.settings.cos_user_id === COS_ID && es.settings.usage_user_id === USAGE_ID, es.settings);
  const gs = await shape(GHOST);
  ok('the ghost: a settings row, delivery NOT armed, NOTHING granted, audited — complete shape, can do nothing',
    !!gs.settings && gs.settings.brief_enabled === false && gs.granted.length === 0 && gs.settings.cos_user_id === null && gs.audited, gs);
  const eAudit = (await all(`select action, detail from admin_audit where target_user_id = $1 order by at, id`, [EMIL]));
  ok('Emil\'s audit trail: one normalize_account row (capabilities, settings_created true) and one bind_cos_identity row (both ids, previous NULL), actor Emil',
    eAudit.length === 2 && eAudit[0].action === 'normalize_account' && eAudit[0].detail.settings_created === true
      && eAudit[1].action === 'bind_cos_identity' && eAudit[1].detail.cos_user_id === COS_ID && eAudit[1].detail.previous_cos_user_id === null
      && (await count(`admin_audit where target_user_id = $1 and actor_user_id = $1`, [EMIL])) === 2, eAudit);
  const after = await totals();
  ok('totals: settings 0 → 2, app_users unchanged (the script creates no account), audit +3',
    before.settings === 0 && after.settings === 2 && after.app_users === before.app_users && after.audit === before.audit + 3, { before, after });
  ok('the post-check output lists every row read back', r.out.includes(`${EMIL}  role=admin`) && r.out.includes(`${GHOST}  role=member`) && /totals after:/.test(r.out));
}

section('THE DIFF — Emil (backfilled) vs a freshly provisioned account, with controls');
{
  const emil = await shape(EMIL);
  const f1 = await fresh(['run_agents', 'write_workspace', 'receive_brief', 'receive_sms'], 'Fresh One');
  const f2 = await fresh(['run_agents', 'write_workspace', 'receive_brief', 'receive_sms'], 'Fresh Two');
  const s1 = await shape(f1.user_id), s2 = await shape(f2.user_id);
  // Guard first: the fresh account really has a shape. Without this, an empty
  // diff could mean both sides are empty.
  ok('guard: the fresh account HAS a settings row with the column defaults and at least one audit row', hasFreshShape(s1), s1);
  ok('guard: the fresh account carries exactly one provision_user and one normalize_account audit row',
    (await count(`admin_audit where target_user_id = $1 and action = 'provision_user'`, [f1.user_id])) === 1
      && (await count(`admin_audit where target_user_id = $1 and action = 'normalize_account'`, [f1.user_id])) === 1);
  // Emil's row carries the bound CoS ids; a fresh one does not. That is the
  // ONE intended difference and it is bind_cos_identity's, not the backfill's.
  // Diff the shape with the two bound columns masked, and separately assert
  // they are the only difference.
  const mask = (s) => ({ ...s, settings: s.settings && { ...s.settings, cos_user_id: null, usage_user_id: null } });
  const d = diff(mask(emil), s1);
  ok('backfill diff: Emil\'s shape (settings defaults, granted set, audited) vs a fresh account with the same four capabilities is EMPTY', d.length === 0, d);
  const dRaw = diff(emil, s1);
  ok('…and unmasked, the ONLY difference is the two CoS ids bind_cos_identity set', dRaw.length === 1 && /cos_user_id/.test(dRaw[0]) && !/granted|audited/.test(dRaw.join()), dRaw);
  ok('control: two freshly provisioned accounts diff EMPTY', diff(s1, s2).length === 0, diff(s1, s2));

  // The discriminating control: a row that has NOT been shaped diffs NON-EMPTY.
  const july = (await one(`insert into app_users (phone, timezone, role, account_status) values ('17860000009', 'America/New_York', 'member', 'active') returning id`)).id;
  const dJuly = diff(await shape(july), s1);
  ok('discriminating control: an un-shaped July row diffs NON-EMPTY against a fresh account (settings, granted and audited all differ)',
    dJuly.length === 3, dJuly);
  const n = await normalize(EMIL, july, ['run_agents', 'write_workspace', 'receive_brief', 'receive_sms']);
  ok('…then normalize_account shapes it and the diff is EMPTY', !n.error && diff(await shape(july), s1).length === 0, n.error || diff(await shape(july), s1));

  // The ghost: the empty set against a fresh account with no capabilities.
  const f0 = await fresh([], 'Fresh Empty');
  const s0 = await shape(f0.user_id);
  ok('guard: a fresh account with NO capabilities still has settings and an audit row', hasFreshShape(s0) && s0.granted.length === 0, s0);
  ok('the ghost (normalised with the EMPTY set) vs a fresh account with no capabilities: diff EMPTY', diff(await shape(GHOST), s0).length === 0, diff(await shape(GHOST), s0));
  ok('discriminating control: the ghost vs the four-capability fresh account: diff NON-EMPTY (granted)', diff(await shape(GHOST), s1).some((x) => /granted/.test(x)), diff(await shape(GHOST), s1));
}

section('idempotency — normalize_account twice changes nothing and adds exactly one audit row');
{
  const setBefore = await one('select to_jsonb(s) as j from user_settings s where user_id = $1', [EMIL]);
  const capBefore = await all('select to_jsonb(c) as j from user_capabilities c where user_id = $1 order by capability', [EMIL]);
  const before = await totals();
  const r = await normalize(EMIL, EMIL, ['receive_sms', 'run_agents', 'write_workspace', 'receive_brief', ' run_agents ']);  // same set, other order, a duplicate
  const setAfter = await one('select to_jsonb(s) as j from user_settings s where user_id = $1', [EMIL]);
  const capAfter = await all('select to_jsonb(c) as j from user_capabilities c where user_id = $1 order by capability', [EMIL]);
  const after = await totals();
  ok('the second call resolves and reports settings_created false, nothing revoked', !r.error && r.result.settings_created === false && r.result.revoked.length === 0, r.error || r.result);
  ok('the settings row is byte-identical (updated_at included) — the bound CoS ids survive', JSON.stringify(setBefore) === JSON.stringify(setAfter), { setBefore, setAfter });
  ok('every capability row is byte-identical (granted_at included)', JSON.stringify(capBefore) === JSON.stringify(capAfter), { capBefore, capAfter });
  ok('row counts: settings and capabilities unchanged, audit exactly +1',
    after.settings === before.settings && after.capabilities === before.capabilities && after.audit === before.audit + 1, { before, after });
}

section('the exact set — revocation keeps the row, re-grant restores it');
{
  const july = (await one(`select id from app_users where phone = '17860000009'`)).id;
  const r = await normalize(EMIL, july, ['receive_brief']);
  const rows = await all('select capability, granted from user_capabilities where user_id = $1 order by capability', [july]);
  ok('a smaller set revokes the others: granted = false, rows KEPT (4 rows, 1 granted), the return names the three revoked',
    !r.error && rows.length === 4 && rows.filter((x) => x.granted).map((x) => x.capability).join() === 'receive_brief'
      && JSON.stringify(r.result.revoked) === '["receive_sms","run_agents","write_workspace"]', r.error || { rows, r: r.result });
  const e = await normalize(EMIL, july, []);
  ok('the EMPTY set: zero granted, all 4 rows kept, settings row still present',
    !e.error && (await count('user_capabilities where user_id = $1 and granted', [july])) === 0
      && (await count('user_capabilities where user_id = $1', [july])) === 4 && (await count('user_settings where user_id = $1', [july])) === 1, e.error);
  const back = await normalize(EMIL, july, ['run_agents']);
  ok('re-granting one restores it with the actor as granted_by; the settings row was never re-created (settings_created false)',
    !back.error && back.result.settings_created === false
      && (await one('select granted, granted_by from user_capabilities where user_id = $1 and capability = $2', [july, 'run_agents'])).granted === true, back.error);
}

section('refusals write nothing');
{
  const member = (await one(`insert into app_users (phone, timezone, role, account_status) values ('17860000010', 'America/New_York', 'member', 'active') returning id`)).id;
  const susp = (await one(`insert into app_users (phone, timezone, role, account_status) values ('17860000011', 'America/New_York', 'admin', 'suspended') returning id`)).id;
  const bare = (await one(`insert into app_users (phone, timezone, role, account_status) values ('17860000012', 'America/New_York', 'member', 'active') returning id`)).id;
  const before = await totals();
  const a = await normalize(member, bare, ['run_agents']);
  ok('normalize_account: a member actor is refused with 42501', !!a.error && a.error.code === '42501', a.error);
  const b = await normalize(susp, bare, ['run_agents']);
  ok('normalize_account: a SUSPENDED admin actor is refused with 42501', !!b.error && b.error.code === '42501', b.error);
  const c = await normalize(EMIL, '00000000-0000-0000-0000-00000000dead', ['run_agents']);
  ok('normalize_account: an unknown target is refused with 23503', !!c.error && c.error.code === '23503', c.error);
  const d = await normalize(EMIL, bare, ['run_agents', 'run_agent']);
  ok('normalize_account: an invalid capability is refused with 23514 by the constraint — and the settings row written before it is unwound',
    !!d.error && d.error.code === '23514' && (await count('user_settings where user_id = $1', [bare])) === 0, d.error);
  const e = await normalize(null, bare, ['run_agents']);
  ok('normalize_account: a NULL actor is refused with 42501', !!e.error && e.error.code === '42501', e.error);
  ok('none of the refused calls wrote anything', JSON.stringify(before) === JSON.stringify(await totals()), { before, after: await totals() });

  // bind_cos_identity refusals
  const before2 = await totals();
  const nb = await bind(EMIL, bare, COS_ID, USAGE_ID);
  ok('bind_cos_identity: an account with no settings row is refused with P0002 (normalize first) — no settings row is created by a side door',
    !!nb.error && nb.error.code === 'P0002' && (await count('user_settings where user_id = $1', [bare])) === 0, nb.error);
  await normalize(EMIL, bare, []);
  const dup = await bind(EMIL, bare, COS_ID, 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3');
  ok('bind_cos_identity: a CoS id already bound to Emil is refused for another account with 23505', !!dup.error && dup.error.code === '23505', dup.error);
  const nul = await bind(EMIL, bare, null, USAGE_ID);
  ok('bind_cos_identity: a NULL id is refused with 22023', !!nul.error && nul.error.code === '22023', nul.error);
  const mem = await bind(member, bare, 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', USAGE_ID);
  ok('bind_cos_identity: a member actor is refused with 42501', !!mem.error && mem.error.code === '42501', mem.error);
  const unk = await bind(EMIL, '00000000-0000-0000-0000-00000000dead', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', USAGE_ID);
  ok('bind_cos_identity: an unknown account is refused with 23503', !!unk.error && unk.error.code === '23503', unk.error);
  const after2 = await totals();
  ok('the refused binds wrote nothing (one normalize in between: settings +1, audit +1, nothing else)',
    after2.settings === before2.settings + 1 && after2.audit === before2.audit + 1 && after2.capabilities === before2.capabilities
      && (await one('select cos_user_id from user_settings where user_id = $1', [bare])).cos_user_id === null, { before2, after2 });
  const re = await bind(EMIL, EMIL, 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', USAGE_ID);
  ok('control: a re-bind of Emil succeeds and records the previous ids in the return and the audit row',
    !re.error && re.result.previous_cos_user_id === COS_ID
      && (await one(`select detail from admin_audit where target_user_id = $1 and action = 'bind_cos_identity' order by at desc, id desc limit 1`, [EMIL])).detail.previous_cos_user_id === COS_ID, re.error || re.result);
}

section('the backfill script — the pre-check REFUSES a world it was not written for');
{
  // Three rows now exist beyond Emil and the ghost without settings (member, susp, and the July rows are shaped; member and susp are not).
  const before = await totals();
  received.length = 0;
  const r = await runScript([...ARGS, '--commit'], 'yes\n');
  ok('with other un-shaped accounts present, --commit STOPS before writing (exit non-zero, names the rows)',
    r.code !== 0 && /STOP: these accounts are neither Emil nor the ghost and have NO settings row/.test(r.all), { code: r.code, tail: r.all.slice(-500) });
  ok('…and sent no write', received.filter(isWrite).length === 0 && JSON.stringify(before) === JSON.stringify(await totals()));
  // Control: shape those rows and the script runs again — a RE-RUN is safe by idempotency.
  for (const ph of ['17860000010', '17860000011']) {
    const id = (await one('select id from app_users where phone = $1', [ph])).id;
    await normalize(EMIL, id, []);
  }
  // A second suspended member would make "the ghost" ambiguous: the script must refuse that too.
  await db.exec(`update app_users set account_status = 'suspended' where phone = '17860000010'`);
  const amb = await runScript(ARGS);
  ok('two suspended members: the script refuses to guess which is the ghost', amb.code !== 0 && /expected exactly one suspended member/.test(amb.all), amb.all.slice(-300));
  await db.exec(`update app_users set account_status = 'active' where phone = '17860000010'`);
  const setBefore = await one('select to_jsonb(s) as j from user_settings s where user_id = $1', [GHOST]);
  const b2 = await totals();
  const rerun = await runScript([...ARGS, '--commit'], 'yes\n');
  const setAfter = await one('select to_jsonb(s) as j from user_settings s where user_id = $1', [GHOST]);
  ok('control: once every other account is shaped, a RE-RUN with --commit succeeds, announces it is a re-run, and changes no settings row (audit +3 only)',
    rerun.code === 0 && /this is a re-run/.test(rerun.out) && JSON.stringify(setBefore) === JSON.stringify(setAfter)
      && (await totals()).settings === b2.settings && (await totals()).audit === b2.audit + 3, { code: rerun.code, tail: rerun.all.slice(-400) });
  ok('the re-run re-bound Emil to the command-line ids (the earlier re-bind test had moved them)',
    (await one('select cos_user_id, usage_user_id from user_settings where user_id = $1', [EMIL])).cos_user_id === COS_ID);
}

section('pins — the shape the migration promised');
{
  const defs = {};
  for (const f of ['normalize_account', 'bind_cos_identity', 'provision_user']) {
    defs[f] = await one(`select p.prosecdef, p.provolatile, p.proconfig, p.proargnames, pg_get_functiondef(p.oid) as def
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = $1`, [f]);
  }
  ok('all three: SECURITY DEFINER, search_path pinned to public, pg_temp, VOLATILE',
    Object.values(defs).every((r) => r && r.prosecdef === true && r.provolatile === 'v' && r.proconfig.includes('search_path=public, pg_temp')),
    Object.fromEntries(Object.entries(defs).map(([k, r]) => [k, r && { prosecdef: r.prosecdef, proconfig: r.proconfig }])));
  ok('argument lists pinned: normalize_account(actor, user_id, capabilities); bind_cos_identity(actor, user_id, cos_user_id, usage_user_id); provision_user unchanged from P1.2',
    JSON.stringify(defs.normalize_account.proargnames) === '["p_actor_user_id","p_user_id","p_capabilities"]'
      && JSON.stringify(defs.bind_cos_identity.proargnames) === '["p_actor_user_id","p_user_id","p_cos_user_id","p_usage_user_id"]'
      && JSON.stringify(defs.provision_user.proargnames) === '["p_actor_user_id","p_phone","p_display_name","p_capabilities","p_timezone"]');
  ok('ONE CODE PATH: provision_user\'s live body calls normalize_account(p_actor_user_id, v_user_id, v_caps) and writes no settings or capability row itself',
    /normalize_account\s*\(\s*p_actor_user_id\s*,\s*v_user_id\s*,\s*v_caps\s*\)/.test(defs.provision_user.def)
      && !/insert\s+into\s+user_settings/i.test(defs.provision_user.def) && !/insert\s+into\s+user_capabilities/i.test(defs.provision_user.def));
  ok('bind_cos_identity never inserts a settings row; normalize_account never deletes a capability row',
    !/insert\s+into\s+user_settings/i.test(defs.bind_cos_identity.def) && !/delete\s+from\s+user_capabilities/i.test(defs.normalize_account.def));
  ok('no function body carries a copy of the capability vocabulary, or updates/deletes admin_audit',
    Object.values(defs).every((r) => !/write_workspace/.test(r.def) && !/\b(update|delete\s+from)\s+admin_audit\b/i.test(r.def)));
  const priv = await one(`select
      has_function_privilege('anon', 'normalize_account(uuid, uuid, text[])', 'execute') as n_anon,
      has_function_privilege('authenticated', 'normalize_account(uuid, uuid, text[])', 'execute') as n_auth,
      has_function_privilege('service_role', 'normalize_account(uuid, uuid, text[])', 'execute') as n_svc,
      has_function_privilege('anon', 'bind_cos_identity(uuid, uuid, uuid, uuid)', 'execute') as b_anon,
      has_function_privilege('authenticated', 'bind_cos_identity(uuid, uuid, uuid, uuid)', 'execute') as b_auth,
      has_function_privilege('service_role', 'bind_cos_identity(uuid, uuid, uuid, uuid)', 'execute') as b_svc,
      has_function_privilege('authenticated', 'provision_user(uuid, text, text, text[], text)', 'execute') as p_auth,
      has_function_privilege('service_role', 'provision_user(uuid, text, text, text[], text)', 'execute') as p_svc,
      has_column_privilege('authenticated', 'user_settings', 'cos_user_id', 'update') as col_cos,
      has_column_privilege('authenticated', 'user_settings', 'usage_user_id', 'update') as col_usage,
      has_column_privilege('authenticated', 'user_settings', 'brief_enabled', 'update') as col_brief,
      has_table_privilege('authenticated', 'user_settings', 'insert') as tbl_insert`);
  ok('execute: anon NO, authenticated NO, service_role YES — for all three',
    priv.n_anon === false && priv.n_auth === false && priv.n_svc === true && priv.b_anon === false && priv.b_auth === false && priv.b_svc === true
      && priv.p_auth === false && priv.p_svc === true, priv);
  ok('authenticated may not UPDATE cos_user_id / usage_user_id and may not INSERT into user_settings — alongside the control that it MAY update brief_enabled on its own row',
    priv.col_cos === false && priv.col_usage === false && priv.tbl_insert === false && priv.col_brief === true, priv);
}

await finish();
