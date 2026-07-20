#!/bin/sh
# NF2-IMPORT — chat-export import suites (MOUNT_IMPORT).
# Parser/scope suite is dependency-free; the integration suite uses bun's
# mock.module (bun explicitly, same as web-api/webonboard).
set -e
cd "$(dirname "$0")/.."

echo "--- import: parsers + six-theme scope (dependency-free) ---"
if command -v bun >/dev/null 2>&1; then bun test/import-parsers.test.mjs
else node test/import-parsers.test.mjs; fi

echo ""
echo "--- import: upload -> extract -> review -> confirm (bun mock.module) ---"
bun test/import.test.mjs

echo ""
echo "IMPORT SUITES PASSED"
