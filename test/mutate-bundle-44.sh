#!/bin/sh
# Law 3 harness for Bundle 44: break each guard, prove the suite goes RED FOR
# THE RIGHT REASON, restore. A test written against already-correct code has
# never once been observed to fail, so its passing carries no information
# until this has run.
#
# THE TWO MUTATIONS THE SESSION PROMPT NAMED, and why each comes in layers:
#
#   • "make normalize_account skip the settings insert; the diff test goes red."
#     Skipping the insert is caught in layers, and each layer is shown
#     separately because each is a different guard: (1a) the function's own
#     post-condition; (1b) with that post-condition gone, the migration's own
#     diff control — its GUARD that a fresh account HAS a settings row with
#     the defaults, which is what stops "both sides empty" from reading as
#     "both sides equal". Beneath those, bind_cos_identity's own P0002 refusal
#     in CONTROL 4 catches it a third time (seen 2026-09-09 while writing this
#     harness). The migration cannot be talked past to reach the suite for this
#     one; the suite's diff is shown live by 3c instead.
#
#   • "let provision_user keep its own inline tail instead of calling
#     normalize_account; show the two paths CAN now diverge." An inline tail
#     WITH a deliberate difference (timezone America/Chicago — a column the
#     migration's absolute guard does not pin, so the DIFF is what has to see
#     it) is caught by (3a) the one-code-path assert, (3b) with that silenced,
#     the migration's diff ("a backfilled account differs from a fresh one"),
#     and (3c) with that silenced too, the SUITE's diff. A difference in a
#     pinned column (brief_hour_utc 12) is caught earlier, by the guard, and
#     never reaches the diff — which is what the guard is for. An inline tail
#     that is IDENTICAL (4a/4b) is invisible to every diff — the shapes match
#     today — and is caught only by the structural pin, which is why the pin
#     exists alongside the diff.
#
# Every mutation names the assertion (or the migration control) expected to
# catch it. A suite that goes red for an unrelated reason is reported as
# WRONG and counts as missed: an exit code alone cannot tell a live guard
# from a broken harness.
#
# Run: sh test/mutate-bundle-44.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/normalize-account.test.mjs"
MIG="supabase/migrations/20260909210000_normalize_account.sql"
SCRIPT="scripts/backfill-accounts-via-api.py"
PASSED=0
MISSED=0

# Every file this script mutates. The restore trap iterates this list.
MUTATED_FILES="$MIG $SCRIPT"

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

