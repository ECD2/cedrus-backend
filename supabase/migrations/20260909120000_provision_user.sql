-- ============================================================================
-- provision_user() — one account, one transaction, or nothing
--
-- Project: qjwbtlnwnjjuvrwblkzx  (named "cedrus-dev"; it IS production)
-- Session: P1.2, 2026-09-09, branch feat/provision-user-2026-09-09
-- Governing decision: CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md; the task is
-- docs/BUILD_PLAN.md P1.2; the findings are docs/SINGLETON_AUDIT_2026-08-30.md
-- 12 and 13.
--
-- WHAT THIS IS FOR
-- Five things happen or none do:
--   1. the sign-in identity        (auth.users + auth.identities, phone OTP)
--   2. the account row             (app_users, role=member, status=active)
--   3. the settings defaults       (user_settings, brief_enabled=false)
--   4. the capability grants       (user_capabilities, closed vocabulary)
--   5. exactly ONE audit entry     (admin_audit, an INSERT and nothing else)
--
-- WHY A POSTGRES FUNCTION AND NOT A JAVASCRIPT SEQUENCE
-- Five PATCHes through PostgREST with try/catch cleanup are not atomic. A
-- process crash, a network drop or a deploy between call two and call three
-- leaves a person with an account row and no settings, or settings and no
-- audit trail, and a test that "asserts no partial survives" against that
-- shape is theatre because the cleanup it exercises is the thing that will
-- not run when the process is gone. A single function call is one statement
-- in one transaction: Postgres unwinds every row of every step if any step
-- raises, with no cleanup code to get wrong.
--
-- THE THINGS THE SCHEMA ALREADY ENFORCES, AND THIS FUNCTION DOES NOT RE-ENCODE
--   • The capability vocabulary is CLOSED by user_capabilities_capability_check
--     (run_agents, write_workspace, receive_brief, receive_sms). This function
--     deliberately carries NO copy of that list (Lesson 20: a second copy is
--     you agreeing with you). A typo reaches the constraint, raises 23514, and
--     unwinds the whole account — which is the negative control below.
--   • admin_audit is append-only by TRIGGER. The audit write here is one
--     INSERT; there is no UPDATE and no DELETE anywhere in this file.
--   • app_users.phone and auth.users.phone are UNIQUE. Two concurrent calls
--     for the same phone cannot both commit; the loser gets 23505.
--
-- NO TABLE PARAMETER. NO CALLER-CHOSEN IDS. The new app_users.id, the new
-- auth.users.id and the admin_audit.id are all generated inside. The only id
-- the caller supplies is the ACTOR — the admin doing the provisioning — and
-- the backend derives that from the session token (req.appUser.id), never
-- from a request body.
--
-- EXECUTE IS GRANTED TO service_role ONLY. The actor check inside the function
-- is authorization, and authorization on a parameter is only as good as the
-- caller's honesty. If `authenticated` could call this through PostgREST, a
-- member holding the public key could name an admin as the actor. So the
-- function is unreachable from the publishable key; only the backend, holding
-- the service key, can call it, and the backend takes the actor from the JWT.
--
-- ORDER OF WRITES, AND WHY IT MATTERS. app_users is written BEFORE auth.users.
-- Production carries a trigger, link_or_create_app_user_from_auth, that fires
-- when an auth user is created at web signup and links-or-creates the
-- app_users row (src/routes/api/auth.js:17). Its body is NOT in this repo and
-- could not be read from this machine. Writing app_users first means that
-- trigger, whatever it does, finds a row to link; the post-conditions below
-- then assert exactly one app_users row carries this phone and this auth id,
-- so if the trigger created a second account the call raises and nothing
-- survives. Safe under both possible behaviours, and loud under the wrong one.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   • It never creates an admin. role is always 'member'. Promotion is a
--     separate, audited verb (not in this migration).
--   • It never records SMS consent. An admin cannot consent on someone's
--     behalf; sms_consent_at is written when the person themselves opts in
--     (audit finding 13 separates the allowlist step from the compliance step).
--   • It never arms delivery. user_settings.brief_enabled defaults to false and
--     this function takes no parameter that could change that.
--
-- APPLIED BY: Emil. `supabase migration up --linked` (Law 8), or
-- scripts/apply-provision-user-via-api.py, which mirrors how the 2026-08-30
-- migration actually reached production. NEVER a bare `db push`.
-- See docs/PROVISION_USER_2026-09-09.md.
--
-- ADDITIVE ONLY. One function, its grants, nothing else. No table is created
-- or altered, no row is left behind: the controls below create rows and unwind
-- them inside this same transaction.
-- ============================================================================

