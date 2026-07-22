#!/bin/sh
# Dependency-free test runner. Prefers bun (this machine's runtime), then node,
# then macOS's bundled JavaScriptCore (jsc).
#
# Each "bundle" concatenates in-memory stubs + the REAL src files (with their
# import/export lines stripped) + a proof test, so the actual production logic
# runs against fakes with no node_modules required.
set -e
cd "$(dirname "$0")/.."

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

run_js() {
  if command -v bun >/dev/null 2>&1; then bun "$1"
  elif command -v node >/dev/null 2>&1; then node "$1"
  else "$JSC" "$1"; fi
}

# Strip ESM import/export syntax so files can be concatenated into one script.
strip() {
  sed -e '/^import /d' \
      -e '/^export {/d' \
      -e '/^export default/d' \
      -e 's/^export async function/async function/' \
      -e 's/^export function/function/' \
      -e 's/^export const/const/' "$1"
}

# Build a bundle from a list of files. Files under src/ are stripped; everything
# else (stubs, tests) is included verbatim.
bundle() {
  out="$(mktemp -t cedrus-test).js"
  : > "$out"
  for f in "$@"; do
    case "$f" in
      src/*) strip "$f" >> "$out" ;;
      *)     cat "$f"    >> "$out" ;;
    esac
    printf '\n' >> "$out"
  done
  printf '%s\n' "$out"
}

section() { printf '\n══════ %s ══════\n' "$1"; }

# ── Bundle 1: fact pipeline (original) ──────────────────────────────────────
section "fact pipeline"
OUT="$(mktemp -t cedrus-tests).js"
{
  cat test/stubs.js
  strip src/services/memory.js
  echo 'const memory = { addFact, canonicalFactKey };'
  # REAL people.js (ownership guard + user-scoped writes), not a stub: persist's
  # call signatures into this service are load-bearing and must be exercised.
  strip src/services/people.js
  echo 'const people = { rename, setRelationship };'
  strip src/pipeline/07_persist.js
  cat test/fact-supersession.test.js
} > "$OUT"
run_js "$OUT"

# ── Bundle 2: structured logger + sensitivity lane (item 7) ─────────────────
section "structured logger"
run_js "$(bundle test/reliability-core.js src/utils/logger.js test/logger.test.js)"

# ── Bundle 3: reminder double-send / retryable failure (item 1) ─────────────
section "reminder dispatch"
run_js "$(bundle test/reliability-core.js test/reliability-stubs.js src/jobs/reminders.js test/reminders.test.js)"

# ── Bundle 4: people ownership guard (item 3) ───────────────────────────────
section "people ownership guard"
run_js "$(bundle test/reliability-core.js src/services/people.js test/people-ownership.test.js)"

# ── Bundle 5: duplicate signed inbound is a no-op ───────────────────────────
section "inbound dedup"
run_js "$(bundle test/reliability-core.js test/reliability-stubs.js src/services/messages.js test/messages-dedup.test.js)"

# ── Bundle 6: brief marked sent only after a confirmed send (item 2) ────────
section "weekly brief send ordering"
run_js "$(bundle test/reliability-core.js test/reliability-stubs.js src/jobs/weeklyBrief.js test/brief.test.js)"

# ── Bundle 7: Twilio signature hardening (item 4) ───────────────────────────
section "twilio signature"
run_js "$(bundle test/reliability-core.js test/prelude-twilio.js src/lib/twilio.js test/signature.test.js)"

# ── Bundle 8: §6 suppression window — brief promo layer ─────────────────────
section "brief §6 suppression"
run_js "$(bundle test/reliability-core.js src/jobs/brief/select.js test/brief-suppression.test.js)"

# ── Bundle 9: §6 suppression window — sweep playful layer ───────────────────
section "sweep §6 suppression"
run_js "$(bundle test/reliability-core.js src/jobs/sweeps/select.js test/sweep-suppression.test.js)"

# ── Bundle 10: insight engine — pure ranking core + read-layer wiring ───────
section "insight engine"
run_js "$(bundle test/reliability-core.js src/services/insights.js test/insights.test.js)"

# ── Bundle 11: brief engine — pure select/compose/first-brief + read layer ──
section "brief engine"
run_js "$(bundle test/reliability-core.js src/services/briefEngine.js test/brief-engine.test.js)"

# ── Bundle 12: brief engine — REAL insights.js feeds the brief end to end ────
section "brief engine wiring (real insights.js)"
run_js "$(bundle test/reliability-core.js src/services/insights.js src/services/briefEngine.js test/brief-engine-wiring.test.js)"

printf '\n✅ All test bundles passed.\n'
