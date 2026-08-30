#!/bin/sh
# Law 3 harness for Bundle 41: break each isolation guard, prove the suite goes
# RED, restore. A test written against already-fixed code has never once been
# observed to fail, so its passing carries no information until this has run.
#
# THE FIRST MUTATION IS THE POINT OF THE WHOLE SESSION. It reverts ledgerKey()
# to the day-only key that shipped before 2026-08-30 — one claim per day for
# everyone — and Bundle 41's "user B ALSO claims the SAME day" assertion must go
# RED. That is the proof that the two-user test genuinely fails against the old
# code, which is what makes its passing against the new code mean anything.
#
# Run: sh test/mutate-bundle-41.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/multiuser-isolation.test.mjs"
PASSED=0
MISSED=0

# Every file this script mutates. The restore trap iterates this list, so a file
# added to a mutate() call below must be added here too or an interrupted run
# will leave it broken.
MUTATED_FILES="src/services/cos/ledger.js src/services/cos/client.js src/routes/api/auth.js"

# Checksum of every mutated file, so the restore is PROVEN rather than assumed.
# `git diff` would not do: this branch legitimately carries uncommitted work, so
# a dirty tree proves nothing either way.
mksums() {
  out=$(mktemp)
  # shellcheck disable=SC2086
  shasum -a 256 $MUTATED_FILES > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)

# ── the restore trap ────────────────────────────────────────────────────────
# Without this, Ctrl-C between `cp file file.bak` and `mv file.bak file` leaves
# the source MUTATED and the working tree quietly wrong. That is not
# hypothetical: it happened on 2026-08-26. A harness that can corrupt the thing
# it is measuring is worse than no harness, because the damage is invisible
# until something else fails for an unrelated-looking reason.
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

mutate() {
  desc="$1"; file="$2"; from="$3"; to="$4"
  cp "$file" "$file.bak"
  FROM="$from" TO="$to" perl -0777 -pi -e 'my $f=$ENV{FROM}; my $t=$ENV{TO}; $_ =~ s/\Q$f\E/$t/;' "$file"
  if cmp -s "$file" "$file.bak"; then
    echo "  ERROR   $desc -- mutation did not apply (pattern not found)"
    MISSED=$((MISSED+1)); mv "$file.bak" "$file"; return
  fi
  bun "$SUITE" >/dev/null 2>&1
  code=$?
  mv "$file.bak" "$file"
  if [ "$code" -ne 0 ]; then
    echo "  RED     $desc  (exit $code)"
    PASSED=$((PASSED+1))
  else
    echo "  MISSED  $desc  -- suite stayed GREEN with the guard broken"
    MISSED=$((MISSED+1))
  fi
}

echo "=== Bundle 41 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suite must be green, or every result below is noise.
bun "$SUITE" >/dev/null 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; exit 1; fi
echo "  baseline: GREEN (exit 0)"
echo ""

echo "-- guard 1: the ledger key is per USER per day, not per day --"
# THE named mutation, and the one this session exists for. Reverting to the
# day-only key is exactly the pre-2026-08-30 code: user A claims the day, user B
# collides on the primary key and is refused 'already_sent' down the FAIL-CLOSED
# path, which in the logs is byte-identical to correct duplicate prevention.
mutate "the ledger key drops the user (the pre-2026-08-30 global key)" \
  src/services/cos/ledger.js \
  "  return LEDGER_KEY_PREFIX + userId.trim() + ':' + now.toISOString().slice(0, 10);" \
  "  return LEDGER_KEY_PREFIX + now.toISOString().slice(0, 10);"

echo ""
echo "-- guard 2: a claim may only be settled by the user who took it --"
mutate "assertKeyBelongsTo waves every key through" \
  src/services/cos/ledger.js \
  "  const expected = LEDGER_KEY_PREFIX + userId.trim() + ':';
  if (!String(key).startsWith(expected)) {" \
  "  const expected = LEDGER_KEY_PREFIX + userId.trim() + ':';
  if (false) {"

echo ""
echo "-- guard 3: the scoping wrapper refuses a missing user id --"
# "Passes a missing user id through" rather than "throws a different error":
# a mutation that still throws would leave the suite GREEN for the wrong reason
# and read as a guard that isn't there.
mutate "forUser passes a missing user id through instead of refusing" \
  src/services/cos/client.js \
  "  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      'forUser refused: a CoS read requires an explicit user id. ' +
      'Service role bypasses RLS, so an unscoped read returns every user\\'s rows. ' +
      \`Received: \${userId === undefined ? 'undefined' : JSON.stringify(userId)}\`);
  }
  const scope = Object.freeze({ userId: userId.trim() });" \
  "  const scope = Object.freeze({ userId: String(userId == null ? '' : userId).trim() });"

echo ""
echo "-- guard 4: a cross-user read must state a reason --"
mutate "cosSelectAcrossAllUsers stops demanding a reason" \
  src/services/cos/client.js \
  "  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error(
      'cosSelectAcrossAllUsers refused: a cross-user read must state a \`reason\`. ' +
      'If you did not mean to read across users, use forUser(userId).select().');
  }" \
  "  reason = reason || 'unstated';"

echo ""
echo "-- guard 5: a today_briefs insert must carry an owner --"
mutate "cosInsertTodayBrief accepts a row with no user_id" \
  src/services/cos/client.js \
  "  if (!row || typeof row.user_id !== 'string' || row.user_id.trim() === '') {" \
  "  if (false) {"

echo ""
echo "-- guard 6: a suspended account is refused --"
mutate "the suspended check always passes" \
  src/routes/api/auth.js \
  "  const status = appUser ? appUser.account_status : undefined;
  if (status === undefined || status === null) return true;
  return status === 'active';" \
  "  return true;"

echo ""
echo "-- guard 7: an ungranted capability is refused --"
mutate "the capability check always returns true" \
  src/routes/api/auth.js \
  "    if (!data || data.granted !== true) {" \
  "    if (false) {"

echo ""
echo "-- guard 8: a capability read that ERRORED must refuse, never assume --"
mutate "a failed capability read is treated as granted" \
  src/routes/api/auth.js \
  "    if (error) {
      logger.event('web.capability.error', {" \
  "    if (false) {
      logger.event('web.capability.error', {"

echo ""
echo "-- guard 9: identity comes from the token, never the request body --"
mutate "the request body's user_id is trusted" \
  src/routes/api/auth.js \
  "    req.appUser = appUser;      // identity for every downstream handler" \
  "    req.appUser = (req.body && req.body.user_id) ? { ...appUser, id: req.body.user_id } : appUser;"

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

# Restore check. NOT `git diff` — compare against the checksum snapshot taken
# before the first mutation: that is the only control that distinguishes
# "restored correctly" from "restored to something else".
if diff -q "$SNAPSHOT" "$(mksums)" >/dev/null 2>&1; then
  echo "restore: every mutated file is byte-identical to its pre-run checksum"
else
  echo "restore: FILES DIFFER FROM PRE-RUN SNAPSHOT"
  diff "$SNAPSHOT" "$(mksums)"
  exit 1
fi
echo "Every mutated guard turned the suite RED, and the tree is back to where it started."
