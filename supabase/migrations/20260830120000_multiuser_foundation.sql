-- ============================================================================
-- Multi-user foundation — roles, capabilities, per-user settings, admin audit
--
-- Project: qjwbtlnwnjjuvrwblkzx  (named "cedrus-dev"; it IS production)
-- Session: A, 2026-08-30, branch feat/multiuser-foundation-2026-08-30
-- Governing decision: CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md
--
-- WHAT THIS IS FOR
-- Cedrus is allowlist-only multi-user: a small, known set of people, each with
-- a fully isolated instance of the same system. Not a SaaS. There is no signup,
-- no tier, no plan, no trial, no billing, and nothing here creates one. If a
-- later session finds itself adding a `plan` column it has misread the
-- amendment.
--
-- THE RULE THIS MIGRATION EXISTS TO ENFORCE
-- No user is special, and configuration lives in ROWS, not environment
-- variables. Today the system encodes "the one user" in COS_USER_ID,
-- COS_BRIEF_USAGE_USER_ID, COS_BRIEF_TO and a hard-coded brief hour. Every one
-- of those becomes a column below. Environment variables keep exactly two jobs
-- from here on: secrets, and global arming switches (COS_BRIEF_LIVE, budget
-- ceilings). Anything that differs per person lives here, or the fifth user is
-- a deploy instead of a click.
--
-- APPLIED BY: Emil, `supabase migration up --linked`. NEVER a bare `db push`,
-- which diffs and applies whatever it thinks is missing. See docs/MIGRATION_PATH.md.
--
-- ADDITIVE ONLY. No existing data is migrated, no user is created, no existing
-- column is dropped or retyped. Emil creates accounts through the admin panel
-- in Session D.
-- ============================================================================

-- ── PRE-CHECK — run this BEFORE applying, and keep the output ───────────────
-- Expected on a system that has never had this migration: four zeros, and one
-- row per existing app_users record.
--
--   select count(*) filter (where table_name = 'user_capabilities') as cap_tbl,
--          count(*) filter (where table_name = 'user_settings')     as set_tbl,
--          count(*) filter (where table_name = 'admin_audit')       as aud_tbl
--     from information_schema.tables where table_schema = 'public';
--
--   select count(*) as app_users_cols_that_should_not_exist
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'app_users'
--      and column_name in ('role','account_status','display_name',
--                          'invited_by','invited_at','activated_at');
--
--   select count(*) as existing_users from app_users;
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. app_users gains a role, a status, and an invitation trail ────────────
--
-- `role` and `account_status` are separate on purpose. A role says what a
-- person may do; a status says whether they may do anything at all. Collapsing
-- them into one column means revoking an admin's access silently demotes them,
-- and re-activating them silently restores admin — two different decisions
-- riding on one value.
--
-- Both DEFAULT to the least-privileged useful value. A row created by any path
-- that forgets to name them is a member, and an active one — never an admin.
alter table app_users
  add column if not exists role text not null default 'member',
  add column if not exists account_status text not null default 'active',
  add column if not exists display_name text,
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz;

