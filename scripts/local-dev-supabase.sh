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
# WHAT THIS IS *NOT* FOR
# It does NOT help apply a migration to production. `supabase migration up
# --linked` connects to the remote Postgres and authenticates with the DATABASE
# PASSWORD; Docker is not in that path. Use scripts/apply-multiuser-migration.sh
# for production.
#
# ⚠ THE ONE COMMAND NEVER TO RUN WITH --linked
# `supabase db reset` DROPS AND REBUILDS the database. Locally that is the point.
# Against the linked project it would drop PRODUCTION — which is named
# "cedrus-dev", the trap recorded in CEDRUS_MASTER_CONTEXT.md §7. This script
# only ever resets the local stack, and no line here passes --linked.
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
echo "== applying every local migration to the LOCAL database =="
# Local only. There is no --linked here and there must never be one.
$SB db reset

cat <<'DONE'

Local stack is up. Studio is at the URL printed above (usually
http://127.0.0.1:54323). The API URL, anon key and service-role key printed by
`supabase start` are LOCAL ONLY — they are the same for every developer and are
not secrets.

Useful from here:
  npx --yes supabase@2.114.0 status      # URLs and keys again
  npx --yes supabase@2.114.0 db reset    # rebuild local from migrations
  npx --yes supabase@2.114.0 stop        # shut the stack down

The multi-user migration will have applied as part of db reset, including its
self-proof block — if the stack came up, the assertions and both controls
passed against a real Supabase, not a stub.
DONE
