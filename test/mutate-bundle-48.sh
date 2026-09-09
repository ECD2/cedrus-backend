#!/bin/sh
# Law 3 harness for Bundle 48: break each guard, prove the suite goes RED FOR
# THE RIGHT REASON, restore byte-identically. A test written against
# already-correct code has never once been observed to fail, so its passing
# carries no information until this has run.
#
# THE THREE NAMED MUTATIONS from the P1.5 prompt, and what each becomes here:
#
#   A2  "remove the ownership check in one path"
#         programs: the find-by-owner loses its owner (guard 1); the composite
#         owner FK goes (guard 2); every layer goes at once and the SUITE has
#         to notice B's revision landing on A's program (guard 3)
#         CoS: the writer stops honouring the named caller, so the deployment's
#         COS_USER_ID wins and B's brief is written as A's (guard 4)
#   A5  "add an anon SELECT policy to one table; red — and name which table"
#         user_settings: the migration's own ASSERT refuses first (guard 5);
#         with that ASSERT silenced the SUITE names the table (guard 6);
#         program_items loses its anon revoke, same pair (guards 7, 8); and
#         programs is opened all the way — policy AND grant, both ASSERTs
#         silenced — so anon actually READS rows and the behavioural check,
#         not the structural one, goes red (guard 9). Two more guard the
#         enumeration itself: a new person table without RLS (guard 12) and a
#         person table the enumeration would miss (guard 13).
#   A10 "log the previous user's id in a shared line"
#         the job logs the previous run's owner on its mode line (guard 10);
#         the logger's per-run context becomes a process global, which the
#         CONCURRENT variant alone can see (guard 11)
#
# FILES THIS HARNESS EDITS TRANSIENTLY — AND RESTORES BYTE-IDENTICALLY:
#   supabase/migrations/20260830120000_multiuser_foundation.sql
#   supabase/migrations/20260909180000_programs_foundation.sql
#   src/services/cos/writer.js        (owned by another session tonight —
#   src/jobs/cosDailyBrief.js          NOT changed; mutated and restored,
#                                      checksum-verified, in this worktree only)
#   src/utils/logger.js
#
# Every mutation names the assertion (or the migration control) expected to
# catch it. A suite that goes red for an unrelated reason is reported as
# WRONG and counts as missed: an exit code alone cannot tell a live guard
# from a broken harness.
#
# Run: sh test/mutate-bundle-48.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/isolation-proofs.test.mjs"
PASSED=0
MISSED=0

FOUNDATION="supabase/migrations/20260830120000_multiuser_foundation.sql"
PROGRAMS="supabase/migrations/20260909180000_programs_foundation.sql"
WRITER="src/services/cos/writer.js"
JOB="src/jobs/cosDailyBrief.js"
LOGGER="src/utils/logger.js"
MUTATED_FILES="$FOUNDATION $PROGRAMS $WRITER $JOB $LOGGER"

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

# has_literal <file> <text> — multi-line aware, literal
has_literal() { FROM="$2" perl -0777 -ne 'exit(index($_, $ENV{FROM}) >= 0 ? 0 : 1)' "$1"; }
# apply_edit <file> <from> <to> — literal, first occurrence
apply_edit() {
  FROM="$2" TO="$3" perl -0777 -pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $_ =~ s/\Q$f\E/$t/;' "$1"
}