-- Constraints added separately from the columns so that re-running this file
-- against a partially-applied state cannot fail on a duplicate constraint and
-- roll back the whole transaction.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_role_check') then
    alter table app_users add constraint app_users_role_check
      check (role in ('admin', 'member'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_users_account_status_check') then
    alter table app_users add constraint app_users_account_status_check
      check (account_status in ('active', 'suspended'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_users_invited_by_fkey') then
    alter table app_users add constraint app_users_invited_by_fkey
      foreign key (invited_by) references app_users(id) on delete set null;
  end if;
end $$;

comment on column app_users.role is
  'admin | member. Authorization, not identity. Admin is a user attribute here — it was a TOTP session plus a TESTER_PHONES env allowlist before 2026-08-30.';
comment on column app_users.account_status is
  'active | suspended. Independent of role: suspending an admin must not silently demote them.';
comment on column app_users.invited_by is
  'The app_users.id of the admin who provisioned this account. NULL for accounts that predate the allowlist.';

-- ── 2. Identity helpers, used by every policy below ─────────────────────────
--
-- SECURITY DEFINER with a pinned search_path. Both are load-bearing:
--
--   • DEFINER, because these read app_users from inside a policy on another
--     table. If app_users ever has RLS of its own, an INVOKER function would
--     be filtered by that policy and the outer policy would silently see NULL
--     — which fails closed, but fails closed by accident and for a reason no
--     one could find.
--   • `set search_path = public, pg_temp`, because a DEFINER function without
--     one is the standard Postgres privilege-escalation hole: a caller who can
--     create a schema earlier on the path can shadow `app_users`.
--
-- STABLE, not IMMUTABLE: the answer depends on the current session's auth.uid()
-- and on table contents, so the planner may cache it within a statement but
-- never across one.
create or replace function current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from app_users where auth_user_id = auth.uid();
$$;

comment on function current_app_user_id() is
  'The acting Cedrus user, derived from the JWT via app_users.auth_user_id. NULL when unauthenticated. Identity comes from the token, never from the request.';

-- Deliberately answers false for a suspended admin. Suspension is meant to
-- remove ALL access, and an admin who keeps admin reads while suspended is the
-- exact half-revoked state the two-column split above exists to prevent.
create or replace function is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from app_users
     where auth_user_id = auth.uid()
       and role = 'admin'
       and account_status = 'active'
  );
$$;

comment on function is_app_admin() is
  'True only for an ACTIVE admin. A suspended admin is not an admin: suspension removes all access, including admin reads.';

-- ── 3. user_capabilities — one row per user per capability ──────────────────
--
-- A table rather than a widening set of boolean columns on app_users. Adding a
-- capability is then an INSERT, not a migration, and the audit trail of who
-- granted what and when has somewhere to live.
--
-- The vocabulary is SMALL and CLOSED. The check constraint means a typo is
-- rejected at write time rather than silently granting nothing — an
-- unconstrained capability name would make `granted = true` for
-- 'run_agent' (no s) look exactly like a capability that was never granted.
create table if not exists user_capabilities (
  user_id     uuid    not null references app_users(id) on delete cascade,
  capability  text    not null,
  granted     boolean not null default false,
  granted_by  uuid             references app_users(id) on delete set null,
  granted_at  timestamptz,
  primary key (user_id, capability)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_capabilities_capability_check') then
    alter table user_capabilities add constraint user_capabilities_capability_check
      check (capability in ('run_agents', 'write_workspace', 'receive_brief', 'receive_sms'));
  end if;
end $$;

comment on table user_capabilities is
  'One row per user per capability. Absent row and granted=false mean the same thing: refused. Vocabulary is closed by check constraint so a typo cannot read as an ungranted capability.';

-- ── 4. user_settings — the per-user configuration that is env vars today ────
--
-- Each column here retires a specific environment variable named in
-- docs/SINGLETON_AUDIT_2026-08-30.md:
--
--   brief_email     ← COS_BRIEF_TO              (audit finding 7)
--   usage_user_id   ← COS_BRIEF_USAGE_USER_ID   (audit finding 8)
--   cos_user_id     ← COS_USER_ID               (audit findings 5, 6)
--   brief_hour_utc  ← the hard-coded '0 11 * * *' (audit finding 10)
--
-- brief_enabled DEFAULTS TO FALSE. A newly provisioned account must never
-- start emailing anyone as a side effect of being created; enabling delivery
-- is a separate, deliberate act. This is the same posture as every other
-- arming switch in the system.
create table if not exists user_settings (
  user_id        uuid primary key references app_users(id) on delete cascade,
  brief_email    text,
  brief_enabled  boolean     not null default false,
  brief_hour_utc int         not null default 11,
  cos_user_id    uuid,
  usage_user_id  uuid,
  timezone       text        not null default 'America/New_York',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_brief_hour_utc_check') then
    alter table user_settings add constraint user_settings_brief_hour_utc_check
      check (brief_hour_utc between 0 and 23);
  end if;
end $$;

comment on table user_settings is
  'Per-user configuration that used to be environment variables. See docs/SINGLETON_AUDIT_2026-08-30.md for the variable each column retires.';
comment on column user_settings.brief_enabled is
  'Delivery arming, per person. Defaults FALSE: provisioning an account must never start sending mail as a side effect.';
comment on column user_settings.cos_user_id is
  'This person''s user_id inside the Chief of Staff project (kpzyzjhfvjfvxowhusir). A DIFFERENT id space from app_users.id — do not assume they match.';

-- ── 5. admin_audit — append-only, enforced by trigger ───────────────────────
--
-- Append-only by TRIGGER rather than by revoking UPDATE/DELETE grants, because
-- the service role bypasses grants and RLS both. A trigger fires for every
-- writer including service_role, which is the only writer that will ever touch
-- this table. A permission the privileged path can ignore is not a guarantee.
create table if not exists admin_audit (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  actor_user_id  uuid not null references app_users(id),
  action         text not null,
  target_user_id uuid          references app_users(id) on delete set null,
  detail         jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_at_idx on admin_audit (at desc);
create index if not exists admin_audit_target_idx on admin_audit (target_user_id, at desc);

create or replace function admin_audit_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'admin_audit is append-only: % is not permitted. Correct the record by appending a new row.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_admin_audit_append_only on admin_audit;
create trigger trg_admin_audit_append_only
  before update or delete on admin_audit
  for each row execute function admin_audit_is_append_only();

comment on table admin_audit is
  'Append-only record of every admin action. UPDATE and DELETE raise via trigger — a grant would not, because service_role bypasses grants.';

-- ── 6. Row-level security, in the SAME migration as the tables ──────────────
--
-- The publishable key is public and ships in the client bundle, so RLS does
-- one hundred percent of the browser-side security work. A table created
-- without it, even for one deploy, is a table readable by anyone holding a key
-- that is printed in the JavaScript.
--
-- NO POLICY GRANTS `anon` ANYTHING. Not read, not write, not on any of the
-- three tables. Every policy below names `authenticated` explicitly rather
-- than relying on `public`, which would include anon.
--
-- SERVICE ROLE BYPASSES ALL OF THIS BY DESIGN. That is why RLS cannot be the
-- isolation boundary on the service-role path, and why src/services/cos/client.js
-- gains a forUser() wrapper in the same session — see §C of the session prompt
-- and docs/SINGLETON_AUDIT_2026-08-30.md findings 2 and 4.
alter table user_capabilities enable row level security;
alter table user_settings     enable row level security;
alter table admin_audit       enable row level security;

-- Force RLS so that even a table owner connecting directly is filtered. The
-- service role is not the owner and is unaffected; this closes the case where
-- a future migration or a psql session as the owner reads across users without
-- noticing.
alter table user_capabilities force row level security;
alter table user_settings     force row level security;
alter table admin_audit       force row level security;

-- user_capabilities: a person may READ their own capabilities and nothing else.
-- There is deliberately NO insert/update/delete policy for `authenticated`.
-- Granting a capability is an admin operation on the service-role path, audited
-- in admin_audit. If a member could UPDATE this table they could grant
-- themselves run_agents.
drop policy if exists user_capabilities_select_own on user_capabilities;
create policy user_capabilities_select_own on user_capabilities
  for select to authenticated
  using (user_id = current_app_user_id());

drop policy if exists user_capabilities_select_admin on user_capabilities;
create policy user_capabilities_select_admin on user_capabilities
  for select to authenticated
  using (is_app_admin());

-- user_settings: read and update your own row. No INSERT and no DELETE —
-- the settings row is created by provisioning (Session D) and removed only by
-- the ON DELETE CASCADE from app_users.
drop policy if exists user_settings_select_own on user_settings;
create policy user_settings_select_own on user_settings
  for select to authenticated
  using (user_id = current_app_user_id());

drop policy if exists user_settings_select_admin on user_settings;
create policy user_settings_select_admin on user_settings
  for select to authenticated
  using (is_app_admin());

-- WITH CHECK repeats the USING predicate. Without it a user could pass the
-- read check on their own row and rewrite user_id to someone else's, moving
-- the row out of their own scope — the classic RLS update hole.
drop policy if exists user_settings_update_own on user_settings;
create policy user_settings_update_own on user_settings
  for update to authenticated
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

-- Column-level grants narrow what "update your own row" actually means. RLS
-- decides WHICH rows; grants decide WHICH columns. cos_user_id and
-- usage_user_id are operator settings that point at another project's id
-- space, and a user editing them would redirect their own brief's data source.
revoke all on user_settings from authenticated;
grant select on user_settings to authenticated;
grant update (brief_email, brief_enabled, brief_hour_utc, timezone)
  on user_settings to authenticated;

revoke all on user_capabilities from authenticated;
grant select on user_capabilities to authenticated;

-- admin_audit: readable by active admins only. No policy for members, and no
-- INSERT policy at all — rows are written on the service-role path by the
-- provisioning verbs, so that an admin cannot forge an entry naming someone
-- else as the actor.
revoke all on admin_audit from authenticated;
grant select on admin_audit to authenticated;

drop policy if exists admin_audit_select_admin on admin_audit;
create policy admin_audit_select_admin on admin_audit
  for select to authenticated
  using (is_app_admin());

-- Belt and braces on the public key. `anon` should hold nothing here; say so
-- explicitly rather than trusting the default.
revoke all on user_capabilities from anon;
revoke all on user_settings     from anon;
revoke all on admin_audit       from anon;

-- ── SELF-PROOF — the migration asserts its own post-conditions BEFORE commit ─
--
-- Added 2026-08-31. The post-check comments at the foot of this file describe
-- eight claims a human is supposed to read. A claim nobody reads is not a
-- check, and "no error appeared" is not a pass. These run inside the same
-- transaction, so a failure rolls the ENTIRE migration back and leaves the
-- database exactly as it was — there is no half-applied state to reason about.
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'app_users'
     and column_name in ('role','account_status','display_name',
                         'invited_by','invited_at','activated_at');
  if n <> 6 then raise exception 'ASSERT: expected 6 new app_users columns, found %', n; end if;

  select count(*) into n from app_users
   where role <> 'member' or account_status <> 'active';
  if n <> 0 then raise exception 'ASSERT: % existing rows are not (member, active) — nobody may be granted admin by a migration', n; end if;

  select count(*) into n from pg_class
   where relname in ('user_capabilities','user_settings','admin_audit')
     and relrowsecurity and relforcerowsecurity;
  if n <> 3 then raise exception 'ASSERT: expected 3 tables with RLS enabled AND forced, found %', n; end if;

  -- The one that matters most: the publishable key is public and ships in the
  -- client bundle, so a policy naming anon or public is a table anyone can read.
  select count(*) into n from pg_policies
   where tablename in ('user_capabilities','user_settings','admin_audit')
     and ('anon' = any (roles) or 'public' = any (roles));
  if n <> 0 then raise exception 'ASSERT: % policies expose anon/public', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('user_capabilities','user_settings','admin_audit');
  if n <> 6 then raise exception 'ASSERT: expected 6 policies, found %', n; end if;

  select (select count(*) from user_settings) + (select count(*) from user_capabilities) into n;
  if n <> 0 then raise exception 'ASSERT: % settings/capability rows exist; this migration creates none', n; end if;
end $$;

-- CONTROL 1 — the closed vocabulary really rejects a typo, and really accepts a
-- valid name. Only the pair discriminates: a constraint that rejects everything
-- would pass the negative half alone and break provisioning in Session D.
do $$
declare uid uuid; rejected boolean := false;
begin
  select id into uid from app_users limit 1;
  if uid is null then raise exception 'ASSERT: no app_users row exists to run the controls against'; end if;
  begin
    insert into user_capabilities (user_id, capability) values (uid, 'run_agent');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'CONTROL: user_capabilities accepted the invalid capability run_agent'; end if;
  begin
    insert into user_capabilities (user_id, capability) values (uid, 'run_agents');
  exception when others then
    raise exception 'CONTROL: a VALID capability was rejected (%) — the constraint refuses everything', sqlerrm;
  end;
  delete from user_capabilities where user_id = uid and capability = 'run_agents';
end $$;

-- CONTROL 2 — admin_audit refuses UPDATE and DELETE, each proven SEPARATELY.
-- Postgres aborts a whole transaction on the first error, so testing both in
-- one block would show one real refusal and one 25P02; each therefore runs in
-- its own PL/pgSQL subtransaction. The inserted control row is unwound by
-- raising a sentinel, since the trigger makes deleting it impossible by design.
do $$
declare uid uuid; u_blocked boolean := false; d_blocked boolean := false;
begin
  select id into uid from app_users limit 1;
  begin
    insert into admin_audit (actor_user_id, action) values (uid, 'append_only_control');
    begin
      update admin_audit set action = 'tampered' where action = 'append_only_control';
    exception when others then u_blocked := true;
    end;
    begin
      delete from admin_audit where action = 'append_only_control';
    exception when others then d_blocked := true;
    end;
    raise exception 'UNWIND_CONTROL_ROW';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_ROW' then raise; end if;
  end;
  if not u_blocked then raise exception 'CONTROL: admin_audit accepted an UPDATE — the append-only trigger does not fire'; end if;
  if not d_blocked then raise exception 'CONTROL: admin_audit accepted a DELETE — the append-only trigger does not fire'; end if;
end $$;

commit;

-- ── POST-CHECK — run this AFTER applying, and keep the output ───────────────
-- Every one of these is a claim that can be false. Read the numbers, do not
-- skim for absence of error.
--
-- 1) The six new app_users columns exist, with the right defaults. Expect 6.
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'app_users'
--      and column_name in ('role','account_status','display_name',
--                          'invited_by','invited_at','activated_at')
--    order by column_name;
--
-- 2) EVERY existing user defaulted to the least-privileged values.
--    Expect: zero admins, zero suspended, and no NULLs.
--   select role, account_status, count(*) from app_users group by 1,2;
--
-- 3) The three tables exist AND RLS is on AND forced. Expect 3 rows, all t/t.
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class
--    where relname in ('user_capabilities','user_settings','admin_audit')
--    order by relname;
--
-- 4) No policy grants anon anything. Expect ZERO rows — this is the one that
--    matters most, because the publishable key is public.
--   select schemaname, tablename, policyname, roles
--     from pg_policies
--    where tablename in ('user_capabilities','user_settings','admin_audit')
--      and ('anon' = any (roles) or 'public' = any (roles));
--
-- 5) The policies that SHOULD exist. Expect 6.
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where tablename in ('user_capabilities','user_settings','admin_audit')
--    order by tablename, policyname;
--
-- 6) The capability vocabulary is closed. Expect the four names, and the
--    INSERT below must RAISE (that raise IS the proof — a check constraint
--    that never rejects anything has not been shown to work):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'user_capabilities_capability_check';
--   -- CONTROL, expect ERROR 23514, then ROLLBACK:
--   begin; insert into user_capabilities (user_id, capability)
--          select id, 'run_agent' from app_users limit 1; rollback;
--
-- 7) admin_audit really is append-only. Expect ERROR 'restrict_violation' on
--    BOTH statements. An empty table would let both "no rows to update" and
--    "trigger fired" print the same nothing, so insert one row first and roll
--    the whole block back.
--   begin;
--     insert into admin_audit (actor_user_id, action)
--       select id, 'audit_trigger_control' from app_users limit 1;
--     update admin_audit set action = 'tampered' where action = 'audit_trigger_control';  -- must RAISE
--     delete from admin_audit where action = 'audit_trigger_control';                     -- must RAISE
--   rollback;
--
-- 8) Nothing was created for anyone. Expect 0, 0 — this session creates no
--    users, no settings rows and no capability grants.
--   select (select count(*) from user_settings)     as settings_rows,
--          (select count(*) from user_capabilities) as capability_rows;
-- ────────────────────────────────────────────────────────────────────────────
