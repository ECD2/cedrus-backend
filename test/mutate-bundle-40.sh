#!/bin/sh
# Law 3 harness for Bundle 40: break each guard in scripts/verify-brief-run.mjs,
# prove the suite goes RED, restore. A test written against already-fixed code
# has never been observed to fail, so its passing carries no information until
# this has run.
#
# The two mutations the item asked for are guards 1 and 2. The rest exist
# because a verifier is a measuring instrument, and an instrument that reports
# a plausible wrong number is worse than one that reports nothing — every field
# it prints is something a human will act on without re-deriving.
#
# Run: sh test/mutate-bundle-40.sh
set -u
cd "$(dirname "$0")/.."

SUITE="test/verify-brief-run.test.mjs"
PASSED=0
MISSED=0

# Checksum of every file this script mutates, so the restore is PROVEN rather
# than assumed. `git diff` would not do: this branch legitimately carries
# uncommitted work, so a dirty tree proves nothing either way.
# Every file this script mutates. The restore trap iterates this list, so a
# file added to a mutate() call below must be added here too.
MUTATED_FILES="scripts/verify-brief-run.mjs"

mksums() {
  out=$(mktemp)
  shasum -a 256 scripts/verify-brief-run.mjs > "$out"
  echo "$out"
}
SNAPSHOT=$(mksums)

# ── the restore trap (added 2026-08-30) ─────────────────────────────────────
# Without this, Ctrl-C (or a TERM) between `cp file file.bak` and
# `mv file.bak file` leaves the source MUTATED on disk and a stray .bak beside
# it. That is not hypothetical: it happened on 2026-08-26, and it was
# reproduced deliberately before this trap was added — an interrupted run left
# the mutated source in place. A harness that can silently corrupt the code it
# is measuring is worse than no harness, because the damage only surfaces later
# as an unrelated-looking failure.
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

echo "=== Bundle 40 mutation run (Law 3) ==="
echo ""

# Baseline: the unmutated suite must be green, or every result below is noise.
bun "$SUITE" >/dev/null 2>&1
if [ $? -ne 0 ]; then echo "BASELINE IS RED — fix the suite before mutating."; exit 1; fi
echo "  baseline: GREEN (exit 0)"
echo ""

echo "-- guard 1: the sequence must require cos.send.ok --"
# The named mutation. A verifier that accepts a run where nothing went on the
# wire is the exact false green this script exists to make impossible: it would
# report "complete run", exit 0, and a morning check would conclude the brief
# was delivered when it was not.
mutate "the sequence accepts a run with no cos.send.ok" \
  scripts/verify-brief-run.mjs \
  "const LIVE_TAIL = ['cos.compose.ok', 'cos.send.ok', 'cos.brief.written'];" \
  "const LIVE_TAIL = ['cos.compose.ok', 'cos.brief.written'];"

echo ""
echo "-- guard 2: an empty file is NOT a pass --"
# The other named mutation. "I looked and found nothing" and "I looked and it
# was fine" must never share an exit code — a window too short to contain the
# event is a trap this project has already paid for (II.2).
mutate "an empty file exits 0 instead of 2" \
  scripts/verify-brief-run.mjs \
  "    reportErrors(errs, out);
    return 2;" \
  "    reportErrors(errs, out);
    return 0;"

echo ""
echo "-- guard 3: the other required steps --"
mutate "the sequence stops requiring cos.brief.written" \
  scripts/verify-brief-run.mjs \
  "const LIVE_TAIL = ['cos.compose.ok', 'cos.send.ok', 'cos.brief.written'];" \
  "const LIVE_TAIL = ['cos.compose.ok', 'cos.send.ok'];"
mutate "the sequence stops requiring cos.compose.ok" \
  scripts/verify-brief-run.mjs \
  "const LIVE_TAIL = ['cos.compose.ok', 'cos.send.ok', 'cos.brief.written'];" \
  "const LIVE_TAIL = ['cos.send.ok', 'cos.brief.written'];"
mutate "the sequence stops requiring the head (cos.mode / cos.delivery.mode)" \
  scripts/verify-brief-run.mjs \
  "const HEAD = ['cos.mode', 'cos.delivery.mode'];" \
  "const HEAD = [];"

echo ""
echo "-- guard 4: order is enforced, not merely presence --"
# inOrder() advancing from 0 each time would accept a send that happened before
# the compose — every required event present, in the wrong order, reported as a
# complete run.
mutate "the order check degrades to a presence check" \
  scripts/verify-brief-run.mjs \
  "    from = at + 1;" \
  "    from = 0;"

echo ""
echo "-- guard 5: a broken run must not exit 0 --"
mutate "inOrder() always reports ok, so no step is ever required" \
  scripts/verify-brief-run.mjs \
  "  let from = 0;
  for (const step of required) {" \
  "  let from = 0;
  if (required) return { ok: true, missing: null };
  for (const step of required) {"
mutate "report() returns 0 whatever the sequence said" \
  scripts/verify-brief-run.mjs \
  "  return seq.ok ? 0 : 1;" \
  "  return 0;"

echo ""
echo "-- guard 6: the numbers it prints are the RIGHT numbers --"
# Wall time measured on Railway's ingest clock instead of the service clock
# still produces a plausible duration — 3792 ms rather than 10776 ms — which is
# precisely why the suite asserts the exact value and a control proving the two
# clocks differ.
mutate "wall time is measured on the ingest clock, not the service clock" \
  scripts/verify-brief-run.mjs \
  "    ts: fields.timestamp ? Date.parse(fields.timestamp) : NaN," \
  "    ts: Date.parse(ingestTs),"
mutate "the truncation prose fallback is removed (real dumps report nothing)" \
  scripts/verify-brief-run.mjs \
  "  const m = /capped:\\s*(\\d+)\\s+of\\s+(at least\\s+)?(\\d+)/.exec(l.message);" \
  "  const m = null;"
mutate "'at least' is swallowed into the eligible total" \
  scripts/verify-brief-run.mjs \
  "    totalIsFloor: Boolean(m[2])," \
  "    totalIsFloor: false,"

echo ""
echo "-- guard 7: the error scan finds [LEVEL] tags, not a level= field --"
# The whole reason this function exists. `level=error` never appears in Railway
# output, so a verifier grepping for it reports a clean file however broken the
# service is.
mutate "the error scan looks for level=error, which can never match" \
  scripts/verify-brief-run.mjs \
  "  return text.split('\\n').filter((l) => /\\[ERROR\\]|\\[FATAL\\]|FATAL/.test(l));" \
  "  return text.split('\\n').filter((l) => /level=error/.test(l));"

echo ""
echo "-- guard 8: the run is the NEWEST one, and it is complete --"
mutate "findLatestRun picks the oldest run instead of the newest" \
  scripts/verify-brief-run.mjs \
  "    if (!best || key > best.key || (key === best.key && i > best.index)) {" \
  "    if (!best) {"
mutate "a run collects only its first line" \
  scripts/verify-brief-run.mjs \
  "    lines: lines.filter((l) => l.correlationId === best.correlationId)," \
  "    lines: lines.filter((l) => l.correlationId === best.correlationId).slice(0, 1),"

echo ""
echo "=== RESULT: $PASSED guards proven live, $MISSED missed ==="
if [ "$MISSED" -ne 0 ]; then echo "MUTATION RUN INCOMPLETE"; exit 1; fi

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
