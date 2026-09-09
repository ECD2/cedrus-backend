#!/bin/sh
# Law 3 harness for Bundle 42: break each guard, prove the suite goes RED FOR
# THE RIGHT REASON, restore. A test written against already-correct code has
# never once been observed to fail, so its passing carries no information until
# this has run.
#
# THE FIRST MUTATION IS THE POINT OF THE WHOLE SESSION. It rebuilds
# provisionUser() as the JavaScript sequence the design call rejected: the rpc
# creates the account WITHOUT capabilities, and a second PostgREST insert grants
# them afterwards. That is two transactions. With the closed vocabulary
# rejecting 'run_agent' in the second one, the first has already committed —
# and Bundle 42's "no partial account survives" assertion must go RED. That is
# the proof that the assertion sees a real partial, which is what makes its
# passing against the one-transaction shape mean anything.
#
# Every mutation names the assertion (or the migration control) expected to
# catch it. A suite that goes red for an unrelated reason — a syntax error, a
# fixture crash — is reported as RED FOR THE WRONG REASON and counts as missed:
# an exit code alone cannot tell a live guard from a broken harness.
#
# Run: sh test/mutate-bundle-42.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/provision-user.test.mjs"
PASSED=0
MISSED=0

# Every file this script mutates. The restore trap iterates this list, so a file
# added to a mutate() call below must be added here too or an interrupted run
# will leave it broken.
MUTATED_FILES="src/services/provisioning.js supabase/migrations/20260909120000_provision_user.sql supabase/migrations/20260909210000_normalize_account.sql"

# Checksum of every mutated file, so the restore is PROVEN rather than assumed.
mksums() {
  out=$(mktemp)
  # shellcheck disable=SC2086
  shasum -a 256 $MUTATED_FILES > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)
OUT=$(mktemp)

