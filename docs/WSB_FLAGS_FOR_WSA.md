# WS-B → WS-A flags (conversation-quality cycle 1)

WS-B owns extraction/entity/persist + the new safety & voice services. These
items touch files WS-A owns (logger, pipeline/index.js orchestration, jobs,
people.js). WS-B did NOT edit them — they are requested here.

## 1. Logger `sensitivity` field (safety spec §7) — CONSUMED, needs backing

WS-B records every crisis-track event content-free via:

```js
logger.info('safety_event', {
  sensitivity: 'crisis',   // <-- the field WS-A builds
  userId,                  // id only, NEVER message content
  category,                // 'A'|'B'|'C'|'D'
  boundary,                // 'substance' for the content boundary
  source,                  // 'deterministic' regex gate | 'model_band' second net
  templateVersion,
});
```

Note (cycle-1 revision): crisis detection is now a TWO-NET design. The
deterministic regex gate runs first; if it clears, the model's own valence
classifier is a second detector, and a `band === 'crisis'` result routes to the
SAME fixed templates. Both nets emit the identical `sensitivity: 'crisis'`
marker — the new `source` sub-field only records which net fired, for audit. No
WS-A change is needed beyond §1's handling of the `sensitivity` marker.

Requested of WS-A's `src/utils/logger.js`:
- Treat a `sensitivity: 'crisis'` marker as a restricted event: keep it OUT of
  product analytics/usage metrics and out of any per-user dashboard (§7).
- Never log the triggering message body for these events (WS-B already passes no
  content — please keep it that way if the logger enriches).
- The "should the detection event be logged for audit at all" tension (§7 last
  bullet) is legal-gated — see WSB_FLAGS_FOR_WSC.md; don't resolve it in code.

Until the field exists, the marker rides in the structured arg and is harmless.

## 2. Crisis coverage of the pre-`understand()` short-circuits (pipeline/index.js)

WS-B's Priority-0 detector runs inside `understand()` (05), so it covers every
model-drafted reply. But `runInboundPipeline` (index.js, WS-A) returns several
FIXED replies before `understand()` is ever called: the onboarding/opt-in text,
the bare-name onboarding branch, the rate-limit message, STOP/START/HELP. Those
are safe canned copy, but a crisis disclosure arriving in, e.g., a first
onboarding message would not hit the detector.

Low-risk, high-value hardening (WS-A's call, since index.js is yours):
```js
import { evaluateSafety, isSafetyOverride } from './services/safetyDetection.js';
// near the top of runInboundPipeline, after logging inbound:
const s = evaluateSafety(body);
if (isSafetyOverride(s)) { /* send s.reply, skip onboarding/rate-limit copy */ }
```
`evaluateSafety` is pure, dependency-free, and never throws.

## 3. Suppression window read before promo/playful sends (safety spec §6)

WS-B emits the 48h suppression signal (`safetyFlags.openSuppressionWindow`) and
exposes `safetyFlags.isInSuppressionWindow(userId)`. Nudge/brief/game sends live
in WS-A/WS-E jobs. Before sending any promotional or playful content, consult:
```js
import { isInSuppressionWindow } from '../services/safetyFlags.js';
if (await isInSuppressionWindow(user.id)) return; // skip promo/playful this window
```
This depends on the WS-C schema column (see WSB_FLAGS_FOR_WSC.md); until then the
read fails OPEN (returns false) so ordinary reminders keep flowing — by design.

## 4. people.relationship correction sync — CORRECTED 2026-07-19 (was wrong post-merge)

Earlier revisions of this section said the landed fix "already syncs"
`people.relationship` and needed no action. **On merged main that was false:**
WS-A's ownership hardening changed `people.rename`/`people.setRelationship` to
require the owning `userId` first, and `persist()` still used the old 2-arg
signatures — so both calls failed closed (caught no-ops). Name corrections and
the relationship-column sync silently did nothing (the fact rows themselves
still wrote; see WSA_FLAGS_FOR_WSB.md B-1, which called for exactly this fix).

Fixed on `fix/persist-owner-args`: `persist()` now passes `user.id` to both
calls, and the fact-pipeline test bundle runs the REAL `people.js` (not a
lenient stub) with rename/sync/cross-tenant regression checks, so a future
signature drift fails the battery instead of vanishing. WS-B's VALENCE wiring
on the correction path (`voiceGuard.js`) is unaffected and still holds.
