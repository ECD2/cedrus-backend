// Bundle 42 — provisionUser() is ONE atomic operation (BUILD_PLAN P1.2).
// Run: bun test/provision-user.test.mjs
//
// WHAT THIS SUITE IS FOR
// Five things happen or none do: the sign-in identity, the app_users row, the
// user_settings defaults, the user_capabilities grants and exactly one
// admin_audit entry. The claim is atomicity, and atomicity cannot be proven by
// mocking a client: a fake that "fails on call three" only proves the fake
// behaves the way you told it to. So every assertion here runs against a REAL
// Postgres — PGlite, Postgres 17 compiled to WebAssembly, in-process — with the
// REAL migration files applied to it, and every failure is forced INSIDE the
// database transaction: by the closed capability vocabulary's own check
// constraint, and by triggers installed on the very tables the function writes.
//
// WHAT RUNS REAL HERE
//   • supabase/migrations/20260830120000_multiuser_foundation.sql, verbatim,
//     including its own in-transaction self-proof and controls
//   • supabase/migrations/20260909120000_provision_user.sql, verbatim, ditto
//   • supabase/migrations/20260909210000_normalize_account.sql, verbatim, ditto
//     — P1.3 REDEFINES provision_user so that its tail (settings, grants, one
//     audit row) runs inside normalize_account(). The function under test is
//     the LIVE one, i.e. after all three files, exactly as production has it.
//     A fresh account therefore carries TWO audit rows: provision_user (the
//     identity) and normalize_account (the shape). Bundle 44 owns the shape.
//   • src/services/provisioning.js, the thin caller, through a client whose
//     rpc() executes the real function on the real database
//
// WHAT IS A FIXTURE, AND WHY THAT IS STATED (Lesson 20)
//   • app_users, auth.users and auth.identities are recreated here from what
//     this repo's code writes and reads (users.js, webOnboarding.js, auth.js)
//     and from GoTrue's published schema. No prod dump of app_users exists in
//     this repo, so the fixture is this session's understanding, not the
//     database's own description of itself. The three multi-user tables are NOT
//     fixtures — the real migration creates them.
//   • link_or_create_app_user_from_auth, the production trigger on auth.users
//     that auth.js:17 names, is not in this repo and could not be read from
//     this machine. It is EMULATED (link by phone, else create). One test then
//     swaps in the hostile variant — always create a second account — and
//     proves provision_user refuses and unwinds, so the function is safe under
//     either behaviour.
//
// EVERY "NOTHING SURVIVED" ASSERTION HAS A CONTROL. The successful path creates
// all five FIRST, in this same process, against this same database, so
// "zero rows" afterwards cannot be a function that never ran.

import { readFileSync } from 'node:fs';
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

// DYNAMIC import: config.js calls required() at module scope, and a static
// import would be hoisted above the env assignments (same as bundles 36–41).
const { provisionUser, PROVISION_RPC } = await import('../src/services/provisioning.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const FOUNDATION_SQL = readFileSync(join(REPO, 'supabase/migrations/20260830120000_multiuser_foundation.sql'), 'utf8');
const PROVISION_SQL = readFileSync(join(REPO, 'supabase/migrations/20260909120000_provision_user.sql'), 'utf8');
const NORMALIZE_SQL = readFileSync(join(REPO, 'supabase/migrations/20260909210000_normalize_account.sql'), 'utf8');

const p = console.log;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) p('  PASS  ' + name);
  else { failures++; p('  FAIL  ' + name + (detail !== undefined ? '  -- ' + JSON.stringify(detail) : '')); }
}
const section = (n) => { p(''); p('— ' + n + ' —'); };
function finish() {
  p('');
  if (failures) { p(`BUNDLE 42: ${failures} FAILURE(S)`); process.exit(1); }
  p('BUNDLE 42: ALL PASSED');
  process.exit(0);
}

p('=== Bundle 42 — provisionUser() is one atomic operation ===');

// ── the database ────────────────────────────────────────────────────────────
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(`select count(*)::int as n from ${sql}`, params)).n);

