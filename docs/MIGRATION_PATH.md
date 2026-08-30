# Migration path — how DDL reaches the Cedrus database

**2026-08-30 · Session A · the commands Emil runs, in order**

## The sanctioned path, and the correction it implies

Law 8 in `CEDRUS.md` still reads *"THERE IS NO SANCTIONED DDL PATH TODAY. A
DECISION IS PENDING FOR EMIL."* That block was written 2026-08-26 and is now
stale: option 2 was chosen. **DDL goes through the Supabase CLI, one file per
migration, applied with `supabase migration up --linked` — never a bare
`db push`**, which diffs the whole schema and applies whatever it thinks is
missing. Law 8 and II.5 are corrected in the same session that observed the
contradiction (Law 12).

`supabase/migrations/` did not exist in this repo before today. It does now,
and it holds exactly one file.

## Step 0 — repair the remote history, before anything else

The remote holds six migration versions that have **no corresponding file** in
this repo. They were applied to the database by an older workflow that never
committed the SQL. `supabase migration up` compares the remote history table
against the local directory; with those six unaccounted for, it will not
proceed cleanly.

`migration repair --status applied` writes a row into the remote
`supabase_migrations.schema_migrations` history table saying "this version is
already applied, there is no file, stop asking." **It runs no SQL against the
schema and changes no table, column or row** — it edits the ledger, not the
database. That is why it is safe to run against production and why it must come
before the apply rather than after.

Run these six, in this order:

```bash
supabase migration repair --status applied 20260711053438
```

```bash
supabase migration repair --status applied 20260711053439
```

```bash
supabase migration repair --status applied 20260713120000
```

```bash
supabase migration repair --status applied 20260713120001
```

```bash
supabase migration repair --status applied 20260716120000
```

```bash
supabase migration repair --status applied 20260716120001
```

### Why `migration up` is then safe

With the history repaired, the local `supabase/migrations/` directory contains
exactly one file the remote has never seen —
`20260830120000_multiuser_foundation.sql` — and the remote contains no version
the local directory cannot account for. The two are in agreement about
everything before today. `supabase migration up --linked` therefore has exactly
one thing it can do: run that one file, in its own transaction, and record its
version. It does not diff the schema, does not infer intent, and cannot decide
that some unrelated object is "missing" and act on it. That is the entire
difference from `db push`, and it is why the repair step is a precondition
rather than a cleanup: an unrepaired history is the state in which the tooling
starts guessing.

## Step 1 — the pre-check

Run the PRE-CHECK block from the top of
`supabase/migrations/20260830120000_multiuser_foundation.sql` in the Supabase
SQL editor. Keep the output. On a system that has never had this migration you
should see three zeros for the tables, zero for the app_users columns, and your
current user count.

## Step 2 — confirm what is pending, then apply

```bash
supabase migration list --linked
```

The 2026-08-30 version must appear as local-only. Then:

```bash
supabase migration up --linked
```

## Step 3 — the post-check

Run the POST-CHECK block from the bottom of the same file. Eight numbered
queries. Two of them are **controls that must RAISE** — the closed capability
vocabulary (expect `23514`) and the append-only audit trigger (expect
`restrict_violation` on both the UPDATE and the DELETE). Both are wrapped in
`begin; … rollback;` so they leave nothing behind.

A check that cannot fail proves nothing (Law 3). Those two raises are the only
evidence that the constraint and the trigger actually work, so do not skip them
because the migration reported success.

Query 4 is the one that matters most: **no policy may grant `anon` anything.**
The publishable key is public and ships in the client bundle, so a single anon
policy on any of these three tables is a full read of everyone's data by anyone
with the JavaScript. Expect zero rows.

## What this migration does NOT do

- It creates **no user**. Emil's and dad's accounts are created through the
  admin panel in Session D, which writes the `app_users` row, the settings
  defaults, the capability grants and the `admin_audit` entry as one audited
  operation.
- It migrates **no existing data**. Every existing `app_users` row picks up
  `role = 'member'` and `account_status = 'active'` from the column defaults.
  **Emil's own row is therefore a member, not an admin, until it is promoted** —
  which is deliberate: this session does not decide who is an admin, and a
  migration that silently granted admin to whoever happened to be in the table
  would be exactly the wrong default.
- It **does not enable RLS on `app_users`** or alter any policy on an existing
  table. Only the three new tables are touched. Whether `app_users` should get
  its own policies is a real question and belongs to Session C, where the
  browser first reads it.

## Step 4 — one check against the CoS project, BEFORE the code deploys

This is not part of the migration and it is not optional. Session A made every
CoS read carry `.eq('user_id', …)`. Seven of the eight tables the brief reads
are confirmed to have a `user_id` column, from the 2026-08-26 live dump. **The
eighth, `email_ai_analyses`, is not in that dump and is unverified.**

If that table has no `user_id` column, the filter returns PostgREST `42703`
("column does not exist"), and because the reader deliberately fails closed on
an unreadable table, **the entire daily brief aborts** — for everyone, every
morning, starting with the first 11:00 UTC run after deploy. It would announce
itself correctly (`cos.brief.aborted`, naming the table), so it is loud rather
than silent, but it is still a daily outage until someone looks.

Run this against the **Chief of Staff** project (`kpzyzjhfvjfvxowhusir`), not
the Cedrus one:

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'email_ai_analyses'
   and column_name = 'user_id';
```

One row means the code is safe to deploy. **Zero rows means stop** — either add
the column on the CoS side, or drop `email_ai_analyses` from `READABLE_TABLES`
and from `gatherCosInput` before deploying.

## Unverified, stated plainly

The `supabase` CLI is **not installed on this machine** (`which supabase` →
not found), so nothing in this document was executed. Specifically:

- The six file-less versions are taken from the session prompt. They were
  **not** confirmed against `supabase migration list --linked`. If the real
  list differs, the repair commands must be regenerated from it rather than
  from this file.
- The migration SQL has **not** been run against any database, local or remote.
  It is syntax-reviewed by hand only.
