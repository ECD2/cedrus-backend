# The Brief Engine — contract & design

`src/services/briefEngine.js` composes a user's brief and **returns** it. It is the
READ side of the weekly brief: it feeds the Insight Engine
(`src/services/insights.js`) into the brief's select stage, so the brief surfaces
**real reasons to reach out** (recency, birthdays, upcoming dates, recently-learned
facts, open reminders/prompts/goals) instead of re-deriving them. It is READ +
COMPOSE only: it never sends, and is **not** wired into SMS, email, the scheduler,
or any dispatch. It extends — it does not replace — the existing send pipeline
(`src/jobs/brief/gather|select|compose` + `src/jobs/weeklyBrief.js`), which is left
untouched and still gathers → selects → composes → sends exactly as before.

## Where it sits

```
                 (send path — UNCHANGED)
 weeklyBrief.js → gather → select.js → compose.js (OpenAI) → sendSms
                              │
 insights.js ────────────────┼─────────────┐
 (computeInsights)           │             │
                             ▼             ▼
                    briefEngine.js  (READ side — new, inert)
                    gather → computeInsights → selectBriefReasons
                          → composeBriefContent → RETURN brief
```

The two never cross: the brief engine reuses the insight engine and the existing
gather, but writes nothing and dispatches nothing.

## Three pure stages + a read layer

| Function | Kind | Role |
|----------|------|------|
| `selectBriefReasons(user, {insights, selfNote, goalFollowup}, {suppressPromo})` | pure | insight feed → ranked, entitlement-gated brief **plan** |
| `composeBriefContent(user, selection, {now})` | pure | plan → returnable brief (`sections`, `plan`, `text`) |
| `buildFirstBrief(user, profile, {insights, now})` | pure | the onboarding "first brief" from a thin profile |
| `voiceScan(text)` | pure | enforceable voice backstop (em dash / exclamation / banned cheer) |
| `generateBrief(user, opts, deps)` | read | gather → compute → select → compose → RETURN |
| `generateFirstBrief(user, opts, deps)` | read | gather thin profile → RETURN first brief |

All three pure stages are deterministic (no DB, no clock of their own — the caller
passes `now` — and **no model call**). Determinism is deliberate: it makes selection
and voice unit-testable and keeps the engine inert, exactly like the insight engine.

## How insights are wired into select

`computeInsights` returns a ranked feed of one reason per person, each tagged
`entitlement` (`'free'` for Core 5, `'pro'` for everyone else) and `gated`.
`selectBriefReasons` consumes that feed and applies the boundary:

* **free viewer** → only the ungated (Core 5) reasons are actionable; the gated
  (outside-circle) people become the loss-aversion **teaser**.
* **pro / trial** → every reason is actionable; there is no teaser.

The feed is already ranked, so selection keeps that order, one reason per person,
capped at `MAX_REASONS` (3) for a tight brief. This mirrors the entitlement boundary
the existing `src/jobs/brief/select.js` expresses through `proactive_enabled`
(free ⇒ core-five, pro/trial ⇒ everyone), but sourced from the insight tags.

## Crisis suppression (safety spec §6) — preserved, not weakened

Inside the 48h post-crisis window the **promotional/playful** layer is withheld:
the Pro teaser (an upsell) and the per-reason action offers. Factual reasons, the
goal aside, the self note, and the closing question are ordinary brief content and
keep flowing. `selectBriefReasons(..., { suppressPromo: true })` reproduces the exact
contract that `src/jobs/brief/select.js` already honors (proven by
`test/brief-suppression.test.js`), on the insight-driven path. `generateBrief` reads
the window via `isInSuppressionWindow` (injectable, read-only, **fail-open** — a
not-yet-migrated flag never pauses the brief), exactly like `previewBrief`. The send
pipeline's suppression path is untouched, so existing suppression cannot regress.

## The first brief (the onboarding payoff)

`buildFirstBrief` / `generateFirstBrief` produce a distinct welcoming brief for a
brand-new user, composed from a **thin profile** the moment onboarding finishes:

```
profile = { people:[{id,name,relationship?}], interests:[{category,label}],
            goals:[{goal_text}], location: string|null }
```

plus any insights that already legitimately exist (e.g. a birthday they entered).
**Cold-start is handled honestly — nothing is ever fabricated:**

* Only real data is reflected: the people they named, interests they gave, goals
  they set, and real insights. The self person is excluded.