# mutate <desc> <file> <expected-marker-regex> <from1> <to1> [<from2> <to2> ...]
# Applies EVERY from/to pair to the one file (each replaces ALL occurrences —
# patterns below are written to be unique), runs the suite, restores. RED
# counts only when the suite exits non-zero AND its output matches the marker.
# A pair that does not apply is an ERROR: a mutation that did not happen
# proves nothing.
mutate() {
  desc="$1"; file="$2"; marker="$3"; shift 3
  cp "$file" "$file.bak"
  while [ $# -ge 2 ]; do
    from="$1"; to="$2"; shift 2
    before=$(shasum -a 256 "$file")
    FROM="$from" TO="$to" perl -0777 -pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $_ =~ s/\Q$f\E/$t/g;' "$file"
    if [ "$before" = "$(shasum -a 256 "$file")" ]; then
      echo "  ERROR   $desc -- a replacement did not apply (pattern not found): $(printf '%s' "$from" | head -c 70)"
      MISSED=$((MISSED+1)); mv "$file.bak" "$file"; return
    fi
  done
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

# Reusable silencers: a migration raise becomes a notice, so the next layer
# of guard gets its turn. Each names ONE message, so nothing else is touched.
SILENCE_ASSERT3_CALLS="raise exception 'ASSERT: provision_user does not call normalize_account"
SILENCED_ASSERT3_CALLS="raise notice 'ASSERT: provision_user does not call normalize_account"
SILENCE_ASSERT3_WRITES="raise exception 'ASSERT: provision_user writes user_settings or user_capabilities itself"
SILENCED_ASSERT3_WRITES="raise notice 'ASSERT: provision_user writes user_settings or user_capabilities itself"
SILENCE_C1_DIFF="raise exception 'CONTROL 1: a backfilled account differs from a fresh one"
SILENCED_C1_DIFF="raise notice 'CONTROL 1: a backfilled account differs from a fresh one"
SILENCE_C2_DIFF0="raise exception 'CONTROL 2: an account normalised to the empty set differs"
SILENCED_C2_DIFF0="raise notice 'CONTROL 2: an account normalised to the empty set differs"

SETTINGS_INSERT="  insert into user_settings (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  v_settings_created := found;"
SETTINGS_SKIPPED="  v_settings_created := true;"
SETTINGS_POST="  if n <> 1 then raise exception 'normalize_account ASSERT: % settings rows for user %, expected exactly 1', n, p_user_id; end if;"
SETTINGS_POST_GONE="  -- post-condition removed by mutation"

CALL_LINE="  v_shape := normalize_account(p_actor_user_id, v_user_id, v_caps);"
INLINE_DIFFERENT="  insert into user_settings (user_id, timezone) values (v_user_id, 'America/Chicago');
  insert into user_capabilities (user_id, capability, granted, granted_by, granted_at) select v_user_id, c, true, p_actor_user_id, now() from unnest(v_caps) as c;
  insert into admin_audit (actor_user_id, action, target_user_id, detail) values (p_actor_user_id, 'normalize_account', v_user_id, jsonb_build_object('capabilities', to_jsonb(v_caps)));
  v_shape := jsonb_build_object('settings_created', true, 'capabilities', to_jsonb(v_caps));"
INLINE_IDENTICAL="  insert into user_settings (user_id) values (v_user_id);
  insert into user_capabilities (user_id, capability, granted, granted_by, granted_at) select v_user_id, c, true, p_actor_user_id, now() from unnest(v_caps) as c;
  insert into admin_audit (actor_user_id, action, target_user_id, detail) values (p_actor_user_id, 'normalize_account', v_user_id, jsonb_build_object('capabilities', to_jsonb(v_caps), 'settings_created', true, 'revoked', '[]'::jsonb));
  v_shape := jsonb_build_object('settings_created', true, 'capabilities', to_jsonb(v_caps));"

echo "=== Bundle 44 mutation run (Law 3) ==="
echo ""

bun "$SUITE" > "$OUT" 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; tail -20 "$OUT"; exit 1; fi
echo "  baseline: GREEN (exit 0, $(grep -c '^  PASS' "$OUT") checks)"
echo ""

echo "-- guard 1: normalize_account creates the settings row (the named mutation, two layers) --"
mutate "1a normalize_account skips the settings insert" "$MIG" \
  "normalize_account ASSERT: 0 settings rows for user" \
  "$SETTINGS_INSERT" "$SETTINGS_SKIPPED"
mutate "1b …and its own post-condition is gone: the migration's DIFF GUARD (a fresh account must HAVE settings) catches it" "$MIG" \
  "CONTROL 1: a fresh account lacks the expected shape" \
  "$SETTINGS_INSERT" "$SETTINGS_SKIPPED" \
  "$SETTINGS_POST" "$SETTINGS_POST_GONE"

echo ""
echo "-- guard 2: ONE code path — provision_user's inline tail can diverge (the named mutation, three layers) --"
mutate "3a provision_user keeps an inline tail with a DIFFERENCE (timezone) instead of calling normalize_account" "$MIG" \
  "ASSERT: provision_user does not call normalize_account" \
  "$CALL_LINE" "$INLINE_DIFFERENT"
mutate "3b …and the one-code-path assert is silenced: the migration's DIFF sees the two paths diverge" "$MIG" \
  "CONTROL 1: a backfilled account differs from a fresh one" \
  "$CALL_LINE" "$INLINE_DIFFERENT" \
  "$SILENCE_ASSERT3_CALLS" "$SILENCED_ASSERT3_CALLS" \
  "$SILENCE_ASSERT3_WRITES" "$SILENCED_ASSERT3_WRITES"
mutate "3c …and the migration's diff is silenced too: the SUITE's diff sees it (Emil vs fresh NON-EMPTY)" "$MIG" \
  "FAIL  backfill diff: Emil's shape" \
  "$CALL_LINE" "$INLINE_DIFFERENT" \
  "$SILENCE_ASSERT3_CALLS" "$SILENCED_ASSERT3_CALLS" \
  "$SILENCE_ASSERT3_WRITES" "$SILENCED_ASSERT3_WRITES" \
  "$SILENCE_C1_DIFF" "$SILENCED_C1_DIFF" \
  "$SILENCE_C2_DIFF0" "$SILENCED_C2_DIFF0"
mutate "4a provision_user keeps an inline tail that is IDENTICAL (no divergence yet): the one-code-path assert refuses it anyway" "$MIG" \
  "ASSERT: provision_user does not call normalize_account" \
  "$CALL_LINE" "$INLINE_IDENTICAL"
mutate "4b …and the assert is silenced: NO diff can see an identical copy — only the suite's structural pin can" "$MIG" \
  "FAIL  ONE CODE PATH: provision_user's live body calls normalize_account" \
  "$CALL_LINE" "$INLINE_IDENTICAL" \
  "$SILENCE_ASSERT3_CALLS" "$SILENCED_ASSERT3_CALLS" \
  "$SILENCE_ASSERT3_WRITES" "$SILENCED_ASSERT3_WRITES"

echo ""
echo "-- guard 3: idempotency --"
mutate "5 the settings insert is unconditional (a second call would insert again)" "$MIG" \
  "duplicate key value violates unique constraint|user_settings_pkey" \
  "  insert into user_settings (user_id) values (p_user_id)
  on conflict (user_id) do nothing;" \
  "  insert into user_settings (user_id) values (p_user_id);"
mutate "6a normalize_account writes its audit row twice" "$MIG" \
  "normalize_account ASSERT: audit rows went" \
  "            'revoked',          to_jsonb(v_revoked)))
  returning id into v_audit_id;" \
  "            'revoked',          to_jsonb(v_revoked)))
  returning id into v_audit_id;
  insert into admin_audit (actor_user_id, action, target_user_id) values (p_actor_user_id, 'normalize_account', p_user_id);"
