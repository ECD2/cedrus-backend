#!/bin/sh
# Law 3 harness for Bundle 47: break each guard the auth API rests on, prove
# the suite goes RED, restore. A test written against already-fixed code has
# never once been observed to fail, so its passing carries no information
# until this has run.
#
# THE NAMED MUTATIONS FROM THE SESSION BRIEF are 1 (remove the aal check),
# 2 and 3 (drop the caller scoping on /workspace — two forms), and 4 (honour
# a forged id). The rest are the other guards a green Bundle 47 claims to
# stand on: signature, expiry, role, suspension, the production seam, the
# fail-closed reads, the status filter and the date check on /brief/today.
#
# Run: sh test/mutate-bundle-47.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/auth-api.test.mjs"
PASSED=0
MISSED=0

# Every file this script mutates. The restore trap iterates this list, so a
# file added to a mutate() call below must be added here too or an interrupted
# run will leave it broken.
MUTATED_FILES="src/routes/api/auth.js src/routes/api/interface.js src/services/auth/jwt.js src/services/auth/callerScope.js src/services/auth/capabilities.js"

# Checksum of every mutated file, so the restore is PROVEN rather than assumed.
# `git diff` would not do: this branch legitimately carries uncommitted work.
mksums() {
  out=$(mktemp)
  # shellcheck disable=SC2086
  shasum -a 256 $MUTATED_FILES > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)

# ── the restore trap (the 2026-08-26 incident: an interrupted un-trapped run
# left a mutated file on disk) ───────────────────────────────────────────────
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

# mutate DESC FILE FROM TO — one substitution, run the suite, restore.
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

echo "=== Bundle 47 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suite must be green, or every result below is noise.
bun "$SUITE" >/dev/null 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; exit 1; fi
echo "  baseline: GREEN (exit 0)"
echo ""

echo "-- guard 1: MFA is required — the aal check in the choke point --"
# THE named mutation. With it gone an aal1 token reaches /session.
mutate "the assurance check in createRequireUser is removed" \
  src/routes/api/auth.js \
  "      if (!assurance.ok) {" \
  "      if (false) {"

echo ""
echo "-- guard 2: /workspace scopes by the CALLER — the user filter on user_settings --"
# Drop the .eq('user_id', …): user B is handed the first settings row (A's),
# resolves A's CoS id, and receives A's workstreams.
mutate "resolveCallerScope drops the user_id filter on user_settings" \
  src/services/auth/callerScope.js \
  "    .eq('user_id', appUserId)
    .maybeSingle();" \
  "    .limit(1)
    .maybeSingle();"

echo ""
echo "-- guard 3: /workspace scopes by the CALLER — not the process singleton --"
# COS_USER_ID is SET in the suite's env (as on the production deploy). The
# handler reaching for it is the single-owner regression this codebase keeps
# fighting: everyone gets that one person's rows.
mutate "the /workspace handler prefers COS_USER_ID over the caller's scope" \
  src/routes/api/interface.js \
  "    const cosUserId = scope.cosUserId;" \
  "    const cosUserId = env.COS_USER_ID || scope.cosUserId;"

echo ""
echo "-- guard 4: identity comes from the token, never the request (A3 regression) --"
mutate "the router honours ?user_id= when resolving the caller's scope" \
  src/routes/api/interface.js \
  "    const scope = await resolveCallerScope({ appUser: req.appUser, db });" \
  "    const scope = await resolveCallerScope({ appUser: req.query && req.query.user_id ? { ...req.appUser, id: req.query.user_id } : req.appUser, db });"

echo ""
echo "-- guard 5: the signature is checked (HS256 path) --"
mutate "verifyJwt accepts any HS256 signature" \
  src/services/auth/jwt.js \
  "    if (!timingSafeBufEqual(signature, expected)) return { ok: false, reason: 'bad_signature' };" \
  "    if (false) return { ok: false, reason: 'bad_signature' };"

echo ""
echo "-- guard 6: the signature is checked (ES256/RS256 path) --"
mutate "verifyJwt accepts any asymmetric signature" \
  src/services/auth/jwt.js \
  "    if (!verified) return { ok: false, reason: 'bad_signature' };" \
  "    if (false) return { ok: false, reason: 'bad_signature' };"

echo ""
echo "-- guard 7: expiry is enforced --"
mutate "verifyJwt ignores exp" \
  src/services/auth/jwt.js \
  "  if (nowSec >= payload.exp) return { ok: false, reason: 'expired' };" \
  "  if (false) return { ok: false, reason: 'expired' };"

echo ""
echo "-- guard 8: a service_role / anon JWT is not a person --"
mutate "verifyJwt ignores the role claim" \
  src/services/auth/jwt.js \
  "  if (payload.role !== USER_ROLE) return { ok: false, reason: 'bad_role' };" \
  "  if (false) return { ok: false, reason: 'bad_role' };"

echo ""
echo "-- guard 9: a suspended account is refused (proof A6) --"
mutate "the suspended check always passes" \
  src/routes/api/auth.js \
  "  const status = appUser ? appUser.account_status : undefined;
  if (status === undefined || status === null) return true;
  return status === 'active';" \
  "  return true;"

echo ""
echo "-- guard 10: the non-JWT seam is shut in production --"
mutate "the production refusal of a non-JWT bearer is removed" \
  src/routes/api/auth.js \
  "      if (production) {" \
  "      if (false) {"

echo ""
echo "-- guard 11: a capability read that ERRORED must refuse, never read as 'all false' --"
mutate "a failed user_capabilities read is reported as four falses" \
  src/services/auth/capabilities.js \
  "  if (error) return { ok: false, error };" \
  "  if (error) return { ok: true, capabilities: Object.fromEntries(CAPABILITY_VOCABULARY.map((n) => [n, false])) };"

echo ""
echo "-- guard 12: /brief/today serves an ok row, never an error row --"
mutate "the status filter on today_briefs is dropped" \
  src/routes/api/interface.js \
  "      .eq('status', 'ok')
" \
  ""

echo ""
echo "-- guard 13: /brief/today is TODAY's brief in the person's timezone --"
mutate "the date check on the newest brief is removed" \
  src/routes/api/interface.js \
  "    if (rowDate !== date) return { available: false, date, timezone, reason: 'not_generated_today', latest_generated_at: row.generated_at };" \
  "    if (false) return { available: false, date, timezone, reason: 'not_generated_today', latest_generated_at: row.generated_at };"

echo ""
echo "-- guard 14: a failed CoS read on /workspace is a 503, never an empty 200 --"
mutate "a failed CoS read is served as available:true with empty lists" \
  src/routes/api/interface.js \
  "    if (failed.length) throw failure(503, 'workspace_unreadable', \`CoS read failed for \${failed.join(', ')}\`);" \
  "    if (failed.length) return { available: true, workstreams: [], open_loops: [], decisions: [], limits: { workstreams: 0, open_loops: 0, decisions: 0 } };"

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

# Restore check against the pre-run checksum snapshot: the only control that
# distinguishes "restored correctly" from "restored to something else".
if diff -q "$SNAPSHOT" "$(mksums)" >/dev/null 2>&1; then
  echo "restore: every mutated file is byte-identical to its pre-run checksum"
else
  echo "restore: FILES DIFFER FROM PRE-RUN SNAPSHOT"
  diff "$SNAPSHOT" "$(mksums)"
  exit 1
fi
echo "Every mutated guard turned the suite RED, and the tree is back to where it started."