* A section with nothing real is **omitted**, not invented.
* The **truly-empty** profile (no people, interests, goals, or insights) gets an
  honest, welcoming, open-door message ("I do not have anyone in here yet, and that
  is okay. Tell me about someone you care about…") — never a manufactured moment.

`generateFirstBrief` gathers people from the same context the insight engine already
read (no extra query), interests via `listInterests` (active only — the per-interest
opt-out is honored by construction), goals from the gathered signals, and location
from the user record. A missing interests table is swallowed so it can never break
the payoff.

## Voice (CEDRUS_VOICE_AND_EMOTIONAL_INTELLIGENCE_SPEC)

Every string the engine emits follows **acknowledge → task → open-door**, uses **no
em dashes and no exclamation marks**, avoids the banned cheerful vocabulary
(`great/awesome/nice/amazing/…`), and **never resurfaces a negative fact
cheerfully** — a self note is acknowledged gently *without echoing the raw fact* (the
raw value is threaded into `plan.selfNote` for the model path / frontend, never into
the deterministic text). `voiceScan(text)` is the enforceable backstop and is
asserted in the tests; the engine's own copy passes by construction.

## Compose output — returnable, and model-ready

`composeBriefContent` returns:

```js
{
  variant: 'weekly', generatedAt, userName, viewerTier, suppressed, quiet,
  sections: { opening, reasons[], goalAside, teaser, closing },   // for a frontend
  plan:     { userName, planTier, selfNote, items[], goalFollowup, teaser,
              quiet, closingQuestion },                           // compose.js shape
  text:     '…',        // deterministic acknowledge → task → open-door render
  voice:    { ok, violations }
}
```

`plan` is intentionally the **same shape** `src/jobs/brief/compose.js`'s OpenAI
composer already consumes, so wiring a model render later is a one-line graft
(`composeBrief(brief.plan, user)`). We do **not** call the model here — that keeps the
engine deterministic, testable, and inert. `buildFirstBrief` returns the analogous
`{ variant:'first', sections, text, voice, empty }`.

## Read API (what a future surface calls)

```js
await generateBrief(user, { now?, suppressPromo? }, deps?)
//   → composed weekly brief (object above). RETURNED, never sent.

await generateFirstBrief(user, { now? }, deps?)
//   → composed first brief. RETURNED, never sent.
```

`deps` is dependency injection for every read — `gatherInsightSignals`,
`computeInsights`, `isInSuppressionWindow`, `listInterests`, `getLocation` — with
defaults wired to the real services + the insight engine, so the pure stages stay
testable and callers can stub the gather. Both functions enforce the ownership guard
(`user.id` required).

## Not wired to anything

`generateBrief` / `generateFirstBrief` are inert and queryable, like the insight
engine. They are **not** imported by `weeklyBrief.js`, the scheduler
(`src/jobs/scheduler.js`), any route, or any SMS/email send path. The only cross-
module reads are `computeInsights` + `gatherInsightSignals` (insights), the read-only
`isInSuppressionWindow` (safety flag), and `listInterests` — none of them writes.

## Schema

**No structural schema change is required.** Every signal the brief ranks already
exists and is read by the insight engine or the existing gather. `docs/BRIEF.proposed.sql`
records one **optional, unrun** idempotency column that a *future* send wiring would
want (a first-brief marker) — it is not a dependency of this inert engine, and nothing
was run.

## Tests

* `test/brief-engine.test.js` (bundle 11) — pure stages + read layer over
  `briefEngine.js` alone (injected deps): entitlement (free = Core 5 only, Pro =
  everyone), the §6 suppression contract on the insight path, compose determinism +
  voice safety, the self-note "acknowledge without resurfacing" rule, first-brief
  cold start (thin profile reflected, self excluded, real insight surfaced) and the
  honest truly-empty case, `voiceScan`, and the ownership guard.
* `test/brief-engine-wiring.test.js` (bundle 12) — co-bundles the **real**
  `insights.js` and proves the real ranked/entitlement-tagged feed flows end to end
  into the brief: free vs Pro honored, deterministic, with §6 suppression still
  firing on the real path.
* Unchanged and still green: `test/brief-suppression.test.js` (send-path §6),
  `test/sweep-suppression.test.js`, `test/insights.test.js`, `test/voice.test.mjs`,
  `test/safety.test.mjs`.
