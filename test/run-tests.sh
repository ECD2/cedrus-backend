#!/bin/sh
# Runs the fact-pipeline tests with no dependencies: uses node if installed,
# otherwise falls back to macOS's bundled JavaScriptCore (jsc).
#
# The src files are plain ESM; we strip import/export and concatenate them after
# in-memory stubs (test/stubs.js), so the REAL memory.js/persist.js logic runs
# against a fake facts table.
set -e
cd "$(dirname "$0")/.."
OUT="$(mktemp -t cedrus-tests).js"

strip() { sed -e '/^import /d' -e 's/^export async function/async function/' -e 's/^export function/function/' -e 's/^export const/const/' "$1"; }

{
  cat test/stubs.js
  strip src/services/memory.js
  echo 'const memory = { addFact, canonicalFactKey };'
  echo 'const people = peopleService;'
  strip src/pipeline/07_persist.js
  cat test/fact-supersession.test.js
} > "$OUT"

if command -v node >/dev/null 2>&1; then
  node "$OUT"
else
  JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
  "$JSC" "$OUT"
fi
