#!/bin/sh
# N1 admin-panel proof bundle (docs/ADMIN_API_CONTRACT.md).
# Same dependency-free concat technique as run-tests.sh: doubles + the REAL
# src files (import/export lines stripped) + the proof test, in one script.
# Includes the real src/routes/admin.js so the reset pass-through is proven
# against the actual founder-admin handler, not a stand-in.
#
# NOT wired into run-all.sh (that file is outside N1's write boundary).
# Full battery for this branch:  sh test/run-all.sh && sh test/run-admin-tests.sh
set -e
cd "$(dirname "$0")/.."

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

run_js() {
  if command -v bun >/dev/null 2>&1; then bun "$1"
  elif command -v node >/dev/null 2>&1; then node "$1"
  else "$JSC" "$1"; fi
}

strip() {
  sed -e '/^import /d' \
      -e '/^export {/d' \
      -e '/^export default/d' \
      -e 's/^export async function/async function/' \
      -e 's/^export function/function/' \
      -e 's/^export const/const/' "$1"
}

printf '\n══════ N1 admin panel ══════\n'
OUT="$(mktemp -t cedrus-admin-tests).js"
{
  cat test/reliability-core.js
  cat test/prelude-admin.js
  strip src/utils/phone.js
  strip src/routes/admin.js
  echo 'const adminRouter = router;'
  strip src/services/adminOps.js
  strip src/routes/adminPanel.js
  cat test/adminPanel.test.js
} > "$OUT"
run_js "$OUT"

printf '\n✅ Admin-panel bundle passed.\n'
