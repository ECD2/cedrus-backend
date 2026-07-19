#!/bin/sh
# N2 weekly-note EMAIL suite (WS-F). New, standalone runner — run-all.sh is
# frozen tonight; docs/MOUNT_N2.md describes the one-line hookup.
#
#   sh test/run-n2-brief-email.sh
#
# Three parts:
#   1. security  — tokens/unsubscribe/transport against REAL node:crypto (bun)
#   2. content   — composer/renderer/SMS preview + golden snapshot (bun)
#   3. job proof — stripped REAL src bundled over in-memory doubles, same
#                  technique as run-tests.sh (strip extended for `export class`)
set -e
cd "$(dirname "$0")/.."

RUNNER=""
if command -v bun >/dev/null 2>&1; then RUNNER="bun"
elif command -v node >/dev/null 2>&1; then RUNNER="node"
else echo "need bun or node for the N2 email suites"; exit 1; fi

echo "=== N2 email 1/3 — action tokens, unsubscribe, transport ==="
$RUNNER test/brief-email-security.test.mjs

echo ""
echo "=== N2 email 2/3 — composer, renderer, SMS preview, snapshot ==="
$RUNNER test/brief-email-content.test.mjs

echo ""
echo "=== N2 email 3/3 — briefEmail job proof bundle ==="
strip() {
  sed -e '/^import /d' \
      -e '/^export {/d' \
      -e '/^export default/d' \
      -e 's/^export async function/async function/' \
      -e 's/^export function/function/' \
      -e 's/^export const/const/' \
      -e 's/^export class/class/' "$1"
}
OUT="$(mktemp -t n2-brief-email).js"
{
  cat test/brief-email-stubs.js
  strip src/services/voiceGuard.js
  strip src/services/brief/template.js
  strip src/services/brief/composer.js
  strip src/services/brief/renderer.js
  strip src/services/brief/tokens.js
  strip src/services/brief/transport.js
  strip src/jobs/briefEmail.js
  cat test/brief-email-job.test.js
} > "$OUT"
$RUNNER "$OUT"

echo ""
echo "ALL N2 EMAIL SUITES PASSED"