mutate "6b …and its own audit post-condition is gone: the migration's CONTROL 1 counts two normalize rows on a fresh account" "$MIG" \
  "CONTROL 1: a fresh account should carry exactly one provision_user and one normalize_account audit row, found 1 and 2|CONTROL 2: a second normalize added 2 audit rows" \
  "            'revoked',          to_jsonb(v_revoked)))
  returning id into v_audit_id;" \
  "            'revoked',          to_jsonb(v_revoked)))
  returning id into v_audit_id;
  insert into admin_audit (actor_user_id, action, target_user_id) values (p_actor_user_id, 'normalize_account', p_user_id);" \
  "  if aud_after <> aud_before + 1 then
    raise exception 'normalize_account ASSERT: audit rows went % -> %, expected exactly one more', aud_before, aud_after;
  end if;" \
  "  -- audit post-condition removed by mutation"

echo ""
echo "-- guard 4: the EXACT set — the empty set revokes --"
mutate "7 the revocation is removed (an empty set would leave grants in place)" "$MIG" \
  "normalize_account ASSERT: 2 capabilities granted, 0 requested|normalize_account ASSERT: a capability outside the requested set is still granted" \
  "  update user_capabilities
     set granted = false, granted_by = p_actor_user_id, granted_at = now()
   where user_id = p_user_id and granted and not (capability = any (v_caps));" \
  "  -- revocation removed by mutation"

echo ""
echo "-- guards 5–8: the live function's own posture (admin check, DEFINER, search_path, grants) --"
mutate "8 the admin check is removed from normalize_account" "$MIG" \
  "CONTROL 3: a MEMBER was allowed to normalize an account" \
  "  if not found or v_actor_role is distinct from 'admin' or v_actor_status is distinct from 'active' then
    raise exception 'normalize_account refused: actor" \
  "  if false then
    raise exception 'normalize_account refused: actor"
