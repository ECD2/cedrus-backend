-- ============================================================================
-- Programs data foundation — programs, program_revisions, program_items
--
-- Project: qjwbtlnwnjjuvrwblkzx  (named "cedrus-dev"; it IS production)
-- Session: R6.2a, 2026-09-09, branch feat/programs-foundation-2026-09-09
-- Governing decisions: docs/cedrus-consulting.md §14 (data foundation only,
-- no rendering until Phase 4); docs/BUILD_PLAN.md R6.2a; the interface's
-- approved contract, web/V10_PROPOSAL.md "Programs: three-table contract"
-- as amended by the 2026-09-09 approval record (kind on programs, end_date
-- instead of length_days, reminder_id on items, new revisions reset every
-- item to planned, item_key kept for a later carry feature, no fourth table).
--
-- WHAT THIS IS FOR
-- A program is a dated plan a person is living inside — a triathlon build,
-- a care routine. The SOURCE (the text the plan was compiled from) is stored
-- verbatim on every revision, so a plan can always be traced back to the
-- words it came from, and republishing the same words is a no-op rather than
-- a duplicate.
--
--   programs           one row per plan per person: what it is, when, where
--   program_revisions  the source text, hashed; a new revision each time the
--                      words change; supersedes_revision_id is the chain
--   program_items      one row per scheduled thing per revision, on a DATE
--                      (never a timestamp — the plan says "Tuesday", not
--                      "Tuesday at 11:00Z"); the planned side is immutable,
--                      the actual side is written later by an audited path
--
-- THE THINGS THE SCHEMA ENFORCES, so no caller has to remember them
--   • user_id on every table, FK to app_users, and a COMPOSITE FK from each
--     child back to (parent id, user_id) — a revision or item cannot belong to
--     a different person than its program. The browser cannot choose an
--     owner, and a join cannot cross one.
--   • RLS enabled AND forced on all three. NO policy names anon or public.
--     authenticated may SELECT its own rows and nothing else; every write is
--     on the service-role path through the function below.
--   • UNIQUE (program_id, source_sha256): the same source published twice is
--     ONE revision. The function carries no pre-check; the constraint is the
--     authority (Lesson 20 — a second copy is you agreeing with you).
--   • CHECK constraints close the vocabularies: kind, status, item category,
--     item status. The category union is the interface's, verbatim.
--   • scheduled_date is DATE. A CHECK cannot say "not a timestamp", so the
--     self-proof below reads information_schema and refuses to commit
--     anything else.
--
-- WHY A POSTGRES FUNCTION FOR THE WRITE (same reasoning as provision_user)
-- Publishing a revision is three writes and one update: the revision row,
-- N item rows, and programs.current_revision_id. Through PostgREST those are
-- separate transactions, and a crash between the items and the pointer
-- leaves a revision nobody can see or a pointer to half a plan. One function
-- call is one transaction: all of it or none of it.
--
-- ACTUALS DO NOT CARRY ACROSS REVISIONS (approved v1 policy). A new revision
-- starts every item at 'planned' with every actual column NULL. The function
-- never reads the previous revision's items; item_key is stored so a later,
-- explicit carry-forward feature has something to match on. CONTROL 1 marks
-- an item completed and proves the next revision ignores it.
--
-- EXECUTE IS GRANTED TO service_role ONLY, for both functions. The backend
-- and the load script hold the service key; the publishable key cannot reach
-- either function, so a member cannot publish a plan into someone else's
-- account by naming their id.
--
-- APPLIED BY: Emil. `supabase migration up --linked` (Law 8) or
-- scripts/apply-programs-via-api.py. NEVER a bare `db push`.
-- See docs/PROGRAMS_2026-09-09.md.
--
-- ADDITIVE ONLY. Three tables, their indexes and policies, two functions.
-- No existing object is altered, no row is left behind: the controls below
-- create rows and unwind them inside this same transaction.
-- ============================================================================

