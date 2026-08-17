#!/bin/sh
# Law 3 harness for Bundle 38: break each guard, prove the suite goes RED,
# restore. A test written against already-fixed code has never been observed to
# fail, so its passing carries no information until this has run.
#
# Each mutation is a single surgical edit to the REAL source. Exit code is the
# verdict — not the banner (II.5).
#
# Run: sh test/mutate-bundle-38.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/cos-daily-brief.test.mjs"
PASSED=0
MISSED=0

# Checksums of every file this script mutates, so the restore can be PROVEN
# rather than assumed.
mksums() {
  out=$(mktemp)
  shasum -a 256 \
    src/jobs/cosDailyBrief.js src/jobs/scheduler.js \
    src/services/cos/client.js src/services/cos/compose.js \
    src/services/cos/ledger.js src/services/cos/renderer.js \
    src/services/cos/resendTransport.js > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)

mutate() {
  desc="$1"; file="$2"; from="$3"; to="$4"
  cp "$file" "$file.bak"
  # Use perl for literal-string replacement without regex surprises.
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

echo "=== Bundle 38 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suite must be green, or every result below is noise.
bun "$SUITE" >/dev/null 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; exit 1; fi
echo "  baseline: GREEN (exit 0)"
echo ""

echo "-- guard 1: the DISARMED gate --"
mutate "job ignores disarmed and runs anyway" \
  src/jobs/cosDailyBrief.js \
  'if (!mode.armed) return { ran: false, reason: '"'"'disarmed'"'"', sent: false, written: false };' \
  'if (false) return { ran: false, reason: 0, sent: false, written: false };'
mutate "cosEnv reports armed with no credentials" \
  src/services/cos/client.js \
  'const armed = Boolean(url && key);' \
  'const armed = true;'

echo ""
echo "-- guard 2: citation validation --"
mutate "unknown record ids are accepted" \
  src/services/cos/compose.js \
  "return { ok: false, category: 'invalid_citations', detail: 'cites an unknown record id' };" \
  "void 0;"
mutate "a record cited as the wrong type is accepted" \
  src/services/cos/compose.js \
  "return { ok: false, category: 'invalid_citations', detail: 'cites a record as the wrong type' };" \
  "void 0;"
mutate "a priority citing nothing is accepted" \
  src/services/cos/compose.js \
  'if (p.source_refs.length === 0) return fail(`priority ${index} cites nothing`);' \
  'if (false) return fail(0);'
mutate "email ids are dropped from the citable set" \
  src/services/cos/compose.js \
  "for (const m of input.email_messages) map.set(m.id, 'email_message');" \
  ""

echo ""
echo "-- guard 3: the send ledger --"
mutate "an already-sent day is sent again" \
  src/services/cos/ledger.js \
  "if (existing && existing.status === 'sent') {" \
  "if (false) {"
mutate "a 23505 collision is treated as a successful claim" \
  src/services/cos/ledger.js \
  "if (error.code === '23505') {" \
  "if (false) {"
mutate "a stuck in-flight claim is sent over" \
  src/services/cos/ledger.js \
  "if (existing && existing.status === 'claimed') {" \
  "if (false) {"
mutate "an unreadable ledger fails OPEN instead of closed" \
  src/services/cos/ledger.js \
  "return { claimed: false, reason: 'ledger_unreadable', key };
    }
    existing = data ? data.value : null;" \
  "return { claimed: true, key };
    }
    existing = data ? data.value : null;"

echo ""
echo "-- guard 4: the budget kill switch --"
mutate "outbound jobs ignore the budget gate" \
  src/jobs/scheduler.js \
  'if (outbound && !(await gate(name))) return;' \
  'if (false) return;'
mutate "cos-daily-brief is registered as NOT outbound" \
  src/jobs/scheduler.js \
  "{ name: 'cos-daily-brief',      spec: '0 11 * * *',   fn: runCosDailyBrief,       outbound: true }," \
  "{ name: 'cos-daily-brief',      spec: '0 11 * * *',   fn: runCosDailyBrief,       outbound: false },"

echo ""
echo "-- guard 5: the contract bounds --"
mutate "the three-priority ceiling is lifted" \
  src/services/cos/compose.js \
  "if (b.top_priorities.length > LIMITS.max_priorities) return fail('too many priorities');" \
  "void 0;"