const FIXTURE_SQL = `
-- Supabase's three API roles. The migrations GRANT/REVOKE against them.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

-- auth schema: GoTrue's tables, the columns provision_user writes plus the
-- ones GoTrue reads back on sign-in (the NULL-string trap lives in the four
-- token columns). auth.uid() answers NULL: nothing here runs under a JWT.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text unique default null,
  phone_confirmed_at timestamptz,
  phone_change text default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status smallint default 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data->>'email')) stored,
  unique (provider_id, provider)
);

-- app_users as this repo's code writes it (users.js, webOnboarding.js) plus
-- the facts II.5 records: phone UNIQUE and digits-only, trial_ends_at NOT NULL
-- (so it must carry a default — findOrCreateByPhone never sets it), and the
-- updated_at trigger. The multi-user columns are NOT here: the real migration
-- adds them.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  timezone text not null default 'America/New_York',
  auth_user_id uuid,
  sms_consent_at timestamptz,
  consent_source text,
  trial_ends_at timestamptz not null default now() + interval '14 days',
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_app_users_updated_at before update on app_users
  for each row execute function set_updated_at();

-- EMULATION of prod's link_or_create_app_user_from_auth (body unknown from
-- this machine): link the account with this phone, else create one.
create function link_or_create_app_user_from_auth() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.phone is null then return new; end if;
  update app_users set auth_user_id = new.id where phone = new.phone;
  if not found then insert into app_users (phone, auth_user_id) values (new.phone, new.id); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function link_or_create_app_user_from_auth();

-- Two pre-existing accounts, the way July's rows look: member, active, no
-- settings, no capabilities. The foundation migration asserts exactly that.
insert into app_users (phone, name, sms_consent_at, consent_source) values
  ('17860000001', 'Emil', now(), 'first_message'),
  ('17860000002', 'July Member', now(), 'first_message');
`;

let applied = false;
let applyError = null;
try {
  await db.exec(FIXTURE_SQL);
  await db.exec(FOUNDATION_SQL);
  // F0.1 — the one hand-made bootstrap promotion, and a suspended admin so the
  // actor guard's middle case has a real row to refuse.
  await db.exec(`
    update app_users set role = 'admin' where phone = '17860000001';
    insert into app_users (phone, name, role, account_status) values ('17860000003', 'Suspended Admin', 'admin', 'suspended');
  `);
  await db.exec(PROVISION_SQL);
  await db.exec(NORMALIZE_SQL);
  applied = true;
} catch (e) {
  applyError = { message: e.message, code: e.code, detail: e.detail };
}

section('the migrations, with their own in-transaction self-proof');
ok('the foundation, provision_user and normalize_account migrations all applied — every assertion and control inside them passed', applied, applyError);
if (!applied) finish();

const EMIL = (await one(`select id from app_users where phone = '17860000001'`)).id;
const MEMBER = (await one(`select id from app_users where phone = '17860000002'`)).id;
const SUSPENDED = (await one(`select id from app_users where phone = '17860000003'`)).id;

// The migration's controls provision and unwind two accounts. Nothing of them
// may be here now — this is the migration's own claim, read back.
ok('the migration\'s controls left no rows behind (control phones, provision audit rows)',
  (await count(`app_users where phone in ('15550100142','15550100143')`)) === 0
  && (await count(`auth.users where phone in ('15550100142','15550100143')`)) === 0
  && (await count(`admin_audit where action in ('provision_user', 'normalize_account')`)) === 0);

// ── the client: rpc() runs the real function on the real database ───────────
// Shaped like supabase-js: { data, error } and never throws, with the SQLSTATE
// in error.code — the contract Lesson 11 warns about, reproduced faithfully so
// the caller under test is the one deciding what to do with an error.
const calls = [];
function makeClient() {
  return {
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args: { ...args } });
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
    from(table) {
      return {
        async insert(rows) {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.push({ kind: 'insert', table, rows: list });
          try {
            for (const row of list) {
              const cols = Object.keys(row);
              await db.query(
                `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`,
                cols.map((c) => row[c]));
            }
            return { data: null, error: null };
          } catch (e) {
            return { data: null, error: { message: e.message, code: e.code, details: e.detail } };
          }
        },
      };
    },
  };
}
const client = makeClient();
const provision = (input) => provisionUser(input, { db: client });