judge() {
  desc="$1"; marker="$2"; code="$3"
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

# mutate_n <desc> <file> <expected-marker-regex> <from1> <to1> [<from2> <to2> ...]
# One file, one or more literal edits landing together. Every edit must apply,
# or the mutation is reported as ERROR and counts as missed — a mutation that
# did not land proves nothing.
mutate_n() {
  desc="$1"; file="$2"; marker="$3"; shift 3
  cp "$file" "$file.bak"
  i=0
  while [ $# -ge 2 ]; do
    i=$((i+1))
    if ! has_literal "$file" "$1"; then
      echo "  ERROR   $desc -- edit $i did not apply (pattern not found)"
      MISSED=$((MISSED+1)); mv -f "$file.bak" "$file"; return
    fi
    apply_edit "$file" "$1" "$2"
    shift 2
  done
  if cmp -s "$file" "$file.bak"; then
    echo "  ERROR   $desc -- file unchanged after $i edit(s)"
    MISSED=$((MISSED+1)); mv -f "$file.bak" "$file"; return
  fi
  bun "$SUITE" > "$OUT" 2>&1
  code=$?
  mv -f "$file.bak" "$file"
  judge "$desc" "$marker" "$code"
}

echo "=== Bundle 48 mutation run (Law 3) ==="
echo ""

bun "$SUITE" > "$OUT" 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; tail -20 "$OUT"; exit 1; fi
echo "  baseline: GREEN (exit 0, $(grep -c '^  PASS' "$OUT") checks)"
echo ""

# ── the strings ─────────────────────────────────────────────────────────────
FIND_BY_OWNER="   where user_id = p_user_id and kind = p_kind and title = btrim(p_title);"
FIND_ANY_OWNER="   where kind = p_kind and title = btrim(p_title);"
REV_FK_BLOCK="  constraint program_revisions_id_user_id_key unique (id, user_id),
  -- Owner consistency: the revision's user_id must be its program's user_id.
  constraint program_revisions_program_owner_fkey
    foreign key (program_id, user_id) references programs (id, user_id) on delete cascade"
REV_FK_GONE="  constraint program_revisions_id_user_id_key unique (id, user_id)"
ITEMS_FK_BLOCK="  constraint program_items_program_owner_fkey
    foreign key (program_id, user_id) references programs (id, user_id) on delete cascade,"
POSTCOND_OWNER="  select count(*) into n from programs where id = v_program_id and current_revision_id = v_rev_id and user_id = p_user_id;"
POSTCOND_ANY="  select count(*) into n from programs where id = v_program_id and current_revision_id = v_rev_id;"

WRITER_NAMED="  if (typeof cosUserId === 'string' && cosUserId.trim() !== '') {"
WRITER_IGNORED="  if (false) {"

US_POLICY="create policy user_settings_select_own on user_settings
  for select to authenticated"
US_POLICY_ANON="create policy user_settings_select_own on user_settings
  for select to anon, authenticated"
F_ANON_ASSERT="  if n <> 0 then raise exception 'ASSERT: % policies expose anon/public', n; end if;"
P_POLICY="create policy programs_select_own on programs
  for select to authenticated
  using (user_id = current_app_user_id());"
P_POLICY_ANON="create policy programs_select_own on programs
  for select to anon, authenticated
  using (true);"
P_ANON_POLICY_ASSERT="  if n <> 0 then raise exception 'ASSERT: % program policies expose anon/public', n; end if;"
P_ANON_PRIV_ASSERT="  if n <> 0 then raise exception 'ASSERT: anon holds % privileges on the program tables', n; end if;"
REVOKE_ITEMS="revoke all on program_items     from anon;"
REVOKE_PROGRAMS="revoke all on programs          from anon;"
RELAXED="  if false then raise exception 'relaxed'; end if;"
SELF_PROOF_HEAD="-- ── SELF-PROOF — assertions BEFORE commit; any failure rolls it all back ─────"

JOB_MODE_LINE="  logger.event('cos.delivery.mode', { outcome: modeName, message: modeMessage });"
JOB_MODE_LEAK="  logger.event('cos.delivery.mode', { outcome: modeName, message: modeMessage + ' (previous owner: ' + (globalThis.__cedrusPrevOwner || 'none') + ')' });"
JOB_OWNER_LINE="  const userId = owner.userId;"
JOB_OWNER_REMEMBER="  const userId = owner.userId; globalThis.__cedrusPrevOwner = userId;"

LOG_GET="  try { return contextStore.getStore() || {}; } catch { return {}; }"
LOG_GET_GLOBAL="  try { return globalThis.__cedrusCtx || {}; } catch { return {}; }"
LOG_RUN="    return contextStore.run({ ...store }, fn);"
LOG_RUN_GLOBAL="    globalThis.__cedrusCtx = { ...store }; return fn();"

echo "-- A2 / programs --"
echo "-- guard 1: publish finds the program by (kind, title) with no owner — B's publish reaches A's program and the FK refuses it --"
mutate_n "find-or-create loses its owner" "$PROGRAMS" \
  "FAIL  B publishing under the same kind and title RESOLVES" \
  "$FIND_BY_OWNER" "$FIND_ANY_OWNER"

echo ""
echo "-- guard 2: the composite owner FK on program_revisions is dropped — a revision for B against A's program_id is accepted --"
mutate_n "program_revisions_program_owner_fkey removed" "$PROGRAMS" \
  "FAIL  a revision for B against A's program_id is REFUSED by the database" \
  "$REV_FK_BLOCK" "$REV_FK_GONE"

echo ""
echo "-- guard 3: EVERY layer goes — owner find, both owner FKs, the function's own owner post-condition — B's revision lands on A's program --"
mutate_n "all four ownership layers removed" "$PROGRAMS" \
  "FAIL  A's program is untouched by B's publish" \
  "$FIND_BY_OWNER" "$FIND_ANY_OWNER" \
  "$REV_FK_BLOCK" "$REV_FK_GONE" \
  "$ITEMS_FK_BLOCK" "" \
  "$POSTCOND_OWNER" "$POSTCOND_ANY"

echo ""
echo "-- A2 / CoS writeback --"
echo "-- guard 4: the writer stops honouring the named caller; the deployment's COS_USER_ID (A) names B's row --"
mutate_n "resolveCosUserId ignores the caller-named user" "$WRITER" \
  "FAIL  exactly ONE new row, and it is B's" \
  "$WRITER_NAMED" "$WRITER_IGNORED"

echo ""
echo "-- A5 --"
echo "-- guard 5: a policy on user_settings names anon — the foundation migration refuses itself --"
mutate_n "user_settings_select_own opened to anon" "$FOUNDATION" \
  "ASSERT: 1 policies expose anon/public" \
  "$US_POLICY" "$US_POLICY_ANON"

echo ""
echo "-- guard 6: …and that ASSERT silenced — the SUITE must name user_settings --"
mutate_n "user_settings opened to anon, migration assertion relaxed" "$FOUNDATION" \
  "FAIL  no policy on user_settings names anon or public" \
  "$US_POLICY" "$US_POLICY_ANON" \
  "$F_ANON_ASSERT" "$RELAXED"

echo ""
echo "-- guard 7: the anon revoke on program_items is dropped — the programs migration refuses itself --"
mutate_n "revoke all on program_items from anon removed" "$PROGRAMS" \
  "ASSERT: anon holds [0-9]+ privileges on the program tables" \
  "$REVOKE_ITEMS" "-- (revoke dropped by the mutation harness)"

echo ""
echo "-- guard 8: …and that ASSERT silenced — the SUITE must name program_items --"
mutate_n "program_items anon revoke removed, migration assertion relaxed" "$PROGRAMS" \
  "FAIL  anon holds no SELECT/INSERT/UPDATE/DELETE privilege on program_items" \
  "$REVOKE_ITEMS" "-- (revoke dropped by the mutation harness)" \
  "$P_ANON_PRIV_ASSERT" "$RELAXED"

echo ""
echo "-- guard 9: programs opened all the way — a permissive anon policy AND the anon grant, both ASSERTs silenced — anon actually READS rows --"
mutate_n "programs readable by anon: permissive policy + grant, assertions relaxed" "$PROGRAMS" \
  "FAIL  anon reads ZERO rows from programs: LEAK" \
  "$P_POLICY" "$P_POLICY_ANON" \
  "$P_ANON_POLICY_ASSERT" "$RELAXED" \
  "$REVOKE_PROGRAMS" "-- (revoke dropped by the mutation harness)" \
  "$P_ANON_PRIV_ASSERT" "$RELAXED"

echo ""
echo "-- A10 --"
echo "-- guard 10: the job logs the PREVIOUS run's owner on its mode line — A's id lands in B's trace --"
mutate_n "cos.delivery.mode names the previous owner" "$JOB" \
  "FAIL  sequential: A's identifier appears in NO line carrying B's correlation id" \
  "$JOB_MODE_LINE" "$JOB_MODE_LEAK" \
  "$JOB_OWNER_LINE" "$JOB_OWNER_REMEMBER"

echo ""
echo "-- guard 11: the logger's per-run context becomes a process global — only the CONCURRENT variant can see it --"
mutate_n "runWithContext stops isolating (global context)" "$LOGGER" \
  "FAIL  concurrent: A's identifier appears in NO line carrying B's correlation id" \
  "$LOG_GET" "$LOG_GET_GLOBAL" \
  "$LOG_RUN" "$LOG_RUN_GLOBAL"

echo ""
echo "-- A5 / enumeration --"
echo "-- guard 12: a NEW person table arrives in a migration without RLS or a revoke — anon reads it --"
mutate_n "program_notes created with a row and no protection" "$PROGRAMS" \
  "FAIL  anon reads ZERO rows from program_notes: LEAK" \
  "$SELF_PROOF_HEAD" "create table if not exists program_notes (id uuid primary key default gen_random_uuid(), user_id uuid not null);
insert into program_notes (user_id) select id from app_users limit 1;
$SELF_PROOF_HEAD"

echo ""
echo "-- guard 13: a person table the enumeration cannot see (created without 'if not exists') — the completeness check must catch it --"
mutate_n "program_notes created in a shape the enumeration does not parse" "$PROGRAMS" \
  "FAIL  the list is COMPLETE against the catalog" \
  "$SELF_PROOF_HEAD" "create table program_notes (id uuid primary key default gen_random_uuid(), user_id uuid not null);
alter table program_notes enable row level security; revoke all on program_notes from anon;
$SELF_PROOF_HEAD"

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