mutate "9 normalize_account is no longer SECURITY DEFINER" "$MIG" \
  "ASSERT: normalize_account is not SECURITY DEFINER" \
  "volatile
security definer
set search_path = public, pg_temp
as \$fn\$
declare
  v_actor_role       text;" \
  "volatile
set search_path = public, pg_temp
as \$fn\$
declare
  v_actor_role       text;"
mutate "10 bind_cos_identity's search_path pin is dropped (the DEFINER escalation hole)" "$MIG" \
  "ASSERT: bind_cos_identity search_path is not pinned" \
  "security definer
set search_path = public, pg_temp
as \$fn\$
declare
  v_actor_role   text;
  v_actor_status text;
  v_prev_cos" \
  "security definer
as \$fn\$
declare
  v_actor_role   text;
  v_actor_status text;
  v_prev_cos"
mutate "11 execute on bind_cos_identity is granted to authenticated" "$MIG" \
  "ASSERT: authenticated can execute bind_cos_identity" \
  "grant  execute on function bind_cos_identity(uuid, uuid, uuid, uuid) to service_role;" \
  "grant  execute on function bind_cos_identity(uuid, uuid, uuid, uuid) to service_role, authenticated;"

echo ""
echo "-- guards 9–10: bind_cos_identity's refusals --"
mutate "12 the one-CoS-person-one-account check is removed" "$MIG" \
  "CONTROL 4: a CoS id already bound to another account was accepted" \
  "  if found then
    raise exception 'bind_cos_identity refused: cos_user_id % is already bound" \
  "  if false then
    raise exception 'bind_cos_identity refused: cos_user_id % is already bound"
mutate "13 bind_cos_identity creates the settings row itself when absent (a second author for the shape)" "$MIG" \
  "ASSERT: bind_cos_identity inserts a settings row" \
  "  if not found then
    raise exception 'bind_cos_identity refused: user % has no user_settings row" \
  "  if not found then
    insert into user_settings (user_id) values (p_user_id);
  end if;
  if false then
    raise exception 'bind_cos_identity refused: user % has no user_settings row"

echo ""
echo "-- guards 11–14: the backfill script --"
mutate "14 the dry-run gate is removed (the script writes without --commit and without a typed yes)" "$SCRIPT" \
  "FAIL  every request the dry run sent was a READ" \
  "    if not args.commit:
        print(\"\\nDRY RUN" \
  "    if False:
        print(\"\\nDRY RUN" \
  "    if input(\"\\nWrite these three calls? Type yes to continue: \").strip() != \"yes\":" \
  "    if False:"
mutate "15 the script reads COS_USER_ID from the environment instead of the argument (the trap value lands on the row)" "$SCRIPT" \
  "FAIL  Emil: cos_user_id and usage_user_id are the two COMMAND-LINE values" \
  "    args = parse_args(sys.argv[1:] if argv is None else argv)" \
  "    args = parse_args(sys.argv[1:] if argv is None else argv)
    import os
    args.cos_user_id = os.environ.get(\"COS_USER_ID\", args.cos_user_id)"
mutate "16 the pre-check no longer refuses other un-shaped accounts" "$SCRIPT" \
  "FAIL  with other un-shaped accounts present, --commit STOPS before writing" \
  "    if others:
        sys.exit(\"STOP: these accounts are neither Emil nor the ghost" \
  "    if False:
        sys.exit(\"STOP: these accounts are neither Emil nor the ghost"
mutate "17 the ghost is normalised with every capability instead of the empty set: the script's OWN post-check refuses" "$SCRIPT" \
  "the ghost has .* granted, expected nothing" \
  "'{{}}'::text[]) as result;\"" \
  "array[{', '.join(repr(v) for v in vocab)}]::text[]) as result;\""

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

if diff -q "$SNAPSHOT" "$(mksums)" >/dev/null 2>&1; then
  echo "restore: every mutated file is byte-identical to its pre-run checksum"
else
  echo "restore: FILES DIFFER FROM PRE-RUN SNAPSHOT"
  diff "$SNAPSHOT" "$(mksums)"
  exit 1
fi
echo "Every mutated guard turned the suite RED on the named assertion, and the tree is back to where it started."