-- ── PRE-CHECK — run this BEFORE applying, and keep the output ───────────────
-- Expected: the multi-user foundation is present (3 tables), exactly one
-- active admin exists (F0.1), and provision_user does not exist yet.
--
--   select count(*) filter (where table_name in ('user_capabilities','user_settings','admin_audit')) as foundation_tables
--     from information_schema.tables where table_schema = 'public';
--   select count(*) as active_admins from app_users where role = 'admin' and account_status = 'active';
--   select count(*) as provision_user_exists from pg_proc where proname = 'provision_user';
-- ────────────────────────────────────────────────────────────────────────────

begin;

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
  n              int;
begin
  -- ── 0. the actor must be an ACTIVE admin ──────────────────────────────────
  -- Same rule as is_app_admin(): a suspended admin is not an admin. Suspension
  -- removes all access, and provisioning other people is the most consequential
  -- access there is.
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
  -- Digits only, with country code, so the SMS pipeline and the web login
  -- resolve to the same row. Supabase Auth stores phones the same way.
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) = 10 then v_phone := '1' || v_phone; end if;
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    raise exception 'provision_user refused: phone must be 10-15 digits including the country code (got % digits)', length(v_phone)
      using errcode = 'invalid_parameter_value';
  end if;

  -- Refuse an existing account by name rather than letting the unique index
  -- explain it. Both tables are checked because a person can exist in either
  -- one alone (an SMS-only user has no auth row; a half-finished web signup
  -- may have an auth row and no account).
  if exists (select 1 from app_users where phone = v_phone) then
    raise exception 'provision_user refused: an app_users row already exists for a phone ending %', right(v_phone, 4)
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from auth.users where phone = v_phone) then
    raise exception 'provision_user refused: a sign-in identity already exists for a phone ending %', right(v_phone, 4)
      using errcode = 'unique_violation';
  end if;

  v_display := nullif(btrim(coalesce(p_display_name, '')), '');

  -- Capabilities: trimmed, de-duplicated, order kept. The VOCABULARY is not
  -- checked here on purpose — see the header. A blank or unknown name reaches
  -- the check constraint in step 4 and unwinds everything.
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
  -- Phone-OTP user, confirmed, no password. The four token columns are set to
  -- '' rather than left NULL: GoTrue scans them into plain strings and a NULL
  -- there breaks sign-in with "converting NULL to string is unsupported".
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
  -- auth.users did in between. Exactly one account may carry this phone and
  -- exactly one may carry this identity, and it must be the one created above.
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

  -- ── 4. settings defaults — every value from the column defaults ────────────
  -- brief_enabled = false, brief_hour_utc = 11, timezone from the table default.
  -- No parameter of this function can arm delivery.
  insert into user_settings (user_id) values (v_user_id);

  -- ── 5. capability grants — the closed vocabulary decides ───────────────────
  insert into user_capabilities (user_id, capability, granted, granted_by, granted_at)
  select v_user_id, c, true, p_actor_user_id, now()
    from unnest(v_caps) as c;

  -- ── 6. exactly one audit entry — an INSERT and nothing else ────────────────
  insert into admin_audit (actor_user_id, action, target_user_id, detail)
  values (p_actor_user_id, 'provision_user', v_user_id,
          jsonb_build_object(
            'auth_user_id', v_auth_id,
            'phone_last4',  right(v_phone, 4),
            'display_name', v_display,
            'capabilities', to_jsonb(v_caps)))
  returning id into v_audit_id;

  -- ── post-conditions, inside the transaction ────────────────────────────────
  select count(*) into n from user_settings where user_id = v_user_id;
  if n <> 1 then raise exception 'provision_user ASSERT: % settings rows for the new user', n; end if;
  select count(*) into n from user_capabilities where user_id = v_user_id and granted;
  if n <> coalesce(array_length(v_caps, 1), 0) then
    raise exception 'provision_user ASSERT: % capabilities granted, % requested', n, coalesce(array_length(v_caps, 1), 0);
  end if;
  select count(*) into n from admin_audit where target_user_id = v_user_id and action = 'provision_user';
  if n <> 1 then raise exception 'provision_user ASSERT: % audit rows for the new user, expected exactly 1', n; end if;

  return jsonb_build_object(
    'user_id',      v_user_id,
    'auth_user_id', v_auth_id,
    'audit_id',     v_audit_id,
    'phone',        v_phone,
    'capabilities', to_jsonb(v_caps));
