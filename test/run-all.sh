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

# Repo integrity FIRST. A NUL byte makes git treat a text file as binary, so
# `git diff` shows "Bin N -> M bytes" and no content — the file silently leaves
# code review. Happened twice on 2026-08-17. This gates everything else because
# it is a property of the tree, not of any one suite, and because a repo in that
# state should not report a green battery.
echo "=== repo integrity — NUL bytes ==="
sh test/no-nul-bytes.sh

echo ""
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
echo "=== Onboarding — self-name capture (Station 3) ==="
$RUNNER test/self-name.test.mjs

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
echo "=== INFRA-10 — insights API (feed / auth / entitlement tags) ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module.
bun test/insights-route.test.mjs

echo ""
echo "=== UI-09 — reminders read API (upcoming + delivery state) ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module.
bun test/reminders-api.test.mjs

echo ""
echo "=== Bundle 35 — CONTRACTS: vendored package enforced on POST /api/goals ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module.
bun test/contracts-goals.test.mjs

echo ""
echo "=== Bundle 36 — SMS number allow-list (routes/sms.js STAGE A2) ==="
# bun explicitly, not $RUNNER: the suite uses top-level await + dynamic import.
bun test/sms-allowlist.test.mjs

echo ""
echo "=== Bundle 37 — OUTBOUND SMS allow-list (lib/twilio.js STAGE O) ==="
# bun explicitly, not $RUNNER: the suite uses bun's mock.module.
bun test/outbound-allowlist.test.mjs

echo ""
echo "=== Bundle 38 — CoS daily brief (compose / ledger / budget / delivery) ==="
# bun explicitly, not $RUNNER: the suite uses top-level await + dynamic import
# (config.js calls required() at module scope, so env must be set before the
# imports evaluate — static imports are hoisted and would abort the suite).
bun test/cos-daily-brief.test.mjs

echo ""
echo "=== Bundle 39 — logger.scrub: ISO timestamps vs phone redaction ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import.
bun test/scrub-timestamps.test.mjs

echo ""
echo "=== Bundle 40 — verify-brief-run: post-deploy log verification ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import.
# This suite SPAWNS the real script to read its exit codes, which is the whole
# contract for anything invoking it from a shell.
bun test/verify-brief-run.test.mjs

echo ""
echo "=== Bundle 41 — multi-user isolation (a user change must never leak a record) ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import.
# Every assertion here carries a control. "User B got nothing" is worthless
# without "the identical request returns data for user A", which is why both
# halves run in the same test against the same fake.
bun test/multiuser-isolation.test.mjs

echo ""
echo "=== Bundle 42 — provisionUser() is ONE atomic operation (P1.2) ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import, and PGlite
# (a real Postgres 17 in-process) is a devDependency resolved from node_modules.
# The suite applies the REAL migration files, including their in-transaction
# self-proof, and forces every failure inside the database — never by mocking
# the client. A missing node_modules/@electric-sql/pglite is a battery FAILURE,
# not a skip: this is the only stage that proves the five writes are one
# transaction, and a proof that silently did not run is the disease Lesson 7
# treats.
bun test/provision-user.test.mjs

echo ""
echo "=== Bundle 43 — programs data foundation (R6.2a): contract, RLS forced, idempotent publish, today's block ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import, PGlite again.
# Applies the REAL migration files (foundation, provision_user, programs) to a
# real Postgres, publishes the two synthetic sources through the REAL function,
# and proves isolation with a control in every test: user B reads zero of A's
# rows alongside A reading them; the table OWNER reads zero (forced RLS); the
# same source twice is one revision alongside a changed source making two.
# It also SPAWNS the real load script to prove a dry run writes nothing.
bun test/programs-foundation.test.mjs

echo ""
echo "=== Bundle 48 — isolation proofs A2, A5, A10 (P1.5): cross-user writes refused, anon reads nothing, no id crosses a log trace ==="
# bun explicitly, not $RUNNER: top-level await + dynamic import, PGlite again.
bun test/isolation-proofs.test.mjs

echo ""
echo "=== CoS reader/schema conformance ==="
# The ONLY stage that can catch a reader/schema mismatch. Every other suite
# passes happily while one exists, because the reader, the composer and the
# fixtures were all written from the same reading of CoS. Needs COS_
# credentials; without them it ANNOUNCES a skip and exits 0 — a silent skip
# would be indistinguishable from a pass, which is the disease it treats.
bun test/cos-schema-check.mjs

echo ""
echo "=== contracts package: its own 97 tests + typecheck ==="
# The vendored package carries its own suite. It needs its dev toolchain
# (typescript, ajv), which is NOT committed, so this stage can only run where
# `npm install` has been done inside contracts/.
#
# It announces which mode it ran in, every time. A skipped stage that prints
# nothing is indistinguishable from a passing one, and that confusion is Lesson
# 7's whole subject. The skip is deliberately NOT a battery failure: the
# runtime path is contracts/dist/, which Bundle 35 exercises for real with no
# toolchain at all.
if [ -d contracts/node_modules ]; then
  echo "contracts: toolchain present, running check"
  ( cd contracts && npm run check --silent )
else
  echo "contracts: SKIPPED — contracts/node_modules is absent."
  echo "contracts: this stage did NOT run. To run it: cd contracts && npm install && npm run check"
  echo "contracts: the vendored package's runtime output (contracts/dist/) is still"
  echo "contracts: covered by Bundle 35 above, which needs no toolchain."
fi

echo ""
echo "ALL BATTERY SUITES PASSED"
