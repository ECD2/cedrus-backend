#!/bin/sh
# Law 3 harness for Bundle 43: break each guard, prove the suite goes RED FOR
# THE RIGHT REASON, restore. A test written against already-correct code has
# never once been observed to fail, so its passing carries no information
# until this has run.
#
# THE TWO NAMED MUTATIONS from the R6.2a prompt come in pairs on purpose:
#
#   drop the RLS force on one table           → the migration's own ASSERT
#                                                 refuses to commit (guard 1)
#   …and relax that ASSERT too (mutate2)      → the SUITE's owner-path
#                                                 isolation test goes red (2)
#   drop the (program_id, source_sha256) key  → the migration's CONTROL 1
#                                                 refuses to commit (guard 3)
#   …and relax that CONTROL too (mutate2)     → the SUITE's idempotency
#                                                 test goes red (guard 4)
#
# The pair matters. Alone, the first of each proves the migration defends
# itself; the second proves the suite would ALSO catch it if the migration's
# own claim were wrong — two layers, each shown live on its own.
#
# Every mutation names the assertion (or the migration control) expected to
# catch it. A suite that goes red for an unrelated reason is reported as
# WRONG and counts as missed: an exit code alone cannot tell a live guard
# from a broken harness.
#
# Run: sh test/mutate-bundle-43.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/programs-foundation.test.mjs"
PASSED=0
MISSED=0

MIG="supabase/migrations/20260909180000_programs_foundation.sql"
MUTATED_FILES="$MIG src/services/programs/compile.js src/services/programs/today.js src/jobs/cosDailyBrief.js scripts/load-program.mjs"

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

# apply_edit <file> <from> <to> — literal, first occurrence; returns 1 if absent
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

# mutate <desc> <file> <from> <to> <expected-marker-regex>
mutate() {
  desc="$1"; file="$2"; from="$3"; to="$4"; marker="$5"
  cp "$file" "$file.bak"
  apply_edit "$file" "$from" "$to"
  if cmp -s "$file" "$file.bak"; then
    echo "  ERROR   $desc -- mutation did not apply (pattern not found)"
    MISSED=$((MISSED+1)); mv "$file.bak" "$file"; return
  fi
  bun "$SUITE" > "$OUT" 2>&1
  code=$?
  mv "$file.bak" "$file"
  judge "$desc" "$marker" "$code"
}

# mutate2 <desc> <file1> <from1> <to1> <file2> <from2> <to2> <marker>
# For guards that only show when TWO edits land together — here, breaking a
# property AND silencing the migration's own assertion about it, so the
# SUITE's test is the one that has to notice.
mutate2() {
  desc="$1"; f1="$2"; from1="$3"; to1="$4"; f2="$5"; from2="$6"; to2="$7"; marker="$8"
  cp "$f1" "$f1.bak"; [ "$f1" = "$f2" ] || cp "$f2" "$f2.bak"
  apply_edit "$f1" "$from1" "$to1"
  apply_edit "$f2" "$from2" "$to2"
  if cmp -s "$f1" "$f1.bak"; then
    echo "  ERROR   $desc -- first edit did not apply"
    MISSED=$((MISSED+1)); mv "$f1.bak" "$f1"; [ "$f1" = "$f2" ] || mv "$f2.bak" "$f2"; return
  fi
  bun "$SUITE" > "$OUT" 2>&1
  code=$?
  mv "$f1.bak" "$f1"; [ "$f1" = "$f2" ] || mv "$f2.bak" "$f2"
  judge "$desc" "$marker" "$code"
}

echo "=== Bundle 43 mutation run (Law 3) ==="
echo ""

bun "$SUITE" > "$OUT" 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; tail -20 "$OUT"; exit 1; fi
echo "  baseline: GREEN (exit 0, $(grep -c '  PASS' "$OUT") checks)"
echo ""