async function totals() {
  return {
    app_users: await count('app_users'),
    auth_users: await count('auth.users'),
    identities: await count('auth.identities'),
    settings: await count('user_settings'),
    capabilities: await count('user_capabilities'),
    audit: await count('admin_audit'),
  };
}
async function rowsFor(phone) {
  return {
    app_users: await count('app_users where phone = $1', [phone]),
    auth_users: await count('auth.users where phone = $1', [phone]),
    identities: await count('auth.identities where provider_id = $1', [phone]),
    audit: await count(`admin_audit where action = 'provision_user' and detail->>'phone_last4' = $1`, [phone.slice(-4)]),
  };
}
async function attempt(input) {
  try { return { result: await provision(input), error: null }; }
  catch (e) { return { result: null, error: e }; }
}
const allZero = (r) => Object.values(r).every((v) => v === 0);
const sameTotals = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── CONTROL: the successful path creates all five ───────────────────────────
section('control — the successful path creates all five');
{
  const auditBefore = await count('admin_audit');
  ok('audit rows for provisioning start at 0', auditBefore === 0, auditBefore);

  calls.length = 0;
  const { result, error } = await attempt({
    actorUserId: EMIL,
    phone: '+1 (786) 555-0199',                       // any format in; digits out
    displayName: '  Dad ',
    capabilities: ['receive_brief', 'receive_sms', 'receive_brief'],  // duplicate on purpose
  });
  ok('provisionUser resolves', !error, error && { message: error.message, code: error.code });
  const uid = result && result.user_id;
  const aid = result && result.auth_user_id;

  const u = uid && await one(`select phone, role, account_status, display_name, invited_by, auth_user_id, timezone from app_users where id = $1`, [uid]);
  ok('1/5 the app_users row: member, active, invited by the actor, phone in THE ONE TRUE FORMAT',
    !!u && u.phone === '17865550199' && u.role === 'member' && u.account_status === 'active'
      && u.invited_by === EMIL && u.display_name === 'Dad' && u.timezone === 'America/New_York', u);
  const a = aid && await one(`select phone, aud, role, phone_confirmed_at, confirmed_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data from auth.users where id = $1`, [aid]);
  ok('2/5 the sign-in identity: auth.users row, phone confirmed, token columns \'\' not NULL, phone provider',
    !!a && a.phone === '17865550199' && a.aud === 'authenticated' && a.role === 'authenticated'
      && a.phone_confirmed_at !== null && a.confirmed_at !== null
      && [a.confirmation_token, a.recovery_token, a.email_change_token_new, a.email_change].every((t) => t === '')
      && a.raw_app_meta_data && a.raw_app_meta_data.provider === 'phone', a);
  const ident = aid && await one(`select provider, provider_id, identity_data from auth.identities where user_id = $1`, [aid]);
  ok('2/5 …and its auth.identities row (provider phone, sub = the auth id)',
    !!ident && ident.provider === 'phone' && ident.provider_id === '17865550199' && ident.identity_data.sub === aid, ident);
  ok('the account is LINKED to the identity (app_users.auth_user_id = auth.users.id), exactly one row each way',
    !!u && u.auth_user_id === aid
      && (await count('app_users where auth_user_id = $1', [aid])) === 1
      && (await count('app_users where phone = $1', ['17865550199'])) === 1);
  const s = uid && await one(`select brief_enabled, brief_hour_utc, brief_email, cos_user_id, usage_user_id from user_settings where user_id = $1`, [uid]);
  ok('3/5 the settings row exists with the column defaults — delivery NOT armed (brief_enabled = false)',
    !!s && s.brief_enabled === false && s.brief_hour_utc === 11 && s.brief_email === null && s.cos_user_id === null, s);
  const caps = uid ? (await db.query(`select capability, granted, granted_by from user_capabilities where user_id = $1 order by capability`, [uid])).rows : [];
  ok('4/5 the capability grants: the two distinct names, granted, by the actor (the duplicate collapsed)',
    caps.length === 2 && caps.every((c) => c.granted === true && c.granted_by === EMIL)
      && caps.map((c) => c.capability).join(',') === 'receive_brief,receive_sms', caps);
  const aud = uid ? (await db.query(`select actor_user_id, action, target_user_id, detail from admin_audit where target_user_id = $1 and action = 'provision_user'`, [uid])).rows : [];
  ok('5/5 exactly ONE provision_user audit entry: actor, action provision_user, target, last-4 of the phone (never the full number), the capabilities',
    aud.length === 1 && aud[0].actor_user_id === EMIL && aud[0].action === 'provision_user'
      && aud[0].detail.phone_last4 === '0199' && !JSON.stringify(aud[0].detail).includes('17865550199')
      && JSON.stringify(aud[0].detail.capabilities) === '["receive_brief","receive_sms"]', aud);

  const auditAfter = await count('admin_audit');
  ok('the audit row count went 0 → exactly 2: one provision_user row (the identity) and one normalize_account row (the shape, P1.3) — not 3, not 1',
    auditBefore === 0 && auditAfter === 2
      && (await count(`admin_audit where target_user_id = $1 and action = 'normalize_account'`, [uid])) === 1, { auditBefore, auditAfter });

  ok('the return value names the new ids and the normalised capabilities',
    !!result && typeof result.audit_id === 'string' && result.phone === '17865550199'
      && JSON.stringify(result.capabilities) === '["receive_brief","receive_sms"]', result);

  ok('the JS caller made exactly ONE call, an rpc to provision_user — no second write anywhere',
    calls.length === 1 && calls[0].kind === 'rpc' && calls[0].name === PROVISION_RPC, calls.map((c) => c.kind + ':' + (c.name || c.table)));
  const argKeys = calls.length ? Object.keys(calls[0].args).sort().join(',') : '';
  ok('no caller-chosen ids: the rpc arguments carry the actor, the phone, the name and the capabilities, nothing else',
    argKeys === 'p_actor_user_id,p_capabilities,p_display_name,p_phone', argKeys);
}