-- ── PRE-CHECK — run this BEFORE applying, and keep the output ───────────────
-- Expected: three zeros (the tables do not exist), at least one app_users
-- row (the controls need an owner), and provision_user present (P1.2 applied).
--
--   select count(*) filter (where table_name in ('programs','program_revisions','program_items')) as program_tables
--     from information_schema.tables where table_schema = 'public';
--   select count(*) as app_users_rows from app_users;
--   select count(*) as provision_user_exists from pg_proc where proname = 'provision_user';
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. programs ─────────────────────────────────────────────────────────────
-- Exactly the contract's columns. No created_at/updated_at: the contract
-- names ten columns and this migration writes ten.
create table if not exists programs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references app_users(id) on delete cascade,
  kind                text not null,
  title               text not null,
  description         text,
  start_date          date not null,
  end_date            date,
  time_zone           text not null,
  current_revision_id uuid,
  status              text not null default 'draft',
  -- The composite target for the children's owner-consistency FKs.
  constraint programs_id_user_id_key unique (id, user_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programs_kind_check') then
    alter table programs add constraint programs_kind_check
      check (kind in ('training', 'routine'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programs_status_check') then
    alter table programs add constraint programs_status_check
      check (status in ('draft', 'active', 'paused', 'completed', 'archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programs_dates_check') then
    alter table programs add constraint programs_dates_check
      check (end_date is null or end_date >= start_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programs_title_not_blank_check') then
    alter table programs add constraint programs_title_not_blank_check
      check (btrim(title) <> '');
  end if;
end $$;

create index if not exists programs_user_id_idx on programs (user_id, status);

comment on table programs is
  'One plan per row per person. kind training | routine. Dates are calendar dates in time_zone; day counts are DERIVED from start_date/end_date, never stored. current_revision_id points at the revision whose items are live. R6.2a, 2026-09-09.';
comment on column programs.end_date is
  'NULL for an open-ended routine. When set, the item dates of every revision fall inside [start_date, end_date] (asserted by publish_program_revision).';

-- ── 2. program_revisions — the source, verbatim, hashed ─────────────────────
create table if not exists program_revisions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references app_users(id) on delete cascade,
  program_id             uuid not null references programs(id) on delete cascade,
  revision_number        int  not null,
  created_at             timestamptz not null default now(),
  source_name            text not null,
  source_text            text not null,
  source_sha256          text not null,
  supersedes_revision_id uuid references program_revisions(id) on delete set null,
  -- THE IDEMPOTENCY RULE. Same program, same bytes: one revision.
  constraint program_revisions_program_id_source_sha256_key unique (program_id, source_sha256),
  constraint program_revisions_program_id_revision_number_key unique (program_id, revision_number),
  constraint program_revisions_id_user_id_key unique (id, user_id),
  -- Owner consistency: the revision's user_id must be its program's user_id.
  constraint program_revisions_program_owner_fkey
    foreign key (program_id, user_id) references programs (id, user_id) on delete cascade
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'program_revisions_sha_format_check') then
    alter table program_revisions add constraint program_revisions_sha_format_check
      check (source_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_revisions_number_check') then
    alter table program_revisions add constraint program_revisions_number_check
      check (revision_number >= 1);
  end if;
end $$;

comment on table program_revisions is
  'The exact source a revision was compiled from, with its SHA-256. UNIQUE (program_id, source_sha256) makes republishing the same source a no-op. supersedes_revision_id chains revisions; created_at orders them.';

-- programs.current_revision_id → program_revisions, added after both exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programs_current_revision_id_fkey') then
    alter table programs add constraint programs_current_revision_id_fkey
      foreign key (current_revision_id) references program_revisions(id) on delete set null;
  end if;
end $$;

-- ── 3. program_items — one scheduled thing, on a DATE ───────────────────────
create table if not exists program_items (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references app_users(id) on delete cascade,
  program_id                uuid not null references programs(id) on delete cascade,
  program_revision_id       uuid not null references program_revisions(id) on delete cascade,
  item_key                  text not null,
  scheduled_date            date not null,
  category                  text not null,
  title                     text not null,
  instructions              text,
  planned_start_local       text,
  planned_duration_minutes  int,
  proposed_start_at         timestamptz,
  proposed_duration_minutes int,
  status                    text not null default 'planned',
  actual_started_at         timestamptz,
  actual_finished_at        timestamptz,
  actual_duration_minutes   int,
  actual_note               text,
  source_locator            text,
  reminder_id               uuid,
  constraint program_items_revision_item_key_key unique (program_revision_id, item_key),
  -- Owner consistency both ways up the chain.
  constraint program_items_program_owner_fkey
    foreign key (program_id, user_id) references programs (id, user_id) on delete cascade,
  constraint program_items_revision_owner_fkey
    foreign key (program_revision_id, user_id) references program_revisions (id, user_id) on delete cascade
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'program_items_category_check') then
    alter table program_items add constraint program_items_category_check
      check (category in ('swim','bike','run','lift','brick','open_water','rest',
                          'shampoo','condition','body','oil','face'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_items_status_check') then
    alter table program_items add constraint program_items_status_check
      check (status in ('planned', 'in_progress', 'completed', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_items_planned_start_local_check') then
    alter table program_items add constraint program_items_planned_start_local_check
      check (planned_start_local is null or planned_start_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_items_durations_check') then
    alter table program_items add constraint program_items_durations_check
      check ((planned_duration_minutes  is null or planned_duration_minutes  > 0)
         and (proposed_duration_minutes is null or proposed_duration_minutes > 0)
         and (actual_duration_minutes   is null or actual_duration_minutes   >= 0));
  end if;
end $$;

create index if not exists program_items_user_date_idx on program_items (user_id, scheduled_date);
create index if not exists program_items_revision_idx  on program_items (program_revision_id, scheduled_date);

comment on table program_items is
  'One scheduled item per row. scheduled_date is a DATE in the program''s time_zone — never a timestamp. planned_* is the plan (immutable per revision); proposed_* is a later suggestion; actual_* is what happened, written by an audited path later. reminder_id is reserved and unused. Every new revision starts every item at planned with NULL actuals.';
comment on column program_items.item_key is
  'Stable identity of the item within its source (date:category:slug). Stored so a later explicit carry-forward feature can match items across revisions. Not used by v1.';

-- ── 4. Row-level security, in the SAME migration as the tables ──────────────
-- The publishable key is public and ships in the client bundle. NO POLICY
-- GRANTS anon ANYTHING. authenticated may read its own rows; every write is
-- service-role (which bypasses RLS by design — the function below is the
-- write path, and it takes the owner as an argument from the backend).
alter table programs          enable row level security;
alter table program_revisions enable row level security;
alter table program_items     enable row level security;

-- Forced, so a table owner connecting directly is filtered too (the case
-- where a future migration or a psql session reads across users without
-- noticing). The suite proves this on the owner path, with a control.
alter table programs          force row level security;
alter table program_revisions force row level security;
alter table program_items     force row level security;

drop policy if exists programs_select_own on programs;
create policy programs_select_own on programs
  for select to authenticated
  using (user_id = current_app_user_id());

drop policy if exists program_revisions_select_own on program_revisions;
create policy program_revisions_select_own on program_revisions
  for select to authenticated
  using (user_id = current_app_user_id());

drop policy if exists program_items_select_own on program_items;
create policy program_items_select_own on program_items
  for select to authenticated
  using (user_id = current_app_user_id());

-- No INSERT/UPDATE/DELETE policy for authenticated on any of the three: the
-- interface renders (Phase 4) and the write surfaces come later (R6.3)
-- through the Engine's audited path, not through PostgREST from a browser.
revoke all on programs          from authenticated;
revoke all on program_revisions from authenticated;
revoke all on program_items     from authenticated;
grant select on programs          to authenticated;
grant select on program_revisions to authenticated;
grant select on program_items     to authenticated;

revoke all on programs          from anon;
revoke all on program_revisions from anon;
revoke all on program_items     from anon;

-- ── 5. publish_program_revision() — one revision, one transaction, or nothing ─
--
-- Finds or creates the program (by owner, kind, title), writes the revision
-- with the source verbatim and its SHA-256 computed HERE (so the hash the
-- constraint sees is the hash of what was stored, not what a caller claims),
-- writes every item at 'planned' with NULL actuals, and moves
-- current_revision_id. Any failure — an unknown category, an item outside
-- the program's dates, the same source again — unwinds all of it.
--
-- p_items is a JSON array of objects with exactly the PLANNED fields:
--   item_key, scheduled_date, category, title, instructions,
--   planned_start_local, planned_duration_minutes, source_locator
-- Anything else in an element is ignored: this function has no way to write
-- an actual, which is how "actuals never carry" is a property and not a habit.
create or replace function publish_program_revision(
  p_user_id     uuid,
  p_kind        text,
  p_title       text,
  p_description text,
  p_start_date  date,
  p_end_date    date,
  p_time_zone   text,
  p_source_name text,
  p_source_text text,
  p_items       jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_program_id  uuid;
  v_prev_rev_id uuid;
  v_rev_id      uuid;
  v_rev_number  int;
  v_sha         text;
  v_n_items     int;
  v_outside     int;
  n             int;
  v_existing    int;
begin
  -- ── 0. the owner must be a real account; the arguments must be usable ────
  if p_user_id is null then
    raise exception 'publish_program_revision refused: an owner user_id is required'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from app_users where id = p_user_id) then
    raise exception 'publish_program_revision refused: no app_users row with id %', p_user_id
      using errcode = 'foreign_key_violation';
  end if;
  if p_kind is null or p_title is null or btrim(p_title) = '' then
    raise exception 'publish_program_revision refused: kind and a non-blank title are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_start_date is null then
    raise exception 'publish_program_revision refused: start_date is required (derive it from the source, do not invent it)'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_source_name is null or btrim(p_source_name) = '' or p_source_text is null or p_source_text = '' then
    raise exception 'publish_program_revision refused: source_name and a non-empty source_text are required — the source is stored, not summarised'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'publish_program_revision refused: p_items must be a non-empty JSON array'
      using errcode = 'invalid_parameter_value';
  end if;
  -- An unknown time zone raises 22023 here rather than at read time in the brief.
  perform now() at time zone p_time_zone;

  -- ── 1. the program: find by (owner, kind, title), else create ────────────
  select id, current_revision_id into v_program_id, v_prev_rev_id
    from programs
   where user_id = p_user_id and kind = p_kind and title = btrim(p_title);
  if v_program_id is null then
    insert into programs (user_id, kind, title, description, start_date, end_date, time_zone, status)
    values (p_user_id, p_kind, btrim(p_title), p_description, p_start_date, p_end_date, p_time_zone, 'active')
    returning id into v_program_id;
    v_prev_rev_id := null;
  end if;

  -- ── 2. the revision: source verbatim, hash computed here ─────────────────
  v_sha := encode(sha256(convert_to(p_source_text, 'UTF8')), 'hex');
  select coalesce(max(revision_number), 0) + 1 into v_rev_number
    from program_revisions where program_id = v_program_id;

  begin
    insert into program_revisions (user_id, program_id, revision_number, source_name, source_text, source_sha256, supersedes_revision_id)
    values (p_user_id, v_program_id, v_rev_number, btrim(p_source_name), p_source_text, v_sha, v_prev_rev_id)
    returning id into v_rev_id;
  exception when unique_violation then
    -- The constraint is the authority; this only names it in plain words.
    select revision_number into v_existing
      from program_revisions where program_id = v_program_id and source_sha256 = v_sha;
    raise exception 'publish_program_revision: this exact source is already published as revision % of "%" — nothing written',
      coalesce(v_existing::text, '?'), btrim(p_title)
      using errcode = 'unique_violation';
  end;

  -- ── 3. the items — planned side only, every one at planned ───────────────
  insert into program_items (
    user_id, program_id, program_revision_id, item_key, scheduled_date, category, title,
    instructions, planned_start_local, planned_duration_minutes, source_locator)
  select p_user_id, v_program_id, v_rev_id,
         e->>'item_key',
         (e->>'scheduled_date')::date,
         e->>'category',
         e->>'title',
         nullif(e->>'instructions', ''),
         nullif(e->>'planned_start_local', ''),
         nullif(e->>'planned_duration_minutes', '')::int,
         nullif(e->>'source_locator', '')
    from jsonb_array_elements(p_items) as e;

  v_n_items := jsonb_array_length(p_items);

  -- Every item inside the program's dates. A plan cannot schedule outside itself.
  select count(*) into v_outside
    from program_items
   where program_revision_id = v_rev_id
     and (scheduled_date < p_start_date or (p_end_date is not null and scheduled_date > p_end_date));
  if v_outside > 0 then
    raise exception 'publish_program_revision refused: % item(s) fall outside [% .. %] — nothing written',
      v_outside, p_start_date, coalesce(p_end_date::text, 'open')
      using errcode = 'check_violation';
  end if;

  -- ── 4. the pointer, and the program's current dates ──────────────────────
  update programs
     set current_revision_id = v_rev_id,
         description = coalesce(p_description, description),
         start_date  = p_start_date,
         end_date    = p_end_date,
         time_zone   = p_time_zone
   where id = v_program_id;

  -- ── post-conditions, inside the transaction ──────────────────────────────
  select count(*) into n from program_items where program_revision_id = v_rev_id;
  if n <> v_n_items then
    raise exception 'publish_program_revision ASSERT: % items written, % supplied', n, v_n_items;
  end if;
  select count(*) into n from program_items
   where program_revision_id = v_rev_id
     and (status <> 'planned' or actual_started_at is not null or actual_finished_at is not null
          or actual_duration_minutes is not null or actual_note is not null);
  if n <> 0 then
    raise exception 'publish_program_revision ASSERT: % items of the new revision did not start at planned with NULL actuals', n;
  end if;
  select count(*) into n from programs where id = v_program_id and current_revision_id = v_rev_id and user_id = p_user_id;
  if n <> 1 then
    raise exception 'publish_program_revision ASSERT: current_revision_id was not moved to the new revision';
  end if;

  return jsonb_build_object(
    'program_id',             v_program_id,
    'revision_id',            v_rev_id,
    'revision_number',        v_rev_number,
    'supersedes_revision_id', v_prev_rev_id,
    'source_sha256',          v_sha,
    'items',                  v_n_items);
end;
$fn$;

comment on function publish_program_revision(uuid, text, text, text, date, date, text, text, text, jsonb) is
  'Publishes one program revision atomically: find-or-create the program, store the source verbatim with its SHA-256, write every item at planned, move current_revision_id. Same source twice raises 23505 (the UNIQUE constraint decides). Actuals never carry. service_role only. R6.2a, 2026-09-09.';

revoke execute on function publish_program_revision(uuid, text, text, text, date, date, text, text, text, jsonb) from public;
revoke execute on function publish_program_revision(uuid, text, text, text, date, date, text, text, text, jsonb) from anon;
revoke execute on function publish_program_revision(uuid, text, text, text, date, date, text, text, text, jsonb) from authenticated;
grant  execute on function publish_program_revision(uuid, text, text, text, date, date, text, text, text, jsonb) to service_role;

-- ── 6. todays_program_items() — the brief's computed block, one read ────────
--
-- Everything scheduled for ONE person on the calendar day it is right now in
-- EACH program's own time zone, from each program's current revision. The
-- owner is a required argument (the backend derives it, never a request
-- body). "Today" is computed here, in SQL, from the program's time_zone —
-- so a brief composed at 03:30Z on the 15th reads the 14th's items for a
-- program in America/New_York, which is what the person means by today.
create or replace function todays_program_items(p_user_id uuid, p_at timestamptz default now())
returns table (
  program_id               uuid,
  program_title            text,
  program_kind             text,
  time_zone                text,
  local_date               text,
  item_id                  uuid,
  item_key                 text,
  category                 text,
  title                    text,
  instructions             text,
  planned_start_local      text,
  planned_duration_minutes int,
  status                   text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.title, p.kind, p.time_zone,
         -- as text, so every driver hands the brief the same 'YYYY-MM-DD'
         to_char((p_at at time zone p.time_zone)::date, 'YYYY-MM-DD'),
         i.id, i.item_key, i.category, i.title, i.instructions,
         i.planned_start_local, i.planned_duration_minutes, i.status
    from programs p
    join program_items i
      on i.program_revision_id = p.current_revision_id
     and i.program_id = p.id
     and i.user_id = p.user_id
   where p.user_id = p_user_id
     and p_user_id is not null
     and p.status = 'active'
     and p.current_revision_id is not null
     and i.scheduled_date = (p_at at time zone p.time_zone)::date
   order by p.title, i.planned_start_local nulls last, i.title;
$$;

comment on function todays_program_items(uuid, timestamptz) is
  'One person''s items for today, where today is computed in each program''s own time_zone from the current revision. Owner is a required argument; service_role only. The brief''s computed today''s-program block reads this and nothing else. R6.2a, 2026-09-09.';

revoke execute on function todays_program_items(uuid, timestamptz) from public;
revoke execute on function todays_program_items(uuid, timestamptz) from anon;
revoke execute on function todays_program_items(uuid, timestamptz) from authenticated;
grant  execute on function todays_program_items(uuid, timestamptz) to service_role;

-- ── SELF-PROOF — assertions BEFORE commit; any failure rolls it all back ─────
--
-- Same convention as the two migrations before it: a claim nobody reads is
-- not a check, and "no error appeared" is not a pass.

-- ASSERT 1 — the three tables carry EXACTLY the contract's columns, and
-- scheduled_date is a DATE. Compared as sorted name lists so an extra column,
-- a missing one or a renamed one all fail by name.
do $$
declare got text; want text;
begin
  select string_agg(column_name, ',' order by column_name) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'programs';
  want := 'current_revision_id,description,end_date,id,kind,start_date,status,time_zone,title,user_id';
  if got is distinct from want then raise exception 'ASSERT: programs columns are [%], contract says [%]', got, want; end if;

  select string_agg(column_name, ',' order by column_name) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'program_revisions';
  want := 'created_at,id,program_id,revision_number,source_name,source_sha256,source_text,supersedes_revision_id,user_id';
  if got is distinct from want then raise exception 'ASSERT: program_revisions columns are [%], contract says [%]', got, want; end if;

  select string_agg(column_name, ',' order by column_name) into got
    from information_schema.columns where table_schema = 'public' and table_name = 'program_items';
  want := 'actual_duration_minutes,actual_finished_at,actual_note,actual_started_at,category,id,instructions,item_key,'
       || 'planned_duration_minutes,planned_start_local,program_id,program_revision_id,proposed_duration_minutes,'
       || 'proposed_start_at,reminder_id,scheduled_date,source_locator,status,title,user_id';
  if got is distinct from want then raise exception 'ASSERT: program_items columns are [%], contract says [%]', got, want; end if;

  select data_type into got from information_schema.columns
   where table_schema = 'public' and table_name = 'program_items' and column_name = 'scheduled_date';
  if got is distinct from 'date' then raise exception 'ASSERT: program_items.scheduled_date is %, must be date (never a timestamp)', got; end if;

  select data_type into got from information_schema.columns
   where table_schema = 'public' and table_name = 'programs' and column_name = 'start_date';
  if got is distinct from 'date' then raise exception 'ASSERT: programs.start_date is %, must be date', got; end if;
end $$;

-- ASSERT 2 — RLS enabled AND forced on all three; no policy names anon or
-- public; exactly three select-own policies; anon holds no table privilege.
do $$
declare n int;
begin
  select count(*) into n from pg_class
   where relname in ('programs','program_revisions','program_items')
     and relrowsecurity and relforcerowsecurity;
  if n <> 3 then raise exception 'ASSERT: expected 3 program tables with RLS enabled AND forced, found %', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('programs','program_revisions','program_items')
     and ('anon' = any (roles) or 'public' = any (roles));
  if n <> 0 then raise exception 'ASSERT: % program policies expose anon/public', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('programs','program_revisions','program_items');
  if n <> 3 then raise exception 'ASSERT: expected 3 policies (select own, one per table), found %', n; end if;

  select count(*) into n from pg_policies
   where tablename in ('programs','program_revisions','program_items') and cmd <> 'SELECT';
  if n <> 0 then raise exception 'ASSERT: % non-SELECT policies exist — writes are service-role only', n; end if;

  select count(*) into n from information_schema.table_privileges
   where table_schema = 'public' and table_name in ('programs','program_revisions','program_items')
     and grantee = 'anon';
  if n <> 0 then raise exception 'ASSERT: anon holds % privileges on the program tables', n; end if;

  select count(*) into n from information_schema.table_privileges
   where table_schema = 'public' and table_name in ('programs','program_revisions','program_items')
     and grantee = 'authenticated' and privilege_type <> 'SELECT';
  if n <> 0 then raise exception 'ASSERT: authenticated holds % non-SELECT privileges on the program tables', n; end if;
end $$;

-- ASSERT 3 — the two functions: SECURITY DEFINER, pinned search_path,
-- unreachable from the publishable key, reachable by the backend.
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('publish_program_revision', 'todays_program_items')
  loop
    if not r.prosecdef then raise exception 'ASSERT: % is not SECURITY DEFINER', r.proname; end if;
    if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
      raise exception 'ASSERT: % search_path is not pinned (found %)', r.proname, r.proconfig;
    end if;
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception 'ASSERT: anon can execute %', r.proname;
    end if;
    if has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception 'ASSERT: authenticated can execute % — a member could name another owner', r.proname;
    end if;
    if not has_function_privilege('service_role', r.oid, 'execute') then
      raise exception 'ASSERT: service_role cannot execute % — the backend could not use it', r.proname;
    end if;
  end loop;
  select count(*) into r from pg_proc where proname in ('publish_program_revision', 'todays_program_items');
  if r.count <> 2 then raise exception 'ASSERT: expected both program functions, found %', r.count; end if;
end $$;

-- ASSERT 4 — the preconditions the controls need, stated rather than assumed.
do $$
declare n int;
begin
  select count(*) into n from app_users;
  if n < 1 then raise exception 'ASSERT: no app_users row exists to own the control program'; end if;
  select count(*) into n from programs where title like 'R6.2a control %';
  if n <> 0 then raise exception 'ASSERT: a control program already exists; the last apply did not unwind'; end if;
end $$;

-- CONTROL 1 — the POSITIVE path, the idempotency rule, the supersede chain
-- and "actuals never carry", all in one block, then unwound.
--
-- Two publishes of the SAME source must leave one revision (23505 on the
-- second); a CHANGED source must create revision 2 pointing at revision 1;
-- an item marked completed in revision 1 must reappear at planned in
-- revision 2. Unwound by raising a sentinel, and the unwind is asserted.
do $$
declare owner uuid; r1 jsonb; r2 jsonb; failed_with text := null; n int; n_rev int; n_items int;
        src1 text := E'title: R6.2a control plan\nkind: training\n2026-01-05 | swim | control swim\n2026-01-06 | rest | control rest';
        src2 text := E'title: R6.2a control plan\nkind: training\n2026-01-05 | bike | control bike\n2026-01-06 | rest | control rest';
        items1 jsonb := '[{"item_key":"2026-01-05:swim:control-swim","scheduled_date":"2026-01-05","category":"swim","title":"control swim","planned_start_local":"06:30","planned_duration_minutes":45},
                          {"item_key":"2026-01-06:rest:control-rest","scheduled_date":"2026-01-06","category":"rest","title":"control rest"}]';
        items2 jsonb := '[{"item_key":"2026-01-05:bike:control-bike","scheduled_date":"2026-01-05","category":"bike","title":"control bike"},
                          {"item_key":"2026-01-06:rest:control-rest","scheduled_date":"2026-01-06","category":"rest","title":"control rest"}]';
begin
  select id into owner from app_users order by created_at limit 1;
  begin
    r1 := publish_program_revision(owner, 'training', 'R6.2a control plan', 'control', '2026-01-05', '2026-01-06',
                                   'America/New_York', 'control.txt', src1, items1);
    if (r1->>'revision_number')::int <> 1 or (r1->>'items')::int <> 2 or r1->>'supersedes_revision_id' is not null then
      raise exception 'CONTROL 1: first publish returned %', r1;
    end if;
    select count(*) into n from program_items
     where program_revision_id = (r1->>'revision_id')::uuid and status = 'planned' and user_id = owner;
    if n <> 2 then raise exception 'CONTROL 1: expected 2 planned items in revision 1, found %', n; end if;
    if (r1->>'source_sha256') <> encode(sha256(convert_to(src1, 'UTF8')), 'hex') then
      raise exception 'CONTROL 1: the stored hash is not the SHA-256 of the stored source';
    end if;

    -- the same source again: the constraint must refuse, with 23505
    begin
      perform publish_program_revision(owner, 'training', 'R6.2a control plan', 'control', '2026-01-05', '2026-01-06',
                                       'America/New_York', 'control.txt', src1, items1);
    exception when others then failed_with := sqlstate;
    end;
    if failed_with is null then
      raise exception 'CONTROL 1: the same source was published twice — the (program_id, source_sha256) uniqueness is not reaching the constraint';
    end if;
    if failed_with <> '23505' then raise exception 'CONTROL 1: expected unique_violation 23505 on the second publish, got %', failed_with; end if;
    select count(*) into n_rev from program_revisions where program_id = (r1->>'program_id')::uuid;
    if n_rev <> 1 then raise exception 'CONTROL 1: % revisions after publishing the same source twice, expected 1', n_rev; end if;

    -- mark an item done in revision 1, then publish a CHANGED source
    update program_items set status = 'completed', actual_note = 'done', actual_duration_minutes = 40
     where program_revision_id = (r1->>'revision_id')::uuid and item_key = '2026-01-06:rest:control-rest';
    r2 := publish_program_revision(owner, 'training', 'R6.2a control plan', 'control', '2026-01-05', '2026-01-06',
                                   'America/New_York', 'control-v2.txt', src2, items2);
    if (r2->>'revision_number')::int <> 2 or (r2->>'supersedes_revision_id') <> (r1->>'revision_id') then
      raise exception 'CONTROL 1: the changed source did not create revision 2 superseding revision 1 (got %)', r2;
    end if;
    select count(*) into n from programs where id = (r1->>'program_id')::uuid and current_revision_id = (r2->>'revision_id')::uuid;
    if n <> 1 then raise exception 'CONTROL 1: current_revision_id does not point at revision 2'; end if;
    select count(*) into n from program_items
     where program_revision_id = (r2->>'revision_id')::uuid
       and (status <> 'planned' or actual_note is not null or actual_duration_minutes is not null);
    if n <> 0 then raise exception 'CONTROL 1: % item(s) of revision 2 carried an actual from revision 1 — actuals must never carry', n; end if;
    select count(*) into n from program_items
     where program_revision_id = (r1->>'revision_id')::uuid and status = 'completed';
    if n <> 1 then raise exception 'CONTROL 1: revision 1''s completed item was disturbed by publishing revision 2'; end if;

    raise exception 'UNWIND_CONTROL_1';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_1' then raise; end if;
  end;
  select count(*) into n from programs where title = 'R6.2a control plan';
  select count(*) into n_rev from program_revisions where source_name in ('control.txt', 'control-v2.txt');
  select count(*) into n_items from program_items where item_key like '2026-01-0%:%:control-%';
  if n <> 0 or n_rev <> 0 or n_items <> 0 then
    raise exception 'CONTROL 1: the unwind left rows behind — programs %, revisions %, items %', n, n_rev, n_items;
  end if;
end $$;

-- CONTROL 2 — the NEGATIVE paths, each proven separately and each writing
-- nothing: a category outside the closed union (23514), an item outside the
-- program's dates (23514), an unknown time zone (22023), an owner that does
-- not exist (23503). Postgres aborts a transaction on the first error, so
-- each runs in its own subtransaction.
do $$
declare owner uuid; failed_with text; n int;
begin
  select id into owner from app_users order by created_at limit 1;

  failed_with := null;
  begin
    perform publish_program_revision(owner, 'training', 'R6.2a control bad category', null, '2026-01-05', '2026-01-05',
      'America/New_York', 'c.txt', 'x', '[{"item_key":"k","scheduled_date":"2026-01-05","category":"yoga","title":"t"}]');
  exception when others then failed_with := sqlstate;
  end;
  if failed_with is distinct from '23514' then raise exception 'CONTROL 2: a category outside the union was not refused with 23514 (got %)', failed_with; end if;

  failed_with := null;
  begin
    perform publish_program_revision(owner, 'training', 'R6.2a control bad date', null, '2026-01-05', '2026-01-05',
      'America/New_York', 'c.txt', 'x', '[{"item_key":"k","scheduled_date":"2026-01-06","category":"swim","title":"t"}]');
  exception when others then failed_with := sqlstate;
  end;
  if failed_with is distinct from '23514' then raise exception 'CONTROL 2: an item outside the program dates was not refused with 23514 (got %)', failed_with; end if;

  failed_with := null;
  begin
    perform publish_program_revision(owner, 'training', 'R6.2a control bad tz', null, '2026-01-05', '2026-01-05',
      'Mars/Olympus_Mons', 'c.txt', 'x', '[{"item_key":"k","scheduled_date":"2026-01-05","category":"swim","title":"t"}]');
  exception when others then failed_with := sqlstate;
  end;
  if failed_with is distinct from '22023' then raise exception 'CONTROL 2: an unknown time zone was not refused with 22023 (got %)', failed_with; end if;

  failed_with := null;
  begin
    perform publish_program_revision('00000000-0000-0000-0000-00000000dead', 'training', 'R6.2a control bad owner', null, '2026-01-05', '2026-01-05',
      'America/New_York', 'c.txt', 'x', '[{"item_key":"k","scheduled_date":"2026-01-05","category":"swim","title":"t"}]');
  exception when others then failed_with := sqlstate;
  end;
  if failed_with is distinct from '23503' then raise exception 'CONTROL 2: an unknown owner was not refused with 23503 (got %)', failed_with; end if;

  select count(*) into n from programs where title like 'R6.2a control %';
  if n <> 0 then raise exception 'CONTROL 2: a refused publish left % program row(s) behind', n; end if;
end $$;

-- CONTROL 3 — todays_program_items reads ONE owner's items for the day it is
-- in the program's time zone, and another owner reads nothing. Both halves in
-- one block, against the same rows; only the asker changes. Unwound.
do $$
declare owner uuid; other uuid; r jsonb; n_owner int; n_other int; n_utc int; n_local int;
begin
  select id into owner from app_users order by created_at limit 1;
  begin
    r := publish_program_revision(owner, 'routine', 'R6.2a control routine', null, '2026-01-05', null, 'America/New_York',
           'r.txt', 'routine', '[{"item_key":"2026-01-05:face:f","scheduled_date":"2026-01-05","category":"face","title":"face"},
                                 {"item_key":"2026-01-06:oil:o","scheduled_date":"2026-01-06","category":"oil","title":"oil"}]');
    -- 2026-01-06 03:30Z is 2026-01-05 22:30 in New York: the 5th's item, not the 6th's.
    select count(*) into n_local from todays_program_items(owner, '2026-01-06T03:30:00Z') where category = 'face';
    select count(*) into n_utc   from todays_program_items(owner, '2026-01-06T03:30:00Z') where category = 'oil';
    if n_local <> 1 or n_utc <> 0 then
      raise exception 'CONTROL 3: today was not computed in the program''s time zone (local-day item %, utc-day item %)', n_local, n_utc;
    end if;
    select count(*) into n_owner from todays_program_items(owner, '2026-01-05T17:00:00Z');
    -- a second owner: any other account, else a throwaway one inside the block
    select id into other from app_users where id <> owner order by created_at limit 1;
    if other is null then
      insert into app_users (phone, timezone) values ('15550100144', 'America/New_York') returning id into other;
    end if;
    select count(*) into n_other from todays_program_items(other, '2026-01-05T17:00:00Z');
    if n_owner <> 1 then raise exception 'CONTROL 3: the owner did not get their item for the day (got %)', n_owner; end if;
    if n_other <> 0 then raise exception 'CONTROL 3: another account read % of the owner''s items', n_other; end if;
    raise exception 'UNWIND_CONTROL_3';
  exception when others then
    if sqlerrm <> 'UNWIND_CONTROL_3' then raise; end if;
  end;
  select count(*) into n_owner from programs where title = 'R6.2a control routine';
  if n_owner <> 0 then raise exception 'CONTROL 3: the unwind left rows behind'; end if;
end $$;

-- PostgREST caches the schema; make the reload explicit rather than assumed.
notify pgrst, 'reload schema';

commit;

-- ── POST-CHECK — run this AFTER applying, and keep the output ───────────────
-- 1) Three tables, RLS on and forced. Expect 3 rows, all t/t.
--   select relname, relrowsecurity, relforcerowsecurity from pg_class
--    where relname in ('programs','program_revisions','program_items') order by relname;
--
-- 2) No policy names anon/public. Expect ZERO rows.
--   select tablename, policyname, roles from pg_policies
--    where tablename in ('programs','program_revisions','program_items')
--      and ('anon' = any (roles) or 'public' = any (roles));
--
-- 3) The idempotency constraint exists. Expect one row: UNIQUE (program_id, source_sha256)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'program_revisions_program_id_source_sha256_key';
--
-- 4) Only service_role can call the two functions. Expect f, f, t twice.
--   select proname,
--          has_function_privilege('anon',          p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role',  p.oid, 'execute') as service_role
--     from pg_proc p where proname in ('publish_program_revision','todays_program_items');
--
-- 5) The controls left nothing behind, and no real program exists yet
--    (loading one is the load script's job, with --commit). Expect 0, 0, 0.
--   select (select count(*) from programs) as programs,
--          (select count(*) from program_revisions) as revisions,
--          (select count(*) from program_items) as items;
-- ────────────────────────────────────────────────────────────────────────────
