# WS-B → WS-C flags (schema owner)

WS-B is prohibited from schema/migration changes this cycle. The following
storage is needed by the safety work; WS-B built the read/write interface to
degrade gracefully until these land.

## 1. Crisis suppression window persistence (safety spec §6) — REQUIRED

The 48h promo/playful cooldown after any Category A/B/C/D signal needs durable,
per-user, cross-service state. WS-B's `src/services/safetyFlags.js` currently
writes/reads it best-effort against an intended column:

- Preferred: `app_users.crisis_suppressed_until timestamptz null`
  - set to `now() + interval '48 hours'` when a crisis fires
  - readers gate on `crisis_suppressed_until > now()`
- The column name is the single constant `SUPPRESSION_COLUMN` in safetyFlags.js;
  if you pick a different name/shape, tell WS-B and it's a one-line change.

Behavior until it exists: `openSuppressionWindow` no-ops with a warn log;
`isInSuppressionWindow` returns `false` (fails OPEN — ordinary reminders keep
working, only promo suppression is inactive). No user-facing breakage either way.

Note (spec §8): repeat disclosures NEVER dampen the crisis response — every
signal gets a fresh full response. The suppression window only gates PROMO
content, never the safety reply itself, so a simple "latest wins" timestamp is
correct; do not add per-user rate-limiting to the crisis response.

## 2. Crisis-event audit table (safety spec §7) — LEGAL-GATED, do not build yet

§7 names a real, unresolved tension: "log nothing sensitive" vs "prove the
safety system worked." Whether a `crisis_events` audit table should exist, its
retention, and its access model are flagged for Emil + counsel (spec §8, still
open). WS-B did NOT invent a storage path for crisis content (§3, §7). Please
hold any such table until that decision lands.

## 3. Conversation-level disordered-eating flag (safety spec §5) — OPTIONAL

§5 says once ED signals appear, no diet/weight/exercise guidance for "the rest
of that conversation." WS-B enforces this WITHIN the current turn (voiceGuard
strips numeric diet guidance when the turn's message shows ED signals). Making
it persist across turns would need a per-conversation/per-user flag similar to
§1. Flagging as a possible follow-up; not required for the floor.
