#!/bin/sh
# BE-ADMIN-AUTH proof suite (docs/ADMIN_AUTH_CONTRACT.md).
#
# Unlike the dependency-free concat bundles, this suite drives real Express +
# otplib + bcryptjs + qrcode, so it needs the packages installed locally
# (node_modules is gitignored). We ensure them, then run under bun (this
# machine's runtime; the mjs suite uses bun's mock.module).
#
# NOT wired into run-all.sh (that file is outside this session's write boundary).
# Full battery for this branch:
#   sh test/run-all.sh && sh test/run-admin-tests.sh && sh test/run-admin-auth-tests.sh
set -e
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for the admin-auth suite (real otplib/bcryptjs/express)." >&2
  exit 1
fi

# otplib MUST be v12 locally (v13's ESM interop drops the `authenticator` named
# export). package.json pins ^12; install if the tree isn't present.
if [ ! -d node_modules/otplib ]; then
  echo "installing dependencies (otplib/bcryptjs/qrcode/express)…"
  bun install >/dev/null 2>&1
fi

printf '\n══════ BE-ADMIN-AUTH admin login ══════\n'
bun test/adminAuth.test.mjs

printf '\n✅ Admin-auth suite passed.\n'