// ── FAULT 1: the closed vocabulary, forced inside the transaction ───────────
section('fail it midway — after the account row, at the capability grant (closed vocabulary, forced by the check constraint)');
{
  const before = await totals();
  const { result, error } = await attempt({
    actorUserId: EMIL, phone: '17865550200', displayName: 'Partial One',
    capabilities: ['run_agents', 'run_agent'],   // the second one has no s
  });
  ok('fault at the capability step (closed vocabulary): the call is rejected with 23514, not resolved',
    !result && !!error && error.code === '23514', error && { message: error.message, code: error.code });
  const left = await rowsFor('17865550200');
  const after = await totals();
  ok('fault at the capability step (closed vocabulary): no partial account survives — zero app_users, auth.users, auth.identities, admin_audit rows for that phone; settings and capability totals unchanged',
    allZero(left) && sameTotals(before, after), { left, before, after });
  ok('fault at the capability step (closed vocabulary): the admin_audit total did not move (still exactly 2)',
    after.audit === 2 && before.audit === 2, { before: before.audit, after: after.audit });
}

// ── FAULT 2: a trigger on user_capabilities, with VALID names ───────────────
// Proves the unwind is the transaction's, not the vocabulary's: the names are
// all valid, and the failure is a trigger raising on the capability table
// itself, after the account, identity and settings rows are written.
section('fail it midway — a trigger raising on user_capabilities (valid names; the failure is the table itself)');
{
  await db.exec(`
    create function bundle42_fault() returns trigger language plpgsql as $$
    begin raise exception 'FAULT_INJECTED on %', tg_table_name using errcode = 'P0042'; end $$;
    create trigger bundle42_fault_caps before insert on user_capabilities for each row execute function bundle42_fault();
  `);
  const before = await totals();
  const { result, error } = await attempt({ actorUserId: EMIL, phone: '17865550201', capabilities: ['run_agents'] });
  ok('fault trigger on user_capabilities: the call is rejected with the injected error',
    !result && !!error && error.code === 'P0042' && /FAULT_INJECTED on user_capabilities/.test(error.message), error && { message: error.message, code: error.code });
  const left = await rowsFor('17865550201');
  const after = await totals();
  ok('fault trigger on user_capabilities: no partial account survives', allZero(left) && sameTotals(before, after), { left, before, after });
  await db.exec(`drop trigger bundle42_fault_caps on user_capabilities;`);

  // CONTROL for this fault: the identical call succeeds once the fault is gone,
  // so the zero above was the unwind and not a broken call.
  const again = await attempt({ actorUserId: EMIL, phone: '17865550201', capabilities: ['run_agents'] });
  const now = await rowsFor('17865550201');
  ok('control: the identical call succeeds with the fault trigger removed (all five present)',
    !again.error && now.app_users === 1 && now.auth_users === 1 && now.identities === 1 && now.audit === 1
      && (await count('user_settings where user_id = $1', [again.result.user_id])) === 1
      && (await count('user_capabilities where user_id = $1 and granted', [again.result.user_id])) === 1,
    { error: again.error && again.error.message, now });
}