FORCE_LINE="alter table program_items     force row level security;"
FORCE_ASSERT="  if n <> 3 then raise exception 'ASSERT: expected 3 program tables with RLS enabled AND forced, found %', n; end if;"
UNIQUE_LINE="  constraint program_revisions_program_id_source_sha256_key unique (program_id, source_sha256),"
# Silencing CONTROL 1 means making the whole block a no-op: raising its own
# unwind sentinel as its first act. Relaxing one line is not enough — the
# control checks the revision count and the supersede chain too, and each of
# those would still catch the dropped constraint before the suite runs.
CONTROL1_START="  select id into owner from app_users order by created_at limit 1;
  begin
    r1 := publish_program_revision("
CONTROL1_SILENCED="  select id into owner from app_users order by created_at limit 1;
  begin
    raise exception 'UNWIND_CONTROL_1';
    r1 := publish_program_revision("

echo "-- guard 1: RLS FORCE dropped on program_items — the migration refuses itself --"
mutate "force row level security removed from program_items" \
  "$MIG" "$FORCE_LINE" "-- (force dropped by the mutation harness)" \
  "ASSERT: expected 3 program tables with RLS enabled AND forced, found 2"

echo ""
echo "-- guard 2: RLS FORCE dropped AND the migration's assertion silenced — the SUITE's owner-path test must catch it --"
mutate2 "force dropped on program_items, assertion relaxed" \
  "$MIG" "$FORCE_LINE" "-- (force dropped by the mutation harness)" \
  "$MIG" "$FORCE_ASSERT" "  if false then raise exception 'relaxed'; end if;" \
  "FAIL  the table OWNER reads zero of A's items"

echo ""
echo "-- guard 3: the (program_id, source_sha256) uniqueness dropped — the migration refuses itself --"
mutate "UNIQUE (program_id, source_sha256) removed" \
  "$MIG" "$UNIQUE_LINE" "" \
  "CONTROL 1: the same source was published twice"

echo ""
echo "-- guard 4: uniqueness dropped AND the migration's control silenced — the SUITE's idempotency test must catch it --"
mutate2 "uniqueness removed, CONTROL 1 silenced" \
  "$MIG" "$UNIQUE_LINE" "" \
  "$MIG" "$CONTROL1_START" "$CONTROL1_SILENCED" \
  "FAIL  the SAME source again is refused with 23505"

echo ""
echo "-- guard 5: todays_program_items loses its owner filter --"
mutate "the function returns every owner's items" \
  "$MIG" "   where p.user_id = p_user_id
     and p_user_id is not null" "   where true" \
  "CONTROL 3: another account read"

echo ""
echo "-- guard 6: …and CONTROL 3 silenced — the SUITE's cross-user test must catch it --"
mutate2 "owner filter removed, CONTROL 3 relaxed" \
  "$MIG" "   where p.user_id = p_user_id
     and p_user_id is not null" "   where true" \
  "$MIG" "    if n_other <> 0 then raise exception 'CONTROL 3: another account read % of the owner''s items', n_other; end if;" "" \
  "FAIL  control: B at the same instant gets ZERO rows"

echo ""
echo "-- guard 7: actuals carry across revisions --"
mutate "publish copies completed status from the previous revision" \
  "$MIG" "  v_n_items := jsonb_array_length(p_items);" \
  "  v_n_items := jsonb_array_length(p_items);
  update program_items i set status = 'completed'
   where i.program_revision_id = v_rev_id
     and exists (select 1 from program_items o where o.program_revision_id = v_prev_rev_id and o.item_key = i.item_key and o.status = 'completed');" \
  "did not start at planned with NULL actuals"

echo ""
echo "-- guard 8: BOTH owner-consistency composite FKs removed --"
# Two FKs tie an item's user_id to its owner: through the program and through
# the revision. Removing one leaves the other to refuse the smuggled row, so
# the guard is only broken when both go.
mutate2 "program_items.user_id no longer tied to its program's or revision's owner" \
  "$MIG" "  constraint program_items_program_owner_fkey
    foreign key (program_id, user_id) references programs (id, user_id) on delete cascade," "" \
  "$MIG" "  constraint program_items_revision_owner_fkey
    foreign key (program_revision_id, user_id) references program_revisions (id, user_id) on delete cascade" "  constraint program_items_harness_placeholder check (true)" \
  "FAIL  an item cannot belong to B while its program belongs to A"

echo ""
echo "-- guard 9: a policy naming anon --"
mutate "a SELECT policy for anon is added on program_items" \
  "$MIG" "drop policy if exists program_items_select_own on program_items;" \
  "create policy program_items_anon_leak on program_items for select to anon using (true);
drop policy if exists program_items_select_own on program_items;" \
  "ASSERT: 1 program policies expose anon/public"

echo ""
echo "-- guard 10: scheduled_date becomes a timestamp --"
mutate "program_items.scheduled_date typed timestamptz" \
  "$MIG" "  scheduled_date            date not null," "  scheduled_date            timestamptz not null," \
  "ASSERT: program_items.scheduled_date is timestamp with time zone, must be date"

echo ""
echo "-- guard 11: the day count is hardcoded (the handoff's 70) --"
mutate "compile.js sets days = 70 instead of deriving it" \
  src/services/programs/compile.js "    days = daysInclusive(start_date, end_date);" "    days = 70;" \
  "FAIL  training: days is derived"

echo ""
echo "-- guard 12: the load script writes without --commit --"
mutate "the dry-run gate is removed" \
  scripts/load-program.mjs "  if (!args.commit) {" "  if (false) {" \
  "FAIL  dry run: exit 0 with NO database environment"

echo ""
echo "-- guard 13: the reader drops the owner from the rpc --"
mutate "readTodaysProgram passes p_user_id: null" \
  src/services/programs/today.js "{ p_user_id: appUserId.trim(), p_at: at.toISOString() }" "{ p_user_id: null, p_at: at.toISOString() }" \
  "FAIL  readTodaysProgram for A: ok, 3 rows"

echo ""
echo "-- guard 14: an unreadable program table no longer fails the run closed (Lesson 1) --"
mutate "the job continues past a failed program read" \
  src/jobs/cosDailyBrief.js "      return { ran: false, reason: 'program_read_failed', sent: false, written: false };" "      // swallowed" \
  "FAIL  an UNREADABLE program table fails the run closed"

echo ""
echo "-- guard 15: the block is no longer first in the email --"
mutate "the renderer's block is dropped from the text email" \
  src/jobs/cosDailyBrief.js "  const brief = { ...validation.brief, todays_program: todaysProgram };" "  const brief = { ...validation.brief, todays_program: [] };" \
  "FAIL  the job composes a brief for A with a todays_program block"

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
