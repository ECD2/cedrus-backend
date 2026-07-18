# WS-B → WS-D flags (frontend / brief-rendering / closet copy)

These are product-copy and brief-rendering rules the safety and voice specs
place on surfaces WS-D owns. WS-B does not edit frontend copy; flagging here.

## 1. Closet / packing / photo-inventory copy (safety spec §5) — REQUIRED

Cedrus's closet/packing feature is a plausible place disordered-eating signals
surface, and it is the failure other products miss most. The copy for these
surfaces must:
- NEVER comment on body size, weight change, or "fitting into" clothes in any
  way that could read as validating restriction.
- Give no nutrition, diet, weight-target, or exercise guidance — not even framed
  as "healthier goals" (precise numbers can reinforce restrictive patterns).
- Not supply a causal story about why someone restricts/binges/purges; reflect
  only what the user said.

WS-B enforces the conversational side (voiceGuard suppresses numeric diet/weight/
exercise guidance once ED signals appear). The static closet/packing strings are
yours — please encode the same boundary there.

## 2. Weekly brief must never resurface Negative-band or crisis facts (§3.9, §7)

- A brief/reminder must NOT casually re-mention a breakup, death, illness, or
  other loss as a cheerful data point ("3 months since you and Sarah broke up!").
  Check the fact's valence band before including it as a casual item. If a
  reminder about a Negative-band fact exists, it exists because the user asked —
  render it plainly, never celebratorily.
- Crisis-flagged content is NEVER summarized into a brief, regardless of any
  valence rules elsewhere (safety spec §7).

## 3. Respect the 48h suppression window in playful/promo brief content (§6)

After any Category A/B/C/D signal, for 48h, briefs must suppress cheerful
"learn your favorites"/games/upsell content referencing that window. Read the
flag before rendering promotional/playful brief sections:
```js
import { isInSuppressionWindow } from 'backend/src/services/safetyFlags.js';
if (await isInSuppressionWindow(userId)) { /* omit playful/promo brief content */ }
```
Depends on the WS-C schema column (see WSB_FLAGS_FOR_WSC.md); until then the read
returns false (fails open). Ordinary factual reminders in the brief continue —
only the promotional/playful layer is gated.
