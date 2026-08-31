#!/usr/bin/env bash
# Apply the multi-user foundation migration to the Cedrus production project.
#
# Run this in YOUR OWN terminal, not inside Claude Code: it prompts for the
# database password, which needs a real TTY and must not pass through any
# session's context. The password is read into a variable and never printed,
# never written to a file, and never echoed.
#
#   bash scripts/apply-multiuser-migration.sh
#
# The migration proves its own post-conditions inside the transaction. If it
# commits, then: RLS is enabled AND forced on all three tables, no policy
# exposes anon or public, the capability vocabulary rejects a typo and accepts
# a valid name, and admin_audit refuses UPDATE and DELETE. If any of those is
# false the whole migration rolls back and nothing is applied.
set -euo pipefail
cd "$(dirname "$0")/.."

SB="npx --yes supabase@2.114.0"
VERSIONS="20260711053438 20260711053439 20260713120000 20260713120001 20260716120000 20260716120001"

echo "Cedrus — multi-user foundation migration"
echo "Project: qjwbtlnwnjjuvrwblkzx  (named cedrus-dev; it IS production)"
echo
printf 'Supabase database password: '
read -rs SUPABASE_DB_PASSWORD
echo
export SUPABASE_DB_PASSWORD
[ -n "$SUPABASE_DB_PASSWORD" ] || { echo "No password entered. Nothing was done."; exit 1; }

echo
echo "== 1/4  reconciling the six file-less history entries =="
# Fail fast, deliberately. A partially repaired history is the exact state the
# repair step exists to prevent, and 'migration up' against one is the failure
# MIGRATION_PATH.md was written to avoid.
for v in $VERSIONS; do
  echo "-- repair $v"
  if ! $SB migration repair --status applied "$v"; then
    echo
    echo "REPAIR FAILED at $v — STOPPING. The migration has NOT been applied."
    echo "Nothing is half-done: repairs only rewrite the history table."
    exit 1
  fi
done

echo
echo "== 2/4  history before applying =="
$SB migration list --linked

echo
echo "Expected above: the six versions applied on BOTH sides, and"
echo "20260830120000 present locally only."
printf 'Type yes to apply, anything else to stop: '
read -r ans
[ "$ans" = "yes" ] || { echo "Stopped. Nothing applied."; exit 1; }

echo
echo "== 3/4  applying =="
$SB migration up --linked

echo
echo "== 4/4  history after =="
$SB migration list --linked

cat <<'DONE'

Applied and self-proven. Because it committed, all of the following are true:
  · the six app_users columns exist, and every existing row is (member, active)
  · RLS is enabled AND forced on user_capabilities, user_settings, admin_audit
  · no policy grants anon or public anything
  · exactly the six intended policies exist
  · the capability check rejects 'run_agent' and accepts 'run_agents'
  · admin_audit refuses UPDATE and refuses DELETE, each proven separately
  · no settings row, capability grant or user was created

Nobody is an admin yet — deliberately. Promote yourself in the SQL editor:
  select id, name, phone, role from public.app_users order by created_at;
  update public.app_users set role = 'admin' where id = '<your id>';
DONE