// ── FAULT 3: the LAST step, the audit write ─────────────────────────────────
// If the audit INSERT were outside the transaction — "write the account, then
// log it" — the account would survive its logging failure. It must not.
section('fail it at the last step — a trigger raising on admin_audit');
{
  await db.exec(`create trigger bundle42_fault_audit before insert on admin_audit for each row execute function bundle42_fault();`);
  const before = await totals();
  const { result, error } = await attempt({ actorUserId: EMIL, phone: '17865550202', capabilities: ['receive_brief'] });
  ok('fault trigger on admin_audit: the call is rejected', !result && !!error && error.code === 'P0042', error && { message: error.message, code: error.code });
  const left = await rowsFor('17865550202');
  const after = await totals();
  ok('fault trigger on admin_audit: no partial account survives — an account that could not be audited was not created',
    allZero(left) && sameTotals(before, after), { left, before, after });
  await db.exec(`drop trigger bundle42_fault_audit on admin_audit; drop function bundle42_fault();`);
}

// ── the actor guard ─────────────────────────────────────────────────────────
section('the actor must be an ACTIVE admin');
{
  const before = await totals();
  const m = await attempt({ actorUserId: MEMBER, phone: '17865550300', capabilities: ['run_agents'] });
  ok('a member actor is refused with 42501', !m.result && !!m.error && m.error.code === '42501', m.error && { message: m.error.message, code: m.error.code });
  const s = await attempt({ actorUserId: SUSPENDED, phone: '17865550301', capabilities: ['run_agents'] });
  ok('a SUSPENDED admin is refused with 42501 (suspension removes all access, admin included)', !s.result && !!s.error && s.error.code === '42501', s.error && { code: s.error.code });
  const g = await attempt({ actorUserId: '00000000-0000-0000-0000-00000000dead', phone: '17865550302', capabilities: ['run_agents'] });
  ok('an unknown actor id is refused with 42501', !g.result && !!g.error && g.error.code === '42501', g.error && { code: g.error.code });
  const after = await totals();
  ok('none of the refused calls wrote anything', sameTotals(before, after)
    && allZero(await rowsFor('17865550300')) && allZero(await rowsFor('17865550301')) && allZero(await rowsFor('17865550302')), { before, after });

  calls.length = 0;
  const none = await attempt({ phone: '17865550303', capabilities: ['run_agents'] });
  ok('a missing actor is refused by the caller BEFORE any rpc (identity comes from the token, never defaulted)',
    !!none.error && /actorUserId is required/.test(none.error.message) && calls.length === 0, { message: none.error && none.error.message, calls: calls.length });
}

// ── an existing account, and a bad phone ────────────────────────────────────
section('refusals that must write nothing');
{
  const before = await totals();
  const dup = await attempt({ actorUserId: EMIL, phone: '17860000001', capabilities: [] });
  ok('an existing app_users phone is refused with 23505, by name', !dup.result && !!dup.error && dup.error.code === '23505' && /already exists/.test(dup.error.message), dup.error && { message: dup.error.message, code: dup.error.code });
  const bad = await attempt({ actorUserId: EMIL, phone: '123', capabilities: [] });
  ok('a phone that is not 10–15 digits is refused with 22023', !bad.result && !!bad.error && bad.error.code === '22023', bad.error && { code: bad.error.code, message: bad.error.message });
  const typed = await attempt({ actorUserId: EMIL, phone: '17865550304', capabilities: ['run_agents', 42] });
  ok('a non-string capability is refused by the caller before any rpc', !!typed.error && /array of strings/.test(typed.error.message));
  const after = await totals();
  ok('none of the refused calls wrote anything', sameTotals(before, after), { before, after });
}