restore() {
  __st=$?
  for f in $MUTATED_FILES; do
    if [ -f "$f.bak" ]; then
      mv -f "$f.bak" "$f"
      echo "  restored $f from an interrupted mutation"
    fi
  done
  [ -n "${SNAPSHOT:-}" ] && rm -f "$SNAPSHOT"
  [ -n "${OUT:-}" ] && rm -f "$OUT"
  exit $__st
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# mutate <desc> <file> <from> <to> <expected-marker-regex>
# RED only counts when the suite exits non-zero AND its output matches the
# marker — the named assertion, or the migration's own control message.
mutate() {
  desc="$1"; file="$2"; from="$3"; to="$4"; marker="$5"
  cp "$file" "$file.bak"
  FROM="$from" TO="$to" perl -0777 -pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $_ =~ s/\Q$f\E/$t/;' "$file"
  if cmp -s "$file" "$file.bak"; then
    echo "  ERROR   $desc -- mutation did not apply (pattern not found)"
    MISSED=$((MISSED+1)); mv "$file.bak" "$file"; return
  fi
  bun "$SUITE" > "$OUT" 2>&1
  code=$?
  mv "$file.bak" "$file"
  if [ "$code" -ne 0 ] && grep -Eq -- "$marker" "$OUT"; then
    echo "  RED     $desc  (exit $code; caught by: $(grep -Eo -- "$marker" "$OUT" | head -1))"
    PASSED=$((PASSED+1))
  elif [ "$code" -ne 0 ]; then
    echo "  WRONG   $desc  -- suite went red (exit $code) but NOT on the expected guard; first FAIL:"
    grep -m1 'FAIL' "$OUT" | sed 's/^/          /'
    MISSED=$((MISSED+1))
  else
    echo "  MISSED  $desc  -- suite stayed GREEN with the guard broken"
    MISSED=$((MISSED+1))
  fi
}

echo "=== Bundle 42 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suite must be green, or every result below is noise.
bun "$SUITE" > "$OUT" 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; cat "$OUT" | tail -20; exit 1; fi
echo "  baseline: GREEN (exit 0, $(grep -c '  PASS' "$OUT") checks)"
echo ""

echo "-- guard 1: the five writes are ONE transaction, not a JavaScript sequence --"
# THE named mutation. provisionUser() becomes: rpc without capabilities (commits
# the account, identity, settings and audit row), then a separate insert for
# the capabilities. 'run_agent' fails the second write; the first is already
# durable. The partial-account assertion must see it.
mutate "capabilities commit separately (rpc without them, then a second insert)" \
  src/services/provisioning.js \
  "  const { data, error } = await db.rpc(PROVISION_RPC, args);" \
  "  const { data, error } = await db.rpc(PROVISION_RPC, { ...args, p_capabilities: [] });
  if (!error && data && args.p_capabilities.length) {
    const { error: capErr } = await db.from('user_capabilities').insert(args.p_capabilities.map((c) => ({
      user_id: data.user_id, capability: c, granted: true, granted_by: args.p_actor_user_id, granted_at: new Date().toISOString(),
    })));
    if (capErr) { const e = new Error(capErr.message); e.code = capErr.code; throw e; }
  }" \
  "FAIL  fault at the capability step \(closed vocabulary\): no partial account survives"

# GUARDS 2–6 mutate the P1.2 FILE (20260909120000). Since P1.3, that file's
# provision_user is REDEFINED by 20260909210000_normalize_account.sql, so the
# function the suite exercises is the later one. These five guards therefore
# prove that the P1.2 file's OWN self-proof is still live (it still runs on
# apply, and a corrupted file still refuses to commit), not that the live
# function has the property. The live function's admin check, DEFINER,
# search_path pin and grants are proven by test/mutate-bundle-44.sh.
echo ""
echo "-- guard 2: the actor must be an ACTIVE admin (P1.2 file's own control) --"
# Caught by the MIGRATION's own CONTROL 3 before the suite's assertions run:
# the migration refuses to apply a function that lets a member provision.
mutate "the admin check is removed from the function" \
  supabase/migrations/20260909120000_provision_user.sql \
  "  if not found or v_actor_role is distinct from 'admin' or v_actor_status is distinct from 'active' then" \
  "  if false then" \
  "CONTROL 3: a MEMBER was allowed to provision an account"

echo ""
echo "-- guard 3: exactly ONE audit entry --"
# The function's own post-condition is replaced by a second INSERT. The
# migration's CONTROL 1 counts the audit rows for the control account and
# refuses to commit a function that writes two.
mutate "the audit row is written twice" \
  supabase/migrations/20260909120000_provision_user.sql \
  "  if n <> 1 then raise exception 'provision_user ASSERT: % audit rows for the new user, expected exactly 1', n; end if;" \
  "  insert into admin_audit (actor_user_id, action, target_user_id, detail) values (p_actor_user_id, 'provision_user', v_user_id, '{}'::jsonb);" \
  "CONTROL 1: the successful path did not create all five"

echo ""
echo "-- guard 4: SECURITY DEFINER --"
mutate "the function is no longer SECURITY DEFINER" \
  supabase/migrations/20260909120000_provision_user.sql \
  "volatile
security definer
set search_path = public, pg_temp
as \$fn\$" \
  "volatile
set search_path = public, pg_temp
as \$fn\$" \
  "ASSERT: provision_user is not SECURITY DEFINER"

echo ""
echo "-- guard 5: the pinned search_path --"
mutate "the search_path pin is dropped (the DEFINER escalation hole)" \
  supabase/migrations/20260909120000_provision_user.sql \
  "security definer
set search_path = public, pg_temp
as \$fn\$" \
  "security definer
as \$fn\$" \
  "ASSERT: provision_user search_path is not pinned"

echo ""
echo "-- guard 6: unreachable from the publishable key --"
mutate "execute is granted to authenticated" \
  supabase/migrations/20260909120000_provision_user.sql \
  "grant  execute on function provision_user(uuid, text, text, text[], text) to service_role;" \
  "grant  execute on function provision_user(uuid, text, text, text[], text) to service_role, authenticated;" \
  "ASSERT: authenticated can execute provision_user"

echo ""
echo "-- guard 7: the caller never swallows the database's answer (Lesson 1) --"
# With the error branch dead, a rejected call falls through to 'no user_id'
# and the SQLSTATE is lost. The fault tests assert on the SQLSTATE.
mutate "provisionUser ignores the rpc error" \
  src/services/provisioning.js \
  "  if (error) {
    // Lesson 1" \
  "  if (false) {
    // Lesson 1" \
  "FAIL  fault at the capability step \(closed vocabulary\): the call is rejected with 23514"

echo ""
echo "-- guard 8: the closed vocabulary is the constraint's, not a copy in the function --"
# Re-encoding the list in the function would let the two drift. The pin reads
# the function body from pg_proc, not the file, so a comment cannot fool it.
# Since P1.3 the LIVE body is the one in 20260909210000, so that is the file
# mutated here; its own ASSERT 3 catches it first, and the suite's pin would
# catch it if that assert were gone.
mutate "the LIVE function grows its own copy of the vocabulary" \
  supabase/migrations/20260909210000_normalize_account.sql \
  "  v_shape := normalize_account(p_actor_user_id, v_user_id, v_caps);" \
  "  if not (v_caps <@ array['run_agents','write_workspace','receive_brief','receive_sms']) then raise exception 'bad capability' using errcode = 'check_violation'; end if;
  v_shape := normalize_account(p_actor_user_id, v_user_id, v_caps);" \
  "ASSERT: a function body carries a copy of the capability vocabulary|FAIL  the function body contains no copy of the capability vocabulary"

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

# Restore check against the pre-run checksum snapshot — the only control that
# distinguishes "restored correctly" from "restored to something else".
if diff -q "$SNAPSHOT" "$(mksums)" >/dev/null 2>&1; then
  echo "restore: every mutated file is byte-identical to its pre-run checksum"
else
  echo "restore: FILES DIFFER FROM PRE-RUN SNAPSHOT"
  diff "$SNAPSHOT" "$(mksums)"
  exit 1
fi
echo "Every mutated guard turned the suite RED on the named assertion, and the tree is back to where it started."
