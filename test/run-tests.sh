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
  echo 'const people = { rename, setRelationship, setBirthday };'
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

# ── Bundle 13: discovery planner — deterministic plan core + read-layer + §6 gate
section "discovery planner"
run_js "$(bundle test/reliability-core.js src/services/discovery.js test/discovery.test.js)"

# ── Bundle 14: entity resolution — Phase-1 confidence bands (wrong-person merge fix)
section "entity resolution"
run_js "$(bundle test/reliability-core.js src/services/entityResolution.js test/entity-resolution.test.js)"

# ── Bundle 15: birthday routing — a stated birthday populates people.birthday_month/day
section "birthday routing"
OUTB="$(mktemp -t cedrus-tests).js"
{
  cat test/stubs.js
  strip src/services/memory.js
  echo 'const memory = { addFact, canonicalFactKey, addSavedItem, addReminder, addGoal };'
  strip src/services/people.js
  echo 'const people = { rename, setRelationship, setBirthday };'
  strip src/pipeline/07_persist.js
  cat test/birthday-routing.test.js
} > "$OUTB"
run_js "$OUTB"

# ── Bundle 16: clarifications — Phase-2a ask-first dedup loop (state machine) ─
# Real voiceGuard/entityResolution/people/clarifications run against the doubles;
# resolveEntities + persist are injected as fakes inside the test.
section "clarifications loop"
OUTC="$(mktemp -t cedrus-tests).js"
{
  cat test/reliability-core.js
  echo 'const logger = { warn(){}, info(){}, error(){}, event(){}, addContext(){}, runWithContext:(_,f)=>f() };'
  strip src/services/voiceGuard.js
  strip src/services/entityResolution.js
  strip src/services/people.js
  echo 'const people = { create, addAlias, listForUser, rename, renameSelf, setRelationship, setBirthday };'
  strip src/services/clarifications.js
  cat test/clarifications.test.js
} > "$OUTC"
run_js "$OUTC"

# ── Bundle 17: model-fed timestamp normalization (event_date/trigger_at/due_at) ─
# Real memory.js/people.js/persist.js: a natural-language model date drops to null and
# the memory is still saved (the 22007 fix); a NOT-NULL reminder time is refused.
section "model timestamp normalization"
OUTT="$(mktemp -t cedrus-tests).js"
{
  cat test/stubs.js
  strip src/services/memory.js
  echo 'const memory = { addFact, canonicalFactKey, addSavedItem, addReminder, addGoal, toTimestamptz };'
  strip src/services/people.js
  echo 'const people = { rename, setRelationship, setBirthday };'
  strip src/pipeline/07_persist.js
  cat test/model-timestamps.test.js
} > "$OUTT"
run_js "$OUTT"

# ── Bundle 18: interests read-path — discovery gather degrades when the interests
# table is absent (its N5 foundation migration is unrun; docs/INTERESTS.proposed.sql).
section "discovery interests degradation"
run_js "$(bundle test/reliability-core.js src/services/discovery.js test/discovery-interests-degradation.test.js)"

# ── Bundle 19: user-set goals — pure vital-few selection + store/read layer ──
# time.js is included because goals.js stamps week_of via localWeekOf/mondayOf.
section "user-set goals"
run_js "$(bundle test/reliability-core.js src/utils/time.js src/services/goals.js test/goals.test.js)"

# ── Bundle 20: §6 suppression read — abnormal branches announce themselves ──
# The FIRST suite to run the real src/services/safetyFlags.js (every other suite
# stubs isInSuppressionWindow). Uses its own doubles rather than reliability-core:
# that fake Supabase always resolves { error: null } and can never throw, and the
# failure branches are the whole point here.
section "§6 suppression read logging"
run_js "$(bundle test/prelude-suppression.js src/services/safetyFlags.js test/suppression-read.test.js)"

# ── Bundle 21: quota reads — the ONLY per-user spend ceiling announces itself ─
# Real usage.js + the real checkRateLimit over a programmable (table-aware) seam.
# Asserts fail-open is PRESERVED (a false "over quota" would answer a crisis
# message with the rate-limit template, since STAGE B3 precedes the Priority 0
# gate inside understand()) while the fail-open is now logged.
section "quota read fail-open logging"
OUTQ="$(mktemp -t cedrus-tests).js"
{
  cat test/prelude-quota.js
  strip src/services/usage.js
  echo 'const usage = { getMessageQuota, getNudgeUsage };'
  strip src/pipeline/04_rateLimit.js
  cat test/quota-read.test.js
} > "$OUTQ"
run_js "$OUTQ"

# ── Bundle 22: crisis outranks the pre-model short-circuits (STAGE B2.5) ────
# REAL safetyDetection.js + selfName.js + pipeline/index.js over service doubles.
# Proves a first-ever crisis message gets 988 instead of the opt-in script, and a
# capped one gets 988 instead of the cap message — while the cap still bites for
# ordinary traffic and the model is never reached on either bypass.
section "crisis outranks pre-model short-circuits"
OUTX="$(mktemp -t cedrus-tests).js"
{
  cat test/prelude-crisis-cap.js
  strip src/services/safetyDetection.js
  strip src/pipeline/selfName.js
  strip src/pipeline/index.js
  cat test/crisis-before-cap.test.js
} > "$OUTX"
run_js "$OUTX"

# ── Bundle 23: relationship-memory writes announce their failures ───────────
# Real relationships.js over a THENABLE table-aware seam (it awaits the builder
# directly, no .maybeSingle() terminal). contact_events drives the trigger that
# freshens people.last_contact_at — i.e. the person panel's "Last touch".
section "relationships write logging"
run_js "$(bundle test/prelude-relationships.js src/services/relationships.js test/relationships-write.test.js)"

# ── Bundle 24: memory.js silent failures — supersession + goal reads ────────
# Real memory.js over a per-OPERATION seam (addFact hits `facts` twice: update
# then insert, and the point is failing the first while the second succeeds).
# time.js is included because memory.js stamps week_of via localWeekOf/mondayOf.
section "memory silent-failure reporting"
run_js "$(bundle test/prelude-memory-silent.js src/utils/time.js src/services/memory.js test/memory-silent.test.js)"

# ── Bundle 25: consent audit trail announces its failures ───────────────────
# Reuses the Bundle 23 prelude (thenable, table-aware). Runs the REAL
# handleCompliance so the load-bearing ordering is pinned: setOptedOut()
# enforces the opt-out BEFORE the audit write, so a lost consent_events row
# never means an unhonoured STOP.
section "consent audit-trail logging"
OUTCN="$(mktemp -t cedrus-tests).js"
{
  cat test/prelude-relationships.js
  echo 'let __optOutCalls = [];'
  echo 'const users = { setOptedOut: async (id, value) => { __optOutCalls.push({ id, value }); } };'
  strip src/services/consent.js
  echo 'const consent = { log };'
  strip src/pipeline/03_compliance.js
  cat test/consent-write.test.js
} > "$OUTCN"
run_js "$OUTCN"

printf '\n✅ All test bundles passed.\n'
