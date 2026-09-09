#!/bin/sh
# Law 3 harness for Bundle 46: break each guard, prove the suites go RED,
# restore. A test written against already-fixed code has never been observed
# to fail, so its passing carries no information until this has run.
#
# Two suites are run per mutation, because the guards under test are asserted
# at two levels: test/person-settings.test.mjs (the read, the resolver and the
# spend recorder, each in isolation) and test/cos-daily-brief.test.mjs (the
# REAL job end to end, in its P1.4 section). A mutation is RED when EITHER
# suite fails. Exit code is the verdict — not the banner (II.5).
#
# Run: sh test/mutate-bundle-46.sh
set -u
cd "$(dirname "$0")/.."

SUITES="test/person-settings.test.mjs test/cos-daily-brief.test.mjs"
PASSED=0
MISSED=0

# Every file this script mutates. The restore trap iterates this list, so a
# file added to a mutate() call below must be added here too.
MUTATED_FILES="src/services/cos/personSettings.js src/services/cos/writer.js src/jobs/cosDailyBrief.js"

mksums() {
  out=$(mktemp)
  shasum -a 256 $MUTATED_FILES > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)

# The restore trap (Bundles 38/40/41 precedent, and its necessity was proven
# 2026-08-30 by reproducing the 2026-08-26 interrupted run): an interrupted
# mutation must never leave the source mutated on disk.
restore() {
  __st=$?
  for f in $MUTATED_FILES; do
    if [ -f "$f.bak" ]; then
      mv -f "$f.bak" "$f"
      echo "  restored $f from an interrupted mutation"
    fi
  done
  [ -n "${SNAPSHOT:-}" ] && rm -f "$SNAPSHOT"
  exit $__st
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_suites() {
  for su in $SUITES; do
    bun "$su" >/dev/null 2>&1 || return 1
  done
  return 0
}

mutate() {
  desc="$1"; file="$2"; from="$3"; to="$4"
  cp "$file" "$file.bak"
  # perl for literal-string replacement without regex surprises.
  FROM="$from" TO="$to" perl -0777 -pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $_ =~ s/\Q$f\E/$t/;' "$file"
  if cmp -s "$file" "$file.bak"; then
    echo "  ERROR   $desc -- mutation did not apply (pattern not found)"
    MISSED=$((MISSED+1)); mv "$file.bak" "$file"; return
  fi
  run_suites
  code=$?
  mv "$file.bak" "$file"
  if [ "$code" -ne 0 ]; then
    echo "  RED     $desc"
    PASSED=$((PASSED+1))
  else
    echo "  MISSED  $desc  -- suites stayed GREEN with the guard broken"
    MISSED=$((MISSED+1))
  fi
}

echo "=== Bundle 46 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suites must be green, or every result below is noise.
if ! run_suites; then echo "BASELINE IS RED — fix the suites before mutating."; exit 1; fi
echo "  baseline: GREEN (both suites exit 0)"
echo ""

echo "-- guard 1: no environment variable names a person (P1.4) --"
mutate "the env read is restored AHEAD of the person's row" \
  src/services/cos/writer.js \
  "  if (typeof personId === 'string' && personId.trim() !== '') {
    const fromRow = await settingsIdentity(personId.trim(), db);" \
  "  if ((env.COS_USER_ID || '').trim()) return { userId: env.COS_USER_ID.trim(), source: 'env', usageUserId: null };
  if (typeof personId === 'string' && personId.trim() !== '') {
    const fromRow = await settingsIdentity(personId.trim(), db);"
mutate "the job hands the spend recorder no usage id from the row" \
  src/jobs/cosDailyBrief.js \
  "latencyMs, usageUserId: owner.usageUserId || null });" \
  "latencyMs });"
mutate "the spend recorder reads COS_BRIEF_USAGE_USER_ID ahead of the row" \
  src/jobs/cosDailyBrief.js \
  "  let userId = typeof usageUserId === 'string' && usageUserId.trim() !== '' ? usageUserId.trim() : '';
  let source = userId ? 'settings' : '';" \
  "  let userId = (env.COS_BRIEF_USAGE_USER_ID || '').trim();
  let source = userId ? 'env' : '';"
mutate "the settings path labels itself 'env'" \
  src/services/cos/writer.js \
  "    source: 'settings',
    usageUserId: row.usage_user_id" \
  "    source: 'env',
    usageUserId: row.usage_user_id"

echo ""
echo "-- guard 2: a missing row announces itself (B2.3) --"
mutate "the resolver's settings_missing warning is silenced" \
  src/services/cos/writer.js \
  "    logger.event('cos.owner.settings_missing', {
      level: 'warn', outcome: row ? 'null_id' : 'no_row'," \
  "    void ({
      level: 'warn', outcome: row ? 'null_id' : 'no_row',"
mutate "the job's no-holders warning is silenced" \
  src/jobs/cosDailyBrief.js \
  "    logger.event('cos.owner.settings_missing', {
      level: 'warn', outcome: 'no_row'," \
  "    void ({
      level: 'warn', outcome: 'no_row',"
mutate "a read error is returned as null (unreadable collapses into missing)" \
  src/services/cos/personSettings.js \
  '  if (error) throw readError(`person ${id}`, error);' \
  '  if (error) return null;'
mutate "an unreadable holders listing is read as nobody" \
  src/jobs/cosDailyBrief.js \
  "    return { personId: null, source: 'settings_unreadable', refused: false };" \
  "    holders = [];"

echo ""
echo "-- guard 3: never one person's id for another (A9) --"
mutate "a process-global cached id is reintroduced on the settings path" \
  src/services/cos/writer.js \
  "  return {
    userId: String(row.cos_user_id),
    source: 'settings',
    usageUserId: row.usage_user_id ? String(row.usage_user_id) : null,
  };
}" \
  "  if (!globalThis.__cosOwnerMemo) globalThis.__cosOwnerMemo = { userId: String(row.cos_user_id), source: 'settings', usageUserId: row.usage_user_id ? String(row.usage_user_id) : null };
  return globalThis.__cosOwnerMemo;
}"
mutate "readPersonSettings forgets its user_id filter" \
  src/services/cos/personSettings.js \
  "    .eq('user_id', id)
    .maybeSingle();" \
  "    .maybeSingle();"
mutate "the holders listing forgets its NOT NULL filter (a NULL cos_user_id counts as an identity)" \
  src/services/cos/personSettings.js \
  "    .select('user_id')
    .not('cos_user_id', 'is', null);" \
  "    .select('user_id');"
mutate "two holders: the job picks the first instead of refusing" \
  src/jobs/cosDailyBrief.js \
  "  if (holders.length === 1) return { personId: holders[0], source: 'settings', refused: false };" \
  "  if (holders.length >= 1) return { personId: holders[0], source: 'settings', refused: false };"
mutate "the job ignores a refusal and runs anyway" \
  src/jobs/cosDailyBrief.js \
  "  if (who.refused) return { ran: false, reason: who.source, sent: false, written: false };" \
  "  if (false) return { ran: false, reason: who.source, sent: false, written: false };"

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
  rm -f "$SNAPSHOT"
  exit 1
fi
rm -f "$SNAPSHOT"
echo "Every mutated guard turned a suite RED, and the tree is back to where it started."
