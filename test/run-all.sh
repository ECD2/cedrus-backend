#!/bin/sh
# Full WS-B conversation-quality test suite. Dependency-free where possible;
# the deterministic safety/voice/search suites run under bun (this machine has
# bun only). The fact-pipeline concat rig runs the REAL memory.js/persist.js.
#
# The live-model eval (test/extraction-prompt-cases.mjs) is NOT run here — it
# needs OPENAI_API_KEY and makes real calls. Run it separately where env lives.
set -e
cd "$(dirname "$0")/.."

RUNNER=""
if command -v bun >/dev/null 2>&1; then RUNNER="bun"
elif command -v node >/dev/null 2>&1; then RUNNER="node"
else echo "need bun or node to run the safety/voice/search suites"; exit 1; fi

echo "=== fact pipeline (real memory.js/persist.js, dependency-free rig) ==="
sh test/run-tests.sh

echo ""
echo "=== Priority 0 — safety & crisis detection ==="
$RUNNER test/safety.test.mjs

echo ""
echo "=== Priority 1 — voice & emotional-intelligence guard ==="
$RUNNER test/voice.test.mjs

echo ""
echo "=== Priority 3 — web search & injection resistance ==="
$RUNNER test/search.test.mjs

echo ""
echo "ALL WS-B SUITES PASSED"

echo ""
echo "=== CORS — browser cross-origin access (cedrus.life) ==="
# bun explicitly: the suite drives a real Express app over node:http.
bun test/cors.test.mjs

echo ""
echo "=== N1 — admin panel ==="
sh test/run-admin-tests.sh

echo ""
echo "=== N3 — web API (capture / priority / restore) ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module (MOUNT_N3).
bun test/web-api.test.mjs

echo ""
echo "=== WS-F — weekly-note email backend ==="
sh test/run-n2-brief-email.sh

echo ""
echo "=== admin auth — TOTP login + sessions (MOUNT_ADMIN_AUTH) ==="
sh test/run-admin-auth-tests.sh

echo ""
echo "=== web onboarding (public /api/onboard/start, MOUNT_WEBONBOARD) ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module.
bun test/webonboard.test.mjs

echo ""
echo "=== NF2 — chat memory import (MOUNT_IMPORT) ==="
sh test/run-import-tests.sh

echo ""
echo "=== NF2 — interests API (CRUD / auth / opt-out) ==="
bun test/interests.test.mjs

echo ""
echo "ALL BATTERY SUITES PASSED"