end;
$fn$;

comment on function provision_user(uuid, text, text, text[], text) is
  'Creates one Cedrus account atomically: sign-in identity, app_users row, user_settings defaults, user_capabilities grants and exactly one admin_audit entry — or none of them. Actor must be an active admin. Callable by service_role only; the backend supplies the actor from the session token. P1.2, 2026-09-09.';

-- Unreachable from the publishable key. The backend, holding the service key,
-- is the only caller, and it takes the actor from the JWT (see header).
revoke execute on function provision_user(uuid, text, text, text[], text) from public;
revoke execute on function provision_user(uuid, text, text, text[], text) from anon;
revoke execute on function provision_user(uuid, text, text, text[], text) from authenticated;
grant  execute on function provision_user(uuid, text, text, text[], text) to service_role;

-- ── SELF-PROOF — assertions BEFORE commit; any failure rolls it all back ─────
--
-- Same convention as 20260830120000_multiuser_foundation.sql: a claim nobody
-- reads is not a check, and "no error appeared" is not a pass. These run inside
-- this transaction, so a failure leaves the database exactly as it was.

-- ASSERT 1 — the function exists with the two load-bearing properties: it is
-- SECURITY DEFINER (it writes auth.users and the RLS-forced tables on behalf of
-- the caller) and its search_path is pinned (a DEFINER function without one is
-- the standard privilege-escalation hole). And its argument list contains no
-- id for the account being created — the caller cannot choose one.
do $$
declare r record;
begin
  select p.prosecdef, p.provolatile, p.proconfig, p.proargnames into r
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'provision_user';
  if not found then raise exception 'ASSERT: provision_user was not created'; end if;
  if not r.prosecdef then raise exception 'ASSERT: provision_user is not SECURITY DEFINER'; end if;
  if r.provolatile <> 'v' then raise exception 'ASSERT: provision_user must be VOLATILE (it writes), found %', r.provolatile; end if;
  if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
    raise exception 'ASSERT: provision_user search_path is not pinned to public, pg_temp (found %)', r.proconfig;
  end if;
  if r.proargnames <> array['p_actor_user_id','p_phone','p_display_name','p_capabilities','p_timezone'] then
    raise exception 'ASSERT: unexpected argument list % — no caller-chosen ids are allowed', r.proargnames;
  end if;
end $$;

-- ASSERT 2 — the publishable key cannot reach it; the service key can.
do $$
begin
  if has_function_privilege('anon', 'provision_user(uuid, text, text, text[], text)', 'execute') then
    raise exception 'ASSERT: anon can execute provision_user';
  end if;
  if has_function_privilege('authenticated', 'provision_user(uuid, text, text, text[], text)', 'execute') then
    raise exception 'ASSERT: authenticated can execute provision_user — a member could name an admin as the actor';
  end if;
  if not has_function_privilege('service_role', 'provision_user(uuid, text, text, text[], text)', 'execute') then
    raise exception 'ASSERT: service_role cannot execute provision_user — the backend could not provision anyone';
  end if;
end $$;