// ── the auth-link trigger hazard ────────────────────────────────────────────
section('the production auth-link trigger, both ways');
{
  // Hostile variant: whatever GoTrue-side trigger runs, if it creates a SECOND
  // account for the identity, provision_user must notice and unwind.
  await db.exec(`
    create or replace function link_or_create_app_user_from_auth() returns trigger
    language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      insert into app_users (phone, auth_user_id) values (new.phone || '9', new.id);
      return new;
    end $$;
  `);
  const before = await totals();
  const { result, error } = await attempt({ actorUserId: EMIL, phone: '17865550400', capabilities: ['receive_brief'] });
  ok('a trigger that creates a second account for the identity makes the call raise (integrity_constraint_violation)',
    !result && !!error && error.code === '23000' && /second account/.test(error.message), error && { message: error.message, code: error.code });
  const after = await totals();
  ok('…and nothing survives, including the trigger\'s own row',
    sameTotals(before, after) && (await count(`app_users where phone like '17865550400%'`)) === 0, { before, after });

  // Restore the link-by-phone emulation and prove the same call now succeeds
  // with exactly one account, linked — the trigger linked rather than created.
  await db.exec(`
    create or replace function link_or_create_app_user_from_auth() returns trigger
    language plpgsql security definer set search_path = public, pg_temp as $$
    begin
      if new.phone is null then return new; end if;
      update app_users set auth_user_id = new.id where phone = new.phone;
      if not found then insert into app_users (phone, auth_user_id) values (new.phone, new.id); end if;
      return new;
    end $$;
  `);
  const okp = await attempt({ actorUserId: EMIL, phone: '17865550400', capabilities: ['receive_brief'] });
  ok('control: with the link-by-phone trigger, the same call succeeds and exactly one linked account exists',
    !okp.error && (await count('app_users where phone = $1', ['17865550400'])) === 1
      && (await count('app_users where auth_user_id = $1', [okp.result.auth_user_id])) === 1, okp.error && okp.error.message);
}

// ── pins on the function itself ─────────────────────────────────────────────
section('pins — the shape the migration promised');
{
  const r = await one(`select p.prosecdef, p.provolatile, p.proconfig, p.proargnames, pg_get_functiondef(p.oid) as def
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = 'provision_user'`);
  ok('SECURITY DEFINER with search_path pinned to public, pg_temp; VOLATILE',
    !!r && r.prosecdef === true && r.provolatile === 'v' && Array.isArray(r.proconfig) && r.proconfig.includes('search_path=public, pg_temp'), r && { prosecdef: r.prosecdef, proconfig: r.proconfig });
  ok('argument list is exactly (actor, phone, display_name, capabilities, timezone) — no id for the account being created',
    !!r && JSON.stringify(r.proargnames) === JSON.stringify(['p_actor_user_id', 'p_phone', 'p_display_name', 'p_capabilities', 'p_timezone']), r && r.proargnames);
  ok('the function body contains no UPDATE or DELETE against admin_audit — the audit write is an INSERT and nothing else',
    !!r && !/\b(update|delete\s+from)\s+admin_audit\b/i.test(r.def));
  ok('the function body contains no copy of the capability vocabulary (the check constraint is the only authority)',
    !!r && !/write_workspace/.test(r.def));
  const priv = await one(`select has_function_privilege('anon', 'provision_user(uuid, text, text, text[], text)', 'execute') as anon,
                                 has_function_privilege('authenticated', 'provision_user(uuid, text, text, text[], text)', 'execute') as authenticated,
                                 has_function_privilege('service_role', 'provision_user(uuid, text, text, text[], text)', 'execute') as service_role`);
  ok('execute: anon NO, authenticated NO, service_role YES', priv.anon === false && priv.authenticated === false && priv.service_role === true, priv);

  const finalTotals = await totals();
  ok('end state: three accounts were provisioned in this run, each with exactly one provision_user and one normalize_account audit row (3 = 3 = 3)',
    (await count(`admin_audit where action = 'provision_user'`)) === 3
      && (await count(`admin_audit where action = 'normalize_account'`)) === 3
      && (await count(`app_users where invited_by = $1`, [EMIL])) === 3
      && finalTotals.settings === 3, finalTotals);
}

await db.close();
finish();