mutate "the urgency enum is not enforced" \
  src/services/cos/compose.js \
  'if (!URGENCIES.includes(String(p.urgency))) return fail(`priority ${index} urgency`);' \
  'if (false) return fail(0);'
mutate "confidence is allowed outside 0..1" \
  src/services/cos/compose.js \
  "if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {" \
  "if (false) {"
mutate "schema_version is not checked" \
  src/services/cos/compose.js \
  "if (b.schema_version !== BRIEF_SCHEMA_VERSION) return fail('unknown schema_version');" \
  "void 0;"
mutate "the model may soften the disclaimer" \
  src/services/cos/compose.js \
  'model_disclaimer: MODEL_DISCLAIMER,' \
  'model_disclaimer: b.model_disclaimer,'

echo ""
echo "-- guard 6: input bounding --"
mutate "excerpts are no longer truncated" \
  src/services/cos/compose.js \
  'return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;' \
  'return trimmed;'
mutate "the 24k total budget is not enforced" \
  src/services/cos/compose.js \
  "while (JSON.stringify(out).length > LIMITS.total_input_chars && out[key].length > 0) {" \
  "while (false) {"
mutate "trimming starts with email instead of captures" \
  src/services/cos/compose.js \
  "const order = ['captures', 'agent_runs', 'decisions', 'email_ai_analyses', 'email_messages', 'open_loops'];" \
  "const order = ['email_messages', 'email_ai_analyses', 'agent_runs', 'decisions', 'captures', 'open_loops'];"

echo ""
echo "-- guard 7: the Resend triple gate --"
mutate "the live flag is not required to construct" \
  src/services/cos/resendTransport.js \
  'if (!live) missing.push('"'"'COS_BRIEF_LIVE=true'"'"');' \
  ''
mutate "a missing recipient is tolerated" \
  src/services/cos/resendTransport.js \
  'if (!to) missing.push('"'"'COS_BRIEF_TO'"'"');' \
  ''
mutate "send() does not re-check the live flag" \
  src/services/cos/resendTransport.js \
  "if (this.env.COS_BRIEF_LIVE !== 'true') {
      throw new Error('ResendTransport.send refused: COS_BRIEF_LIVE is not true.');
    }" \
  ""
mutate "the From address moves to the unverified root domain" \
  src/services/cos/resendTransport.js \
  "export const DEFAULT_FROM = 'Cedrus <brief@updates.cedrus.life>';" \
  "export const DEFAULT_FROM = 'Cedrus <brief@cedrus.life>';"

echo ""
echo "-- guard 8: the structural read-only surface --"
mutate "a second write verb is exported" \
  src/services/cos/client.js \
  'export async function cosInsertTodayBrief(row, { env = process.env } = {}) {' \
  'export async function cosUpdateAnything() { return null; }
export async function cosInsertTodayBrief(row, { env = process.env } = {}) {'
mutate "the readable-table allowlist is not enforced" \
  src/services/cos/client.js \
  'if (!READABLE_TABLES.includes(table)) {' \
  'if (false) {'

echo ""
echo "-- guard 9: the dry-run switch --"
mutate "dry run sends anyway" \
  src/jobs/cosDailyBrief.js \
  "  if (dryRun) {" \
  "  if (false) {"
mutate "the job reads BRIEF_DRY_RUN instead of its own flag" \
  src/jobs/cosDailyBrief.js \
  "return env.COS_BRIEF_DRY_RUN === 'true';" \
  "return env.BRIEF_DRY_RUN === 'true';"

echo ""
echo "-- guard 10: renderer safety --"
mutate "model output is no longer HTML-escaped" \
  src/services/cos/renderer.js \
  "return String(value ?? '').replace(/[&<>\"']/g, (c) => ESC[c]);" \
  "return String(value ?? '');"
mutate "the confidence caveat is dropped from the email" \
  src/services/cos/renderer.js \
  'Confidence ${esc(Math.round((p.confidence || 0) * 100))}% — how well your records support this, not how sure the model sounds.' \
  'Confidence ${esc(Math.round((p.confidence || 0) * 100))}%.'

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

# Restore check. NOT `git diff` — this branch legitimately carries uncommitted
# work, so a dirty tree proves nothing either way. Compare against the checksum
# snapshot taken before the first mutation: that is the only control that
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
echo "Every mutated guard turned the suite RED, and the tree is back to where it started."