-- ASSERT 3 — the preconditions the controls need, stated rather than assumed.
-- Exactly the reason a control that cannot run is not a control.
do $$
declare n int;
begin
  select count(*) into n from app_users where role = 'admin' and account_status = 'active';
  if n < 1 then
    raise exception 'ASSERT: no active admin exists to act as the control actor — bootstrap one first (BUILD_PLAN F0.1)';
  end if;
  select count(*) into n from app_users where phone in ('15550100142', '15550100143');
  if n <> 0 then raise exception 'ASSERT: a control phone (555-0101-42/43) is already in use; pick another'; end if;
  select count(*) into n from auth.users where phone in ('15550100142', '15550100143');
  if n <> 0 then raise exception 'ASSERT: a control phone already has a sign-in identity; pick another'; end if;
end $$;

-- CONTROL 1 — the POSITIVE path creates all five, then is unwound.
-- Without this, CONTROL 2's "nothing survived" would also pass for a function
-- that never ran. The rows are unwound by raising a sentinel, because the
-- admin_audit row cannot be deleted (append-only trigger) — the same technique
-- as the foundation migration's CONTROL 2. The counts after the unwind are
-- asserted too, so the unwind is proven, not assumed.
do $$
declare actor uuid; res jsonb; uid uuid; n_users int; n_set int; n_cap int; n_aud int; n_auth int; n_ident int;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  begin
    res := provision_user(actor, '15550100142', 'Control One', array['run_agents', 'receive_brief']);
    uid := (res->>'user_id')::uuid;
    select count(*) into n_users from app_users         where id = uid and phone = '15550100142' and role = 'member' and account_status = 'active' and invited_by = actor;
    select count(*) into n_set   from user_settings     where user_id = uid and brief_enabled = false;
    select count(*) into n_cap   from user_capabilities where user_id = uid and granted and capability in ('run_agents', 'receive_brief');
    select count(*) into n_aud   from admin_audit       where target_user_id = uid and actor_user_id = actor and action = 'provision_user';
    select count(*) into n_auth  from auth.users        where id = (res->>'auth_user_id')::uuid and phone = '15550100142';
    select count(*) into n_ident from auth.identities   where user_id = (res->>'auth_user_id')::uuid and provider = 'phone';
    if n_users <> 1 or n_set <> 1 or n_cap <> 2 or n_aud <> 1 or n_auth <> 1 or n_ident <> 1 then
      raise exception 'CONTROL 1: the successful path did not create all five — app_users %, user_settings %, user_capabilities %, admin_audit %, auth.users %, auth.identities %',
        n_users, n_set, n_cap, n_aud, n_auth, n_ident;
    end if;
    raise exception 'UNWIND_CONTROL_1';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_1' then raise; end if;
  end;
  select count(*) into n_users from app_users where phone = '15550100142';
  select count(*) into n_auth  from auth.users where phone = '15550100142';
  select count(*) into n_aud   from admin_audit where detail->>'phone_last4' = '0142' and action = 'provision_user';
  if n_users <> 0 or n_auth <> 0 or n_aud <> 0 then
    raise exception 'CONTROL 1: the unwind left rows behind — app_users %, auth.users %, admin_audit %', n_users, n_auth, n_aud;
  end if;
end $$;

-- CONTROL 2 — the NEGATIVE path: fail it AFTER the account row and BEFORE the
-- capabilities are all granted, and prove no partial account survives.
-- The failure is forced INSIDE the transaction by the schema itself: 'run_agent'
-- (no s) violates the closed vocabulary at step 5, after app_users, auth.users
-- and user_settings have been written. Nothing is mocked. Expect 23514, then
-- zero rows in every one of the five places.
do $$
declare actor uuid; failed_with text := null; n_users int; n_aud int; n_auth int; n_ident int;
        aud_before bigint; aud_after bigint; set_before bigint; set_after bigint; cap_before bigint; cap_after bigint;
