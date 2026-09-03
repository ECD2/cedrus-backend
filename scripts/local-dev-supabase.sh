#!/usr/bin/env bash
# Stand up a LOCAL Supabase stack in Docker for development.
#
#   bash scripts/local-dev-supabase.sh
#
# WHAT THIS IS FOR
# A real Postgres + PostgREST + GoTrue + Studio on this machine, so migrations
# and multi-user isolation can be developed and tested against the actual
# stack instead of fixtures. Sessions B–E should be written against this.
#
# ⚠ BUT IT CANNOT DO THAT YET, AND SAYS SO (2026-09-03). This script starts the
# stack and then REFUSES `db reset` — there is no baseline schema in this repo,
# so a fresh local database cannot be built from supabase/migrations/ at all.
# The long comment above the refusal, further down, has the reason and the fix.
# Until a baseline dump is committed, what comes up is a bare Postgres with no
# Cedrus schema, which is not yet something Sessions B–E can be written against.
#
# WHAT THIS IS *NOT* FOR
# It does NOT help apply a migration to production. `supabase migration up
# --linked` connects to the remote Postgres and authenticates with the DATABASE
# PASSWORD; Docker is not in that path. Use scripts/apply-multiuser-migration.sh
# for production.
#
# ⚠ THE ONE COMMAND NEVER TO RUN WITH --linked
# `supabase db reset` DROPS AND REBUILDS the database. Locally that would be the
# point. Against the linked project it would drop PRODUCTION — which is named
# "cedrus-dev", the trap recorded in CEDRUS_MASTER_CONTEXT.md §7. **No line in
# this script passes --linked, and as of 2026-09-03 no line runs `db reset` at
# all** — it is refused with an explanation instead. If a future session
# restores the reset once a baseline exists, it stays local and unlinked: the
# danger of this command is that the safe and catastrophic forms differ by one
# flag.
set -euo pipefail
cd "$(dirname "$0")/.."

SB="npx --yes supabase@2.114.0"

if ! docker info >/dev/null 2>&1; then
  cat <<'MSG'
Docker is not running.

Install one of these, start it, then re-run this script:
  · Docker Desktop   https://www.docker.com/products/docker-desktop/
  · OrbStack         https://orbstack.dev   (lighter, faster on Apple silicon)
  · colima           brew install colima docker && colima start

The first `supabase start` pulls several GB of images. Later starts are quick.
MSG
  exit 1
fi
echo "Docker: OK"

if [ ! -f supabase/config.toml ]; then
  echo "== supabase init (no config.toml yet) =="
  echo "If it asks about VS Code or IntelliJ Deno settings, answer n."
  $SB init
else
  echo "config.toml already present — skipping init"
fi

echo
echo "== starting the local stack (first run pulls images) =="
$SB start

echo
echo "== NOT applying migrations: db reset cannot succeed on this repo yet =="
# ⚠ THIS SCRIPT DELIBERATELY DOES NOT RUN `db reset`. Recorded 2026-09-03.
#
# It used to run it here, and then tell the reader that the migration's
# assertions and both controls had passed. That claim was false twice over, and
# `db reset` cannot succeed against a fresh local database for a structural
# reason that no amount of retrying fixes:
#
#   1. 42P01, UNDEFINED TABLE. The only file in supabase/migrations/ is
#      20260830120000_multiuser_foundation.sql, and it opens with
#      `alter table app_users add column ...`. It does not CREATE app_users —
#      the only tables it creates are user_capabilities, user_settings and
#      admin_audit. A fresh local database has no app_users, so the very first
#      statement aborts the transaction and nothing lands.
#
#   2. Even WITH the table present, CONTROL 1 raises. It reads
#      `select id into uid from app_users limit 1` and then
#      `if uid is null then raise exception 'ASSERT: no app_users row exists to
#      run the controls against'`. A freshly reset database has zero rows, so
#      the control that proves the capability vocabulary discriminates cannot
#      run at all. It fails honestly rather than passing vacuously — which is
#      correct behaviour (Law 3) and is exactly why this is not a bug to patch
#      around in the migration.
#
# So "the stack came up" was never evidence that anything was proven. Note also
# that `supabase start` applies migrations itself on a FRESH volume, so the same
# 42P01 is expected to surface above even without a reset — expected, not
# observed here, because the supabase CLI is not installed on this machine and
# Docker is not running, so nothing in this script has been executed end to end.
#
# WHAT IS ACTUALLY NEEDED FIRST: A BASELINE SCHEMA DUMP OF PRODUCTION.
# Roughly 35 tables are live in the Cedrus project today. Every one of them was
# built by the old bespoke runner (~/.config/cedrus/migrate/run-migration.mjs),
# which was never in version control and went with the old machine — so there
# are NO migration files behind any of them. supabase/migrations/ holds one
# additive file and nothing that could construct the schema it alters. The
# local stack therefore cannot be built from this repo at all, by any command.
#
# The fix is one migration file that does not exist yet: a baseline dump of
# production, ordered before 20260830120000 so `db reset` replays the schema and
# then alters it. Generate it with `supabase db dump --linked -f <baseline>.sql`
# (read-only against prod; it is a dump, not an apply), commit it as the
# earliest version, and this script can run `db reset` again. Until then a local
# stack is a bare Postgres with no Cedrus schema in it.
#
# The ~35 figure is Emil's and was NOT re-counted for this comment: prod is
# unreachable from here, and per II.2 a migration folder is not evidence about
# prod. What IS verified on disk (2026-09-03) is the part that matters — the
# repo holds exactly one migration file, and it creates none of those tables.
cat <<'SKIPPED'
Refusing to run `supabase db reset`, deliberately — it cannot succeed yet.

  · the one migration file ALTERs app_users; nothing in this repo CREATEs it,
    so a fresh database fails at 42P01 on the first statement
  · and with the table present, CONTROL 1 raises on an empty app_users

Needed first: a baseline schema dump of production, committed as the earliest
migration. See the comment block above this message for the exact command.
SKIPPED

cat <<'DONE'

Local stack is up. Studio is at the URL printed above (usually
http://127.0.0.1:54323). The API URL, anon key and service-role key printed by
`supabase start` are LOCAL ONLY — they are the same for every developer and are
not secrets.

Useful from here:
  npx --yes supabase@2.114.0 status      # URLs and keys again
  npx --yes supabase@2.114.0 stop        # shut the stack down

NOT useful yet, and left off that list on purpose:
  npx --yes supabase@2.114.0 db reset    # fails at 42P01 — see above

WHAT THIS RUN DID AND DID NOT PROVE
It started a stack. It applied NO migration, ran NO assertion and ran NEITHER
control, so it says nothing whatsoever about whether the multi-user migration
is correct. It is not a rehearsal of anything.

Note for whoever reads that as "so the migration is untested": it is not. The
multi-user migration WAS applied to production and verified by read-back
before 2026-09-01 — b22d5cf says so in its first paragraph, and its self-proof
block ran inside that transaction. What has never happened is a LOCAL run,
which is what this script was supposed to give you and cannot yet.

⚠ docs/MIGRATION_PATH.md still closes with "Unverified, stated plainly",
saying the SQL "has not been run against any database, local or remote". That
was true when written on 2026-08-30 and was overtaken by the apply. It is left
standing here only because correcting it is outside this change; flag it.
DONE
