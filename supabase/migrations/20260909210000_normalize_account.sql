-- ============================================================================
-- normalize_account() and bind_cos_identity() — one code path for an
-- account's shape, and the audited hand-off of a person's CoS identity from
-- environment variables to their row
--
-- Project: qjwbtlnwnjjuvrwblkzx  (named "cedrus-dev"; it IS production)
-- Session: P1.3, 2026-09-09, branch feat/backfill-accounts-2026-09-09
-- Governing decision: CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md; the task is
-- docs/BUILD_PLAN.md P1.3; the pattern is 20260909120000_provision_user.sql.
--
-- THE PROBLEM THIS SOLVES
-- provision_user() refuses a phone that already has an account (23505), so it
-- cannot run for the two rows that predate it: Emil's July row and the
-- suspended ghost. Both have no user_settings row and no user_capabilities
-- row (verified against prod 2026-09-09: user_settings held zero rows). They
-- need the shape a fresh account gets — FROM THE SAME CODE, not from a
-- hand-written INSERT, which CEDRUS.md II.5 forbids ("every account takes its
-- shape from the same code path").
--
-- THE DESIGN
--   1. provision_user()'s tail — the settings defaults, the capability grants
--      and its audit row — is EXTRACTED into normalize_account(actor, user_id,
--      capabilities). provision_user() now calls it. There is ONE code path
--      for the shape, so a fresh account and a backfilled one match by
--      construction rather than by someone remembering to keep two copies in
--      step. The migration asserts that provision_user's body calls
--      normalize_account and writes no settings or capability row itself.
--   2. normalize_account() is IDEMPOTENT: the settings row is created only if
--      absent (every value from the column defaults; nothing here can arm
--      delivery), the grants are brought to EXACTLY the given set (named ones
--      granted, previously granted ones not named are revoked — the row is
--      kept with granted = false, never deleted, so the trail survives), and
--      exactly one admin_audit row is appended per call. Calling it twice with
--      the same set changes no settings or capability row and adds exactly one
--      more audit row. An EMPTY set is a complete shape that can do nothing —
--      which is what the suspended ghost gets.
--   3. bind_cos_identity(actor, user_id, cos_user_id, usage_user_id) is the
--      audited admin action that sets the two per-person ids on user_settings.
--      Today those values live in Railway as COS_USER_ID and
--      COS_BRIEF_USAGE_USER_ID; P1.4 makes the brief read them from the row,
--      so this is the migration of truth from env to row. It refuses to bind a
--      CoS id that another account already carries (two Cedrus people bound to
--      one CoS person would be a cross-user read waiting to happen), and it
--      refuses an account with no settings row: normalize first.
--
-- WHAT IS UNCHANGED FROM P1.2, ON PURPOSE
--   • SECURITY DEFINER, search_path pinned to public, pg_temp, VOLATILE.
--   • EXECUTE for service_role only. `authenticated` cannot call any of the
--     three, and — pinned here because bind_cos_identity depends on it — the
--     foundation's column grant still lets authenticated UPDATE only
--     brief_email, brief_enabled, brief_hour_utc and timezone on its own
--     settings row. cos_user_id and usage_user_id are unreachable from the
--     publishable key.
--   • The actor must be an ACTIVE admin (a suspended admin is not an admin).
--   • No copy of the capability vocabulary anywhere. The check constraint is
--     the only authority; a typo raises 23514 and unwinds the call.
--   • admin_audit is written by INSERT and nothing else.
--   • Nothing here creates an admin, records SMS consent, or arms delivery.
--
-- APPLIED BY: Emil. `supabase migration up --linked` (Law 8), or
-- scripts/apply-normalize-account-via-api.py, the same path as P1.2. NEVER a
-- bare `db push`. The BACKFILL itself is a separate, dry-run-by-default step:
-- scripts/backfill-accounts-via-api.py. See docs/BACKFILL_ACCOUNTS_2026-09-09.md.
--
-- ADDITIVE ONLY. Two new functions, one redefined, their grants, nothing
-- else. No table is created or altered. No row is left behind: the controls
-- below create rows and unwind them inside this same transaction.
-- ============================================================================

-- ── PRE-CHECK — run this BEFORE applying, and keep the output ───────────────
-- Expected: provision_user present (P1.2 applied), normalize_account and
-- bind_cos_identity absent, one active admin, and the row counts as they are
-- (this file changes none of them).
--
--   select (select count(*) from pg_proc where proname = 'provision_user')     as provision_user_exists,
--          (select count(*) from pg_proc where proname = 'normalize_account')  as normalize_account_exists,
--          (select count(*) from pg_proc where proname = 'bind_cos_identity')  as bind_cos_identity_exists,
--          (select count(*) from app_users where role = 'admin' and account_status = 'active') as active_admins,
--          (select count(*) from user_settings)     as settings_rows,
--          (select count(*) from user_capabilities) as capability_rows,
--          (select count(*) from admin_audit)       as audit_rows;
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. normalize_account — the ONE code path for an account's shape
-- ════════════════════════════════════════════════════════════════════════════
create or replace function normalize_account(
  p_actor_user_id uuid,
  p_user_id       uuid,
  p_capabilities  text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor_role       text;
  v_actor_status     text;
  v_caps             text[];
  v_revoked          text[];
  v_settings_created boolean := false;
  v_audit_id         uuid;
  aud_before         bigint;
  aud_after          bigint;
  n                  int;
begin
  -- ── 0. the actor must be an ACTIVE admin (same rule as provision_user) ────
  if p_actor_user_id is null then
    raise exception 'normalize_account refused: an actor is required (the acting admin, from the session token)'
      using errcode = 'insufficient_privilege';
  end if;
  select role, account_status into v_actor_role, v_actor_status
    from app_users where id = p_actor_user_id;
  if not found or v_actor_role is distinct from 'admin' or v_actor_status is distinct from 'active' then
    raise exception 'normalize_account refused: actor % is not an active admin', p_actor_user_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── 1. the target must exist. Suspended or admin is fine: the suspended
  -- ghost and the bootstrap admin are exactly the rows this is for. ──────────
  if p_user_id is null or not exists (select 1 from app_users where id = p_user_id) then
    raise exception 'normalize_account refused: no app_users row with id %', p_user_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Capabilities: trimmed, de-duplicated, order kept — the same normalisation
  -- provision_user applies. The VOCABULARY is deliberately not checked here;
  -- a blank or unknown name reaches the check constraint in step 3 and unwinds
  -- the whole call.
  select coalesce(array_agg(c order by ord), '{}') into v_caps
    from (
      select btrim(c) as c, min(ord) as ord
        from unnest(coalesce(p_capabilities, '{}')) with ordinality as u(c, ord)
       group by btrim(c)
    ) d;

  -- ── 2. the settings row — created ONLY IF ABSENT, every value from the
  -- column defaults. brief_enabled = false; no parameter here can arm
  -- delivery. An existing row is left exactly as it is: normalising an
  -- account must never reset a person's own settings. ───────────────────────
  insert into user_settings (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  v_settings_created := found;

  -- ── 3. the grants — brought to EXACTLY the given set ─────────────────────
  -- (a) previously granted capabilities that are NOT in the set are revoked:
  --     granted = false, the row kept (never deleted) so the trail survives.
  --     The columns granted_by / granted_at record who made this change and
  --     when; the audit row below names what was revoked.
  select coalesce(array_agg(capability order by capability), '{}') into v_revoked
    from user_capabilities
   where user_id = p_user_id and granted and not (capability = any (v_caps));
  update user_capabilities
     set granted = false, granted_by = p_actor_user_id, granted_at = now()
   where user_id = p_user_id and granted and not (capability = any (v_caps));
  -- (b) every name in the set is granted. A row that is ALREADY granted is
  --     left untouched (its granted_by / granted_at keep the original grant),
  --     which is what makes a second identical call change nothing.
  insert into user_capabilities (user_id, capability, granted, granted_by, granted_at)
  select p_user_id, c, true, p_actor_user_id, now()
    from unnest(v_caps) as c
  on conflict (user_id, capability) do update
     set granted = true, granted_by = excluded.granted_by, granted_at = excluded.granted_at
   where not user_capabilities.granted;

  -- ── 4. exactly one audit entry — an INSERT and nothing else ──────────────
  select count(*) into aud_before from admin_audit
   where target_user_id = p_user_id and action = 'normalize_account';
  insert into admin_audit (actor_user_id, action, target_user_id, detail)
  values (p_actor_user_id, 'normalize_account', p_user_id,
          jsonb_build_object(
            'capabilities',     to_jsonb(v_caps),
            'settings_created', v_settings_created,
            'revoked',          to_jsonb(v_revoked)))
  returning id into v_audit_id;

  -- ── post-conditions, inside the transaction ──────────────────────────────
  select count(*) into n from user_settings where user_id = p_user_id;
  if n <> 1 then raise exception 'normalize_account ASSERT: % settings rows for user %, expected exactly 1', n, p_user_id; end if;
  select count(*) into n from user_capabilities where user_id = p_user_id and granted;
  if n <> coalesce(array_length(v_caps, 1), 0) then
    raise exception 'normalize_account ASSERT: % capabilities granted, % requested', n, coalesce(array_length(v_caps, 1), 0);
  end if;
  if exists (select 1 from user_capabilities where user_id = p_user_id and granted and not (capability = any (v_caps))) then
    raise exception 'normalize_account ASSERT: a capability outside the requested set is still granted';
  end if;
  select count(*) into aud_after from admin_audit
   where target_user_id = p_user_id and action = 'normalize_account';
  if aud_after <> aud_before + 1 then
    raise exception 'normalize_account ASSERT: audit rows went % -> %, expected exactly one more', aud_before, aud_after;
  end if;

  return jsonb_build_object(
    'user_id',          p_user_id,
    'audit_id',         v_audit_id,
    'settings_created', v_settings_created,
    'capabilities',     to_jsonb(v_caps),
    'revoked',          to_jsonb(v_revoked));
end;
$fn$;

comment on function normalize_account(uuid, uuid, text[]) is
  'Brings one account to the shape a fresh account gets: user_settings row (created only if absent, column defaults), user_capabilities brought to exactly the given set (revocations kept as granted=false), exactly one admin_audit row per call. Idempotent. The ONLY code path for the shape: provision_user calls it. Actor must be an active admin. service_role only. P1.3, 2026-09-09.';

revoke execute on function normalize_account(uuid, uuid, text[]) from public;
revoke execute on function normalize_account(uuid, uuid, text[]) from anon;
revoke execute on function normalize_account(uuid, uuid, text[]) from authenticated;
grant  execute on function normalize_account(uuid, uuid, text[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. bind_cos_identity — the audited hand-off from env vars to the row
-- ════════════════════════════════════════════════════════════════════════════
create or replace function bind_cos_identity(
  p_actor_user_id uuid,
  p_user_id       uuid,
  p_cos_user_id   uuid,
  p_usage_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor_role   text;
  v_actor_status text;
  v_prev_cos     uuid;
  v_prev_usage   uuid;
  v_other        uuid;
  v_audit_id     uuid;
  aud_before     bigint;
  aud_after      bigint;
  n              int;
begin
  -- ── 0. the actor must be an ACTIVE admin ──────────────────────────────────
  if p_actor_user_id is null then
    raise exception 'bind_cos_identity refused: an actor is required (the acting admin, from the session token)'
      using errcode = 'insufficient_privilege';
  end if;
  select role, account_status into v_actor_role, v_actor_status
    from app_users where id = p_actor_user_id;
  if not found or v_actor_role is distinct from 'admin' or v_actor_status is distinct from 'active' then
    raise exception 'bind_cos_identity refused: actor % is not an active admin', p_actor_user_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── 1. both ids are required. A NULL here would silently detach a person
  -- from their brief; detaching is a different verb, not this one. ─────────
  if p_cos_user_id is null or p_usage_user_id is null then
    raise exception 'bind_cos_identity refused: both cos_user_id and usage_user_id are required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ── 2. the target must exist AND be normalised (have a settings row).
  -- There is no INSERT here on purpose: the settings row has one author,
  -- normalize_account, so an account cannot acquire settings by a side door.
  if p_user_id is null or not exists (select 1 from app_users where id = p_user_id) then
    raise exception 'bind_cos_identity refused: no app_users row with id %', p_user_id
      using errcode = 'foreign_key_violation';
  end if;
  select cos_user_id, usage_user_id into v_prev_cos, v_prev_usage
    from user_settings where user_id = p_user_id;
  if not found then
    raise exception 'bind_cos_identity refused: user % has no user_settings row — run normalize_account first', p_user_id
      using errcode = 'no_data_found';
  end if;

  -- ── 3. one CoS person binds to at most one Cedrus account ────────────────
  select user_id into v_other from user_settings
   where cos_user_id = p_cos_user_id and user_id <> p_user_id limit 1;
  if found then
    raise exception 'bind_cos_identity refused: cos_user_id % is already bound to account %', p_cos_user_id, v_other
      using errcode = 'unique_violation';
  end if;

  -- ── 4. the write: two columns, one row ───────────────────────────────────
  update user_settings
     set cos_user_id = p_cos_user_id, usage_user_id = p_usage_user_id, updated_at = now()
   where user_id = p_user_id;

  -- ── 5. exactly one audit entry — an INSERT and nothing else ──────────────
  select count(*) into aud_before from admin_audit
   where target_user_id = p_user_id and action = 'bind_cos_identity';
  insert into admin_audit (actor_user_id, action, target_user_id, detail)
  values (p_actor_user_id, 'bind_cos_identity', p_user_id,
          jsonb_build_object(
            'cos_user_id',            p_cos_user_id,
            'usage_user_id',          p_usage_user_id,
            'previous_cos_user_id',   v_prev_cos,
            'previous_usage_user_id', v_prev_usage))
  returning id into v_audit_id;

  -- ── post-conditions ──────────────────────────────────────────────────────
  select count(*) into n from user_settings
   where user_id = p_user_id and cos_user_id = p_cos_user_id and usage_user_id = p_usage_user_id;
  if n <> 1 then raise exception 'bind_cos_identity ASSERT: the settings row does not carry the bound ids'; end if;
  select count(*) into aud_after from admin_audit
   where target_user_id = p_user_id and action = 'bind_cos_identity';
  if aud_after <> aud_before + 1 then
    raise exception 'bind_cos_identity ASSERT: audit rows went % -> %, expected exactly one more', aud_before, aud_after;
  end if;

  return jsonb_build_object(
    'user_id',                p_user_id,
    'audit_id',               v_audit_id,
    'cos_user_id',            p_cos_user_id,
    'usage_user_id',          p_usage_user_id,
    'previous_cos_user_id',   v_prev_cos,
    'previous_usage_user_id', v_prev_usage);
end;
$fn$;

comment on function bind_cos_identity(uuid, uuid, uuid, uuid) is
  'Audited admin action: sets user_settings.cos_user_id and usage_user_id for one account — the per-person values that lived in Railway as COS_USER_ID and COS_BRIEF_USAGE_USER_ID. Refuses an account with no settings row and a CoS id already bound elsewhere. Exactly one admin_audit row. Actor must be an active admin. service_role only. P1.3, 2026-09-09.';

revoke execute on function bind_cos_identity(uuid, uuid, uuid, uuid) from public;
revoke execute on function bind_cos_identity(uuid, uuid, uuid, uuid) from anon;
revoke execute on function bind_cos_identity(uuid, uuid, uuid, uuid) from authenticated;
grant  execute on function bind_cos_identity(uuid, uuid, uuid, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. provision_user — REDEFINED: the identity and the account row stay here;
--    the shape is normalize_account's. Same signature, same refusals, same
--    return shape as P1.2. Everything from the header of
--    20260909120000_provision_user.sql still holds and is not repeated.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function provision_user(
  p_actor_user_id uuid,
  p_phone         text,
  p_display_name  text   default null,
  p_capabilities  text[] default '{}',
  p_timezone      text   default 'America/New_York'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor_role   text;
  v_actor_status text;
  v_phone        text;
  v_display      text;
  v_caps         text[];
  v_user_id      uuid;
  v_auth_id      uuid;
  v_audit_id     uuid;
  v_shape        jsonb;
  n              int;
begin
  -- ── 0. the actor must be an ACTIVE admin ──────────────────────────────────
  if p_actor_user_id is null then
    raise exception 'provision_user refused: an actor is required (the acting admin, from the session token)'
      using errcode = 'insufficient_privilege';
  end if;
  select role, account_status into v_actor_role, v_actor_status
    from app_users where id = p_actor_user_id;
  if not found or v_actor_role is distinct from 'admin' or v_actor_status is distinct from 'active' then
    raise exception 'provision_user refused: actor % is not an active admin', p_actor_user_id
      using errcode = 'insufficient_privilege';
  end if;

  -- ── 1. the phone, in THE ONE TRUE FORMAT (src/utils/phone.js) ──────────────
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) = 10 then v_phone := '1' || v_phone; end if;
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    raise exception 'provision_user refused: phone must be 10-15 digits including the country code (got % digits)', length(v_phone)
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from app_users where phone = v_phone) then
    raise exception 'provision_user refused: an app_users row already exists for a phone ending %', right(v_phone, 4)
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from auth.users where phone = v_phone) then
    raise exception 'provision_user refused: a sign-in identity already exists for a phone ending %', right(v_phone, 4)
      using errcode = 'unique_violation';
  end if;

  v_display := nullif(btrim(coalesce(p_display_name, '')), '');

  -- Capabilities: trimmed, de-duplicated, order kept; the vocabulary is the
  -- check constraint's, reached inside normalize_account.
  select coalesce(array_agg(c order by ord), '{}') into v_caps
    from (
      select btrim(c) as c, min(ord) as ord
        from unnest(coalesce(p_capabilities, '{}')) with ordinality as u(c, ord)
       group by btrim(c)
    ) d;

  -- ── 2. the account row — FIRST, so the auth-link trigger finds it ──────────
  insert into app_users (phone, timezone, display_name, role, account_status, invited_by, invited_at)
  values (v_phone, coalesce(nullif(btrim(p_timezone), ''), 'America/New_York'), v_display,
          'member', 'active', p_actor_user_id, now())
  returning id into v_user_id;

  -- ── 3. the sign-in identity ────────────────────────────────────────────────
  v_auth_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, phone, phone_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated', v_phone, now(),
    '{"provider":"phone","providers":["phone"]}'::jsonb, jsonb_build_object('phone', v_phone),
    '', '', '', '',
    now(), now()
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_phone, v_auth_id,
          jsonb_build_object('sub', v_auth_id::text, 'phone', v_phone, 'phone_verified', true),
          'phone', now(), now());

  -- Link, then PROVE the link — regardless of what the production trigger on
  -- auth.users did in between.
  update app_users set auth_user_id = v_auth_id where id = v_user_id;

  select count(*) into n from app_users where phone = v_phone;
  if n <> 1 then
    raise exception 'provision_user ASSERT: % app_users rows carry this phone after identity creation — the auth-link trigger created a second account; nothing has been kept', n
      using errcode = 'integrity_constraint_violation';
  end if;
  select count(*) into n from app_users where auth_user_id = v_auth_id;
  if n <> 1 then
    raise exception 'provision_user ASSERT: % app_users rows carry the new auth id — the auth-link trigger created a second account; nothing has been kept', n
      using errcode = 'integrity_constraint_violation';
  end if;

  -- ── 4. this verb's own audit entry: the identity was created ──────────────
  -- An INSERT and nothing else. The shape (settings, grants) gets its own
  -- entry from the verb that writes it, below.
  insert into admin_audit (actor_user_id, action, target_user_id, detail)
  values (p_actor_user_id, 'provision_user', v_user_id,
          jsonb_build_object(
            'auth_user_id', v_auth_id,
            'phone_last4',  right(v_phone, 4),
            'display_name', v_display,
            'capabilities', to_jsonb(v_caps)))
  returning id into v_audit_id;

  -- ── 5. THE SHAPE — the one code path. Settings defaults, capability grants,
  -- one audit row: all of it happens in normalize_account, and none of it
  -- here. A backfilled July row and this fresh account are shaped by the same
  -- statements, so they match by construction. ──────────────────────────────
  v_shape := normalize_account(p_actor_user_id, v_user_id, v_caps);

  -- ── post-conditions, inside the transaction ────────────────────────────────
  select count(*) into n from admin_audit where target_user_id = v_user_id and action = 'provision_user';
  if n <> 1 then raise exception 'provision_user ASSERT: % provision audit rows for the new user, expected exactly 1', n; end if;
  if (v_shape->>'settings_created')::boolean is distinct from true then
    raise exception 'provision_user ASSERT: normalize_account reports it did not create the settings row for a brand-new account';
  end if;

  return jsonb_build_object(
    'user_id',      v_user_id,
    'auth_user_id', v_auth_id,
    'audit_id',     v_audit_id,
    'phone',        v_phone,
    'capabilities', v_shape->'capabilities');
end;
$fn$;

comment on function provision_user(uuid, text, text, text[], text) is
  'Creates one Cedrus account atomically: sign-in identity, app_users row, its own admin_audit entry, then the shape via normalize_account (user_settings defaults, user_capabilities grants, one more audit entry) — or none of them. Actor must be an active admin. Callable by service_role only. P1.2, refactored P1.3 (2026-09-09) so that a fresh account and a backfilled one share one code path.';

-- Grants restated: CREATE OR REPLACE keeps existing grants, but a pin that
-- relies on "it was granted last time" is not a pin.
revoke execute on function provision_user(uuid, text, text, text[], text) from public;
revoke execute on function provision_user(uuid, text, text, text[], text) from anon;
revoke execute on function provision_user(uuid, text, text, text[], text) from authenticated;
grant  execute on function provision_user(uuid, text, text, text[], text) to service_role;

-- ── SELF-PROOF — assertions BEFORE commit; any failure rolls it all back ─────
--
-- Same convention as P1.2: a claim nobody reads is not a check, and "no error
-- appeared" is not a pass. These run inside this transaction; a failure
-- leaves the database exactly as it was.

-- ASSERT 1 — the three functions exist with the load-bearing properties:
-- SECURITY DEFINER, pinned search_path, VOLATILE, and the exact argument
-- lists (no caller-chosen ids for anything being created).
do $$
declare r record; expected text[]; fname text;
begin
  for fname, expected in
    select * from (values
      ('normalize_account', array['p_actor_user_id','p_user_id','p_capabilities']),
      ('bind_cos_identity', array['p_actor_user_id','p_user_id','p_cos_user_id','p_usage_user_id']),
      ('provision_user',    array['p_actor_user_id','p_phone','p_display_name','p_capabilities','p_timezone'])
    ) as t(f, a)
  loop
    select p.prosecdef, p.provolatile, p.proconfig, p.proargnames into r
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fname;
    if not found then raise exception 'ASSERT: % was not created', fname; end if;
    if not r.prosecdef then raise exception 'ASSERT: % is not SECURITY DEFINER', fname; end if;
    if r.provolatile <> 'v' then raise exception 'ASSERT: % must be VOLATILE (it writes), found %', fname, r.provolatile; end if;
    if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
      raise exception 'ASSERT: % search_path is not pinned to public, pg_temp (found %)', fname, r.proconfig;
    end if;
    if r.proargnames <> expected then
      raise exception 'ASSERT: % has an unexpected argument list % — expected %', fname, r.proargnames, expected;
    end if;
  end loop;
end $$;

-- ASSERT 2 — the publishable key cannot reach any of them; the service key
-- can. And the column grant bind_cos_identity relies on still holds:
-- authenticated may not UPDATE cos_user_id / usage_user_id, and may not
-- INSERT a settings row at all.
do $$
declare sig text;
begin
  foreach sig in array array[
    'normalize_account(uuid, uuid, text[])',
    'bind_cos_identity(uuid, uuid, uuid, uuid)',
    'provision_user(uuid, text, text, text[], text)']
  loop
    if has_function_privilege('anon', sig, 'execute') then
      raise exception 'ASSERT: anon can execute %', sig;
    end if;
    if has_function_privilege('authenticated', sig, 'execute') then
      raise exception 'ASSERT: authenticated can execute % — a member could name an admin as the actor', sig;
    end if;
    if not has_function_privilege('service_role', sig, 'execute') then
      raise exception 'ASSERT: service_role cannot execute % — the backend could not call it', sig;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'user_settings', 'cos_user_id', 'update')
     or has_column_privilege('authenticated', 'user_settings', 'usage_user_id', 'update') then
    raise exception 'ASSERT: authenticated can UPDATE cos_user_id/usage_user_id — the CoS identity would be editable from the publishable key';
  end if;
  if has_table_privilege('authenticated', 'user_settings', 'insert') then
    raise exception 'ASSERT: authenticated can INSERT into user_settings — the settings row would have a second author';
  end if;
end $$;

-- ASSERT 3 — ONE code path. provision_user's body calls normalize_account
-- with the actor, the new user and the normalised capabilities, and writes no
-- settings or capability row of its own. Read from pg_proc, not from this
-- file, so the live definition is what is checked. And no function carries a
-- copy of the vocabulary or touches admin_audit other than by INSERT.
do $$
declare def_p text; def_n text; def_b text;
begin
  select pg_get_functiondef(p.oid) into def_p from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'provision_user';
  select pg_get_functiondef(p.oid) into def_n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'normalize_account';
  select pg_get_functiondef(p.oid) into def_b from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'bind_cos_identity';
  if def_p !~ 'normalize_account\s*\(\s*p_actor_user_id\s*,\s*v_user_id\s*,\s*v_caps\s*\)' then
    raise exception 'ASSERT: provision_user does not call normalize_account(p_actor_user_id, v_user_id, v_caps) — the shape would have two authors';
  end if;
  if def_p ~* 'insert\s+into\s+user_settings' or def_p ~* 'insert\s+into\s+user_capabilities' then
    raise exception 'ASSERT: provision_user writes user_settings or user_capabilities itself — the shape would have two authors';
  end if;
  if def_b ~* 'insert\s+into\s+user_settings' then
    raise exception 'ASSERT: bind_cos_identity inserts a settings row — the settings row would have a second author';
  end if;
  if def_p ~ 'write_workspace' or def_n ~ 'write_workspace' or def_b ~ 'write_workspace' then
    raise exception 'ASSERT: a function body carries a copy of the capability vocabulary (the check constraint is the only authority)';
  end if;
  if def_p ~* '\m(update|delete\s+from)\s+admin_audit\M' or def_n ~* '\m(update|delete\s+from)\s+admin_audit\M' or def_b ~* '\m(update|delete\s+from)\s+admin_audit\M' then
    raise exception 'ASSERT: a function body updates or deletes admin_audit';
  end if;
  if def_n ~* 'delete\s+from\s+user_capabilities' then
    raise exception 'ASSERT: normalize_account deletes capability rows — a revocation must keep the row (granted = false)';
  end if;
end $$;

-- ASSERT 4 — the preconditions the controls need, stated rather than assumed.
do $$
declare n int;
begin
  select count(*) into n from app_users where role = 'admin' and account_status = 'active';
  if n < 1 then
    raise exception 'ASSERT: no active admin exists to act as the control actor — bootstrap one first (BUILD_PLAN F0.1)';
  end if;
  select count(*) into n from app_users where phone in ('15550100145', '15550100146', '15550100147', '15550100148');
  if n <> 0 then raise exception 'ASSERT: a control phone (555-0101-45..48) is already in use; pick another'; end if;
  select count(*) into n from auth.users where phone in ('15550100145', '15550100146', '15550100147', '15550100148');
  if n <> 0 then raise exception 'ASSERT: a control phone already has a sign-in identity; pick another'; end if;
end $$;

-- The SHAPE of an account, as one jsonb value, for the controls below: the
-- settings row minus its identity and timestamps, the set of GRANTED
-- capabilities, and whether at least one audit row names the account. Two
-- accounts have the same shape iff these are equal. Temporary: it lives in
-- pg_temp and is dropped before commit; it is not part of the schema.
create function pg_temp.account_shape(u uuid) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'user_id' - 'created_at' - 'updated_at' from user_settings s where s.user_id = u),
    'granted',  (select coalesce(jsonb_agg(capability order by capability), '[]'::jsonb) from user_capabilities where user_id = u and granted),
    'audited',  (select count(*) >= 1 from admin_audit where target_user_id = u))
$$;

-- CONTROL 1 — THE DIFF. A July-shaped row (account only, no settings, no
-- grants) is normalised with a capability set; a fresh account is provisioned
-- with the same set. Their shapes must be IDENTICAL. Three guards make the
-- empty diff mean something:
--   (a) before normalising, the July row's shape DIFFERS from the fresh one —
--       so the diff can see an un-shaped account (a diff that is always empty
--       is not a diff);
--   (b) the fresh account HAS a settings row with the defaults and at least
--       one audit row — so "both empty" cannot pass as "both equal";
--   (c) two fresh accounts diff empty too — the control the ledger asks for.
-- The fresh account carries exactly one provision_user and one
-- normalize_account audit row. All rows are unwound by raising a sentinel.
do $$
declare actor uuid; f1 uuid; f2 uuid; july uuid; res jsonb; s1 jsonb; s2 jsonb; sj jsonb; n_p int; n_n int;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  begin
    f1 := (provision_user(actor, '15550100145', 'Fresh One', array['run_agents', 'receive_brief'])->>'user_id')::uuid;
    f2 := (provision_user(actor, '15550100146', 'Fresh Two', array['run_agents', 'receive_brief'])->>'user_id')::uuid;
    insert into app_users (phone, timezone, role, account_status)
    values ('15550100147', 'America/New_York', 'member', 'active') returning id into july;

    s1 := pg_temp.account_shape(f1);
    s2 := pg_temp.account_shape(f2);
    sj := pg_temp.account_shape(july);

    -- (b) the fresh account really has the shape: settings with the defaults, audited
    if s1->'settings' is null or (s1->'settings'->>'brief_enabled')::boolean is distinct from false
       or (s1->'settings'->>'brief_hour_utc')::int is distinct from 11
       or s1->'settings'->>'cos_user_id' is not null or s1->'settings'->>'usage_user_id' is not null
       or (s1->>'audited')::boolean is distinct from true
       or s1->'granted' <> '["receive_brief","run_agents"]'::jsonb then
      raise exception 'CONTROL 1: a fresh account lacks the expected shape (settings defaults, the two grants, an audit row): %', s1;
    end if;
    select count(*) filter (where action = 'provision_user'), count(*) filter (where action = 'normalize_account')
      into n_p, n_n from admin_audit where target_user_id = f1;
    if n_p <> 1 or n_n <> 1 then
      raise exception 'CONTROL 1: a fresh account should carry exactly one provision_user and one normalize_account audit row, found % and %', n_p, n_n;
    end if;
    -- (a) the un-shaped July row is VISIBLY different
    if sj = s1 then
      raise exception 'CONTROL 1: an un-normalised July row diffs EMPTY against a fresh account — the diff is blind: %', sj;
    end if;
    -- (c) two fresh accounts diff empty
    if s1 <> s2 then
      raise exception 'CONTROL 1: two freshly provisioned accounts differ — the fresh path is not deterministic: % vs %', s1, s2;
    end if;

    -- the backfill, through the same code path
    res := normalize_account(actor, july, array['run_agents', 'receive_brief']);
    if (res->>'settings_created')::boolean is distinct from true then
      raise exception 'CONTROL 1: normalize_account did not report creating the July row''s settings: %', res;
    end if;
    sj := pg_temp.account_shape(july);
    if sj <> s1 then
      raise exception 'CONTROL 1: a backfilled account differs from a fresh one — backfilled % vs fresh %', sj, s1;
    end if;
    raise exception 'UNWIND_CONTROL_1';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_1' then raise; end if;
  end;
  select count(*) into n_p from app_users where phone in ('15550100145', '15550100146', '15550100147');
  select count(*) into n_n from auth.users where phone in ('15550100145', '15550100146');
  if n_p <> 0 or n_n <> 0 then
    raise exception 'CONTROL 1: the unwind left rows behind — app_users %, auth.users %', n_p, n_n;
  end if;
end $$;

-- CONTROL 2 — IDEMPOTENCY and the EXACT SET. Normalising the same account
-- twice with the same set changes no settings row and no capability row
-- (full rows compared, timestamps included) and adds exactly one audit row.
-- Then the EMPTY set: the settings row stays, every grant is revoked with its
-- row kept, and the shape equals that of a fresh account provisioned with no
-- capabilities. Then a partial set re-grants one and leaves the other revoked.
do $$
declare actor uuid; july uuid; f0 uuid; res jsonb;
        set_before jsonb; set_after jsonb; cap_before jsonb; cap_after jsonb;
        aud_before bigint; aud_after bigint; n_set bigint; n_cap bigint; n_granted int; n int;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  begin
    insert into app_users (phone, timezone, role, account_status)
    values ('15550100147', 'America/New_York', 'member', 'suspended') returning id into july;
    perform normalize_account(actor, july, array['run_agents', 'receive_brief']);

    select to_jsonb(s) into set_before from user_settings s where user_id = july;
    select jsonb_agg(to_jsonb(c) order by capability) into cap_before from user_capabilities c where user_id = july;
    select count(*) into aud_before from admin_audit;
    select count(*) into n_set from user_settings;
    select count(*) into n_cap from user_capabilities;

    res := normalize_account(actor, july, array['receive_brief', 'run_agents', ' run_agents ']);   -- same set, different order, a duplicate

    select to_jsonb(s) into set_after from user_settings s where user_id = july;
    select jsonb_agg(to_jsonb(c) order by capability) into cap_after from user_capabilities c where user_id = july;
    select count(*) into aud_after from admin_audit;
    if set_after <> set_before then raise exception 'CONTROL 2: a second identical normalize changed the settings row: % -> %', set_before, set_after; end if;
    if cap_after <> cap_before then raise exception 'CONTROL 2: a second identical normalize changed a capability row: % -> %', cap_before, cap_after; end if;
    if aud_after <> aud_before + 1 then raise exception 'CONTROL 2: a second normalize added % audit rows, expected exactly 1', aud_after - aud_before; end if;
    if (select count(*) from user_settings) <> n_set or (select count(*) from user_capabilities) <> n_cap then
      raise exception 'CONTROL 2: a second normalize changed the settings/capability row counts';
    end if;
    if (res->>'settings_created')::boolean is distinct from false or res->'revoked' <> '[]'::jsonb then
      raise exception 'CONTROL 2: the second call misreported what it did: %', res;
    end if;

    -- the EMPTY set: complete shape, can do nothing
    res := normalize_account(actor, july, '{}');
    select count(*) into n_granted from user_capabilities where user_id = july and granted;
    select count(*) into n from user_capabilities where user_id = july;
    if n_granted <> 0 or n <> 2 then
      raise exception 'CONTROL 2: after the empty set, % granted (expected 0) and % rows (expected 2, kept as revoked)', n_granted, n;
    end if;
    if res->'revoked' <> '["receive_brief","run_agents"]'::jsonb then
      raise exception 'CONTROL 2: the empty set did not report the two revocations: %', res;
    end if;
    if (select count(*) from user_settings where user_id = july) <> 1 then
      raise exception 'CONTROL 2: the empty set removed the settings row';
    end if;
    f0 := (provision_user(actor, '15550100148', 'Fresh Empty', '{}')->>'user_id')::uuid;
    if pg_temp.account_shape(july) <> pg_temp.account_shape(f0) then
      raise exception 'CONTROL 2: an account normalised to the empty set differs from a fresh account with no capabilities: % vs %',
        pg_temp.account_shape(july), pg_temp.account_shape(f0);
    end if;

    -- a partial set: one back, one stays revoked
    perform normalize_account(actor, july, array['receive_brief']);
    if (select coalesce(jsonb_agg(capability order by capability), '[]') from user_capabilities where user_id = july and granted) <> '["receive_brief"]'::jsonb then
      raise exception 'CONTROL 2: a partial set did not produce exactly that set';
    end if;
    raise exception 'UNWIND_CONTROL_2';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_2' then raise; end if;
  end;
  select count(*) into n from app_users where phone in ('15550100147', '15550100148');
  if n <> 0 then raise exception 'CONTROL 2: the unwind left % rows behind', n; end if;
end $$;

-- CONTROL 3 — REFUSALS write nothing: a member actor (42501), a suspended
-- admin actor (42501), an unknown target (23503), and an invalid capability
-- (23514 from the constraint) — the last one AFTER the settings row would
-- have been created, proving the call is one transaction.
do $$
declare actor uuid; member_id uuid; susp uuid; july uuid; failed text; n int;
        set_before bigint; cap_before bigint; aud_before bigint;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  begin
    insert into app_users (phone, timezone, role, account_status) values ('15550100145', 'America/New_York', 'member', 'active') returning id into member_id;
    insert into app_users (phone, timezone, role, account_status) values ('15550100146', 'America/New_York', 'admin', 'suspended') returning id into susp;
    insert into app_users (phone, timezone, role, account_status) values ('15550100147', 'America/New_York', 'member', 'active') returning id into july;
    select count(*) into set_before from user_settings;
    select count(*) into cap_before from user_capabilities;
    select count(*) into aud_before from admin_audit;

    failed := null;
    begin perform normalize_account(member_id, july, array['run_agents']); exception when others then failed := sqlstate; end;
    if failed is distinct from '42501' then raise exception 'CONTROL 3: a MEMBER was allowed to normalize an account (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform normalize_account(susp, july, array['run_agents']); exception when others then failed := sqlstate; end;
    if failed is distinct from '42501' then raise exception 'CONTROL 3: a SUSPENDED admin was allowed to normalize an account (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform normalize_account(actor, '00000000-0000-0000-0000-00000000dead', array['run_agents']); exception when others then failed := sqlstate; end;
    if failed is distinct from '23503' then raise exception 'CONTROL 3: an unknown target was accepted (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform normalize_account(actor, july, array['run_agents', 'run_agent']); exception when others then failed := sqlstate; end;
    if failed is distinct from '23514' then raise exception 'CONTROL 3: the invalid capability run_agent was accepted (got %)', coalesce(failed, 'success'); end if;

    if (select count(*) from user_settings) <> set_before
       or (select count(*) from user_capabilities) <> cap_before
       or (select count(*) from admin_audit) <> aud_before
       or exists (select 1 from user_settings where user_id = july) then
      raise exception 'CONTROL 3: a refused call wrote something — settings % -> %, capabilities % -> %, audit % -> %',
        set_before, (select count(*) from user_settings), cap_before, (select count(*) from user_capabilities), aud_before, (select count(*) from admin_audit);
    end if;
    raise exception 'UNWIND_CONTROL_3';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_3' then raise; end if;
  end;
  select count(*) into n from app_users where phone in ('15550100145', '15550100146', '15550100147');
  if n <> 0 then raise exception 'CONTROL 3: the unwind left % rows behind', n; end if;
end $$;

-- CONTROL 4 — bind_cos_identity: the positive path sets both ids and writes
-- exactly one audit row carrying the previous values; then every refusal, each
-- writing nothing: an account with no settings row (P0002), a CoS id already
-- bound to another account (23505), a NULL id (22023), a member actor
-- (42501), an unknown account (23503).
do $$
declare actor uuid; a uuid; b uuid; bare uuid; member_id uuid; res jsonb; failed text; n int;
        cos1 uuid := '11111111-1111-4111-8111-111111111111'; use1 uuid := '22222222-2222-4222-8222-222222222222';
        cos2 uuid := '33333333-3333-4333-8333-333333333333'; use2 uuid := '44444444-4444-4444-8444-444444444444';
        set_snapshot jsonb; aud_before bigint;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  begin
    insert into app_users (phone, timezone, role, account_status) values ('15550100145', 'America/New_York', 'member', 'active') returning id into a;
    insert into app_users (phone, timezone, role, account_status) values ('15550100146', 'America/New_York', 'member', 'active') returning id into b;
    insert into app_users (phone, timezone, role, account_status) values ('15550100147', 'America/New_York', 'member', 'active') returning id into bare;
    insert into app_users (phone, timezone, role, account_status) values ('15550100148', 'America/New_York', 'member', 'active') returning id into member_id;
    perform normalize_account(actor, a, '{}');
    perform normalize_account(actor, b, '{}');

    res := bind_cos_identity(actor, a, cos1, use1);
    if (select count(*) from user_settings where user_id = a and cos_user_id = cos1 and usage_user_id = use1) <> 1 then
      raise exception 'CONTROL 4: the bind did not land on the settings row';
    end if;
    if (select count(*) from admin_audit where target_user_id = a and action = 'bind_cos_identity') <> 1 then
      raise exception 'CONTROL 4: expected exactly one bind_cos_identity audit row';
    end if;
    if res->>'previous_cos_user_id' is not null or (res->>'cos_user_id')::uuid <> cos1 then
      raise exception 'CONTROL 4: the return value misreports the bind: %', res;
    end if;
    -- re-bind records the previous values
    res := bind_cos_identity(actor, a, cos2, use2);
    if (res->>'previous_cos_user_id')::uuid <> cos1 or (res->>'previous_usage_user_id')::uuid <> use1 then
      raise exception 'CONTROL 4: a re-bind did not carry the previous ids: %', res;
    end if;
    if (select detail->>'previous_cos_user_id' from admin_audit where target_user_id = a and action = 'bind_cos_identity' order by at desc, id desc limit 1)::uuid <> cos1 then
      raise exception 'CONTROL 4: the audit row of a re-bind does not carry the previous cos id';
    end if;

    select jsonb_agg(to_jsonb(s) order by user_id) into set_snapshot from user_settings s where user_id in (a, b);
    select count(*) into aud_before from admin_audit;

    failed := null;
    begin perform bind_cos_identity(actor, bare, cos1, use1); exception when others then failed := sqlstate; end;
    if failed is distinct from 'P0002' then raise exception 'CONTROL 4: an account with no settings row was bound (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform bind_cos_identity(actor, b, cos2, use2); exception when others then failed := sqlstate; end;
    if failed is distinct from '23505' then raise exception 'CONTROL 4: a CoS id already bound to another account was accepted (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform bind_cos_identity(actor, b, null, use2); exception when others then failed := sqlstate; end;
    if failed is distinct from '22023' then raise exception 'CONTROL 4: a NULL cos id was accepted (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform bind_cos_identity(member_id, b, cos1, use1); exception when others then failed := sqlstate; end;
    if failed is distinct from '42501' then raise exception 'CONTROL 4: a MEMBER was allowed to bind a CoS identity (got %)', coalesce(failed, 'success'); end if;
    failed := null;
    begin perform bind_cos_identity(actor, '00000000-0000-0000-0000-00000000dead', cos1, use1); exception when others then failed := sqlstate; end;
    if failed is distinct from '23503' then raise exception 'CONTROL 4: an unknown account was bound (got %)', coalesce(failed, 'success'); end if;

    if (select jsonb_agg(to_jsonb(s) order by user_id) from user_settings s where user_id in (a, b)) <> set_snapshot
       or (select count(*) from admin_audit) <> aud_before
       or exists (select 1 from user_settings where user_id = bare) then
      raise exception 'CONTROL 4: a refused bind wrote something';
    end if;
    raise exception 'UNWIND_CONTROL_4';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_4' then raise; end if;
  end;
  select count(*) into n from app_users where phone in ('15550100145', '15550100146', '15550100147', '15550100148');
  if n <> 0 then raise exception 'CONTROL 4: the unwind left % rows behind', n; end if;
  select count(*) into n from user_settings where cos_user_id in (cos1, cos2);
  if n <> 0 then raise exception 'CONTROL 4: the unwind left % bound settings rows behind', n; end if;
end $$;

drop function pg_temp.account_shape(uuid);

-- PostgREST caches the schema; make the reload explicit rather than assumed.
notify pgrst, 'reload schema';

commit;

-- ── POST-CHECK — run this AFTER applying, and keep the output ───────────────
-- 1) The three functions exist, SECURITY DEFINER, search_path pinned. Expect
--    three rows, each t | {search_path=public, pg_temp}
--   select proname, prosecdef, proconfig from pg_proc
--    where proname in ('normalize_account', 'bind_cos_identity', 'provision_user') order by proname;
--
-- 2) Only service_role can call them. Expect f, f, t on every row.
--   select f, has_function_privilege('anon', f, 'execute') as anon,
--             has_function_privilege('authenticated', f, 'execute') as authenticated,
--             has_function_privilege('service_role', f, 'execute') as service_role
--     from unnest(array['normalize_account(uuid, uuid, text[])',
--                       'bind_cos_identity(uuid, uuid, uuid, uuid)',
--                       'provision_user(uuid, text, text, text[], text)']) as f;
--
-- 3) provision_user's live body calls normalize_account and writes no
--    settings or capability row itself. Expect t, f.
--   select pg_get_functiondef(oid) ~ 'normalize_account\s*\(\s*p_actor_user_id\s*,\s*v_user_id\s*,\s*v_caps\s*\)' as calls_normalize,
--          pg_get_functiondef(oid) ~* 'insert\s+into\s+user_(settings|capabilities)' as writes_shape_itself
--     from pg_proc where proname = 'provision_user';
--
-- 4) The controls left nothing behind, and NO ACCOUNT WAS BACKFILLED by this
--    file. Expect 0, 0, 0, and the same settings/capability/audit counts as
--    the pre-check. The backfill is scripts/backfill-accounts-via-api.py.
--   select (select count(*) from app_users   where phone in ('15550100145','15550100146','15550100147','15550100148')) as control_accounts,
--          (select count(*) from auth.users  where phone in ('15550100145','15550100146','15550100147','15550100148')) as control_identities,
--          (select count(*) from admin_audit where action in ('normalize_account','bind_cos_identity')) as backfill_audit_rows,
--          (select count(*) from user_settings)     as settings_rows,
--          (select count(*) from user_capabilities) as capability_rows,
--          (select count(*) from admin_audit)       as audit_rows;
-- ────────────────────────────────────────────────────────────────────────────