begin
  select id into actor from app_users where role = 'admin' and account_status = 'active' order by created_at limit 1;
  select count(*) into aud_before from admin_audit;
  select count(*) into set_before from user_settings;
  select count(*) into cap_before from user_capabilities;
  begin
    perform provision_user(actor, '15550100143', 'Control Two', array['run_agents', 'run_agent']);
  exception when others then
    failed_with := sqlstate;
  end;
  if failed_with is null then
    raise exception 'CONTROL 2: provision_user ACCEPTED the invalid capability run_agent — the closed vocabulary is not reaching the constraint';
  end if;
  if failed_with <> '23514' then
    raise exception 'CONTROL 2: expected check_violation 23514, got %', failed_with;
  end if;
  select count(*) into n_users from app_users         where phone = '15550100143';
  select count(*) into n_auth  from auth.users        where phone = '15550100143';
  select count(*) into n_ident from auth.identities   where provider_id = '15550100143';
  select count(*) into n_aud   from admin_audit       where detail->>'phone_last4' = '0143';
  select count(*) into aud_after from admin_audit;
  select count(*) into set_after from user_settings;
  select count(*) into cap_after from user_capabilities;
  -- Settings and capabilities are keyed by user_id and cascade from app_users,
  -- so they are checked as table TOTALS: a partial that survived would show as
  -- a total that moved.
  if n_users <> 0 or n_auth <> 0 or n_ident <> 0 or n_aud <> 0
     or aud_after <> aud_before or set_after <> set_before or cap_after <> cap_before then
    raise exception 'CONTROL 2: a PARTIAL account survived — app_users %, auth.users %, auth.identities %, audit rows for it %, totals audit % -> %, settings % -> %, capabilities % -> %',
      n_users, n_auth, n_ident, n_aud, aud_before, aud_after, set_before, set_after, cap_before, cap_after;
  end if;
end $$;

-- CONTROL 3 — a non-admin actor is refused, and nothing is written.
-- A member is created inside the block and unwound with it, so this runs on a
-- database with only admins in it.
do $$
declare member_id uuid; failed_with text := null; n int;
begin
  begin
    insert into app_users (phone, timezone, role, account_status)
    values ('15550100143', 'America/New_York', 'member', 'active') returning id into member_id;
    begin
      perform provision_user(member_id, '15550100142', 'Should Not Exist', array['run_agents']);
    exception when others then
      failed_with := sqlstate;
    end;
    if failed_with is null then
      raise exception 'CONTROL 3: a MEMBER was allowed to provision an account';
    end if;
    if failed_with <> '42501' then
      raise exception 'CONTROL 3: expected insufficient_privilege 42501, got %', failed_with;
    end if;
    select count(*) into n from app_users where phone = '15550100142';
    if n <> 0 then raise exception 'CONTROL 3: the refused call still created an account'; end if;
    raise exception 'UNWIND_CONTROL_3';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_3' then raise; end if;
  end;
  select count(*) into n from app_users where phone in ('15550100142', '15550100143');
  if n <> 0 then raise exception 'CONTROL 3: the unwind left % rows behind', n; end if;
end $$;

-- PostgREST caches the schema; Supabase reloads it on DDL through its own
-- event trigger, and this makes the reload explicit rather than assumed.
notify pgrst, 'reload schema';

commit;

-- ── POST-CHECK — run this AFTER applying, and keep the output ───────────────
-- 1) The function exists, is SECURITY DEFINER, search_path pinned. Expect one
--    row: t | {search_path=public, pg_temp}
--   select prosecdef, proconfig from pg_proc where proname = 'provision_user';
--
-- 2) Only service_role can call it. Expect f, f, t.
--   select has_function_privilege('anon',          'provision_user(uuid, text, text, text[], text)', 'execute') as anon,
--          has_function_privilege('authenticated', 'provision_user(uuid, text, text, text[], text)', 'execute') as authenticated,
--          has_function_privilege('service_role',  'provision_user(uuid, text, text, text[], text)', 'execute') as service_role;
--
-- 3) The controls left nothing behind. Expect 0, 0, 0.
--   select (select count(*) from app_users   where phone in ('15550100142','15550100143')) as control_accounts,
--          (select count(*) from auth.users  where phone in ('15550100142','15550100143')) as control_identities,
--          (select count(*) from admin_audit where action = 'provision_user')               as provision_audit_rows;
--
-- 4) The first REAL provisioning is P1.3's job, not this migration's. Expect
--    the same settings/capability counts as before applying (the pre-check).
--   select (select count(*) from user_settings) as settings_rows,
--          (select count(*) from user_capabilities) as capability_rows;
-- ────────────────────────────────────────────────────────────────────────────
