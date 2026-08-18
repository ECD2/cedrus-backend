#!/bin/sh
# Repo integrity — no NUL bytes in tracked files.
#
# WHY THIS EXISTS
# A literal NUL in a text file makes git classify it as binary. `git diff` then
# prints `Bin 8025 -> 10482 bytes` and shows NO CONTENT — the file silently
# leaves code review. It happened twice on 2026-08-17: once in
# src/services/cos/client.js (a memoization separator typed as a raw NUL), and
# once in SESSION_NOTES_2026-08-17.md, inside the sentence warning about the
# first one.
#
# Twice in one session is not carelessness, it is a tooling gap. A NUL is
# invisible in every editor and terminal, `grep` will not find it, and review
# cannot see it because there is nothing to see. The ONLY signal is the word
# `Bin` in `git diff --stat`, which a human has to notice and remember to look
# for. This check is that signal, automated and gating.
#
# STRUCTURAL, NOT ADVISORY
# The check verifies its OWN DETECTOR on every single run, before scanning
# anything real:
#
#   • positive control — a synthetic file that DOES contain a NUL must be
#     flagged. If the detector ever silently breaks (a changed perl, a quoting
#     regression, an empty file list), this fails and the battery goes red even
#     though no real NUL exists.
#   • negative control — a synthetic file that does NOT contain a NUL must come
#     back clean. Without this, a detector that flagged everything would pass
#     the positive control and look healthy (Lesson 3: a control that does not
#     discriminate proves nothing).
#
# So this cannot degrade into a check that passes because it examined nothing.
# That is the failure mode of every guard in II.4 — Lesson 7's "checked and
# fine" being indistinguishable from "didn't run".
#
# Run: sh test/no-nul-bytes.sh
set -u
cd "$(dirname "$0")/.."

failures=0
ok()   { echo "  PASS  $1"; }
bad()  { failures=$((failures+1)); echo "  FAIL  $1${2:+  -- $2}"; }

# The detector. Shell predicate convention: exit 0 (true) = a NUL IS present.
# perl over the whole slurped file: portable on macOS (BSD grep has no -P and
# `grep $'\0'` is not reliable across shells), and one process per file.
#
# NOTE the exit codes read backwards from "1 means bad". They are shell truth
# values, not error codes. Getting this inverted is exactly what the negative
# control below caught on the first run of this script: with the inversion, the
# POSITIVE control still printed PASS (by accident of branch ordering) while
# every clean file was flagged. One control alone would have shipped the bug.
has_nul() {
  perl -0777 -ne 'exit(index($_, chr(0)) >= 0 ? 0 : 1)' "$1"
}

# There are currently ZERO legitimately-binary tracked files (verified
# 2026-08-18: 410 tracked, all text/mime-encoding non-binary). If a real binary
# asset is ever committed, add its exact path here — one per line — rather than
# weakening the check. An entry is a deliberate, reviewable exemption.
ALLOWLIST=""

echo "=== repo integrity: no NUL bytes in tracked files ==="

# ── the detector proves itself, before it is trusted on anything real ────────
CTRL_DIR=$(mktemp -d)
trap 'rm -rf "$CTRL_DIR"' EXIT
printf 'clean text file\n'            > "$CTRL_DIR/clean.txt"
printf 'poisoned \000 text file\n'    > "$CTRL_DIR/dirty.txt"

if has_nul "$CTRL_DIR/dirty.txt"; then
  ok  "positive control: a file with a NUL is detected"
else
  bad "positive control: a file WITH a NUL was not detected — THE DETECTOR IS BROKEN"
fi
if has_nul "$CTRL_DIR/clean.txt"; then
  bad "negative control: a CLEAN file was flagged — the detector does not discriminate"
else
  ok  "negative control: a clean file is not flagged"
fi

if [ "$failures" -ne 0 ]; then
  echo ""
  echo "  the detector failed its own controls; the scan below would prove nothing"
  echo "$failures CHECK(S) FAILED"
  exit 1
fi

# ── the real scan ───────────────────────────────────────────────────────────
scanned=0
dirty=""
for f in $(git ls-files); do
  [ -f "$f" ] || continue
  case "$ALLOWLIST" in *"$f"*) continue;; esac
  scanned=$((scanned+1))
  if has_nul "$f"; then dirty="$dirty $f"; fi
done

# A scan that examined nothing must never read as a pass (Lesson 7). If
# `git ls-files` returns empty — wrong cwd, broken git — that is a failure,
# not a clean bill of health.
if [ "$scanned" -eq 0 ]; then
  bad "scanned ZERO files — git ls-files returned nothing; this is not a pass"
  echo "$failures CHECK(S) FAILED"
  exit 1
fi
ok "scanned $scanned tracked files"

if [ -n "$dirty" ]; then
  echo ""
  for f in $dirty; do
    bad "NUL byte in tracked file: $f"
  done
  echo ""
  echo "  A NUL makes git treat the file as binary: 'git diff' shows 'Bin N -> M bytes'"
  echo "  and NO content, so the file silently leaves code review."
  echo ""
  echo "  Find it:    python3 -c \"d=open('PATH','rb').read(); i=d.index(b'\\\\x00'); print('line', d[:i].count(b'\\\\n')+1)\""
  echo "  In source:  write the escape \\u0000 (six visible characters), never a raw byte."
  echo ""
  echo "$failures CHECK(S) FAILED"
  exit 1
fi
ok "no tracked file contains a NUL byte"

echo ""
echo "ALL NUL-BYTE CHECKS PASSED"
