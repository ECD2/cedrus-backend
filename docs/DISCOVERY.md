# The Discovery Planner — contract & design

`src/services/discovery.js` turns a user's **profile** (the things they've already
told Cedrus about) into a ranked, capped **plan of directed lookups** that *would*
enrich a weekly brief — the Pro "internet-lookup" feature. It is the **sibling of
`insights.js`**: insights ranks reasons to reach out from *internal* signals;
discovery ranks *external* lookups from the same profile data.

It is **PLAN ONLY**. It never fetches a URL, never calls a model, never sends
anything. It emits *intentions*; a later, separate executor (not built here, not
imported by anything) would run them. Nothing in this module touches the network.

## What a plan item is

Every item names one real thing to look up, why, and where that came from:

```js
{
  type,          // 'sports_schedule' | 'local_event' | 'media_release'
                 // | 'place_context' | 'goal_context' | 'person_occasion'
  subject,       // the real thing to look up ("Kansas City Chiefs", "padel", "Ana's birthday")
  near,          // string | null — a place, populated only for local_event
  why,           // short tag ("followed team", "hobby", "open goal", ...)
  isCoreFive,    // meaningful for person_occasion; false elsewhere
  score,         // deterministic numeric rank
  detail,        // type-specific extras (days-until, provenance, personName, occasion, ...)
  source,        // REQUIRED — traces to the exact real datum (see "No fabrication")
  entitlement,   // 'free' | 'pro'  (tag only, never enforced here)
  gated,         // boolean         (tag only)
  message,       // swappable natural-language phrasing of the intended lookup
}
```

## Signals → plan types (all from data the backend already holds)

| Plan `type` | Real datum | Source read |
|-------------|-----------|-------------|
| `sports_schedule` | interest, category `sports_team` | `interests.listInterests` (active-only) |
| `local_event` | interest, category `hobby` (+ a resolved `near`) | `interests.listInterests` |
| `media_release` | interest, category `media_show` / `media_music` | `interests.listInterests` |
| `place_context` | interest, category `place` | `interests.listInterests` |
| `goal_context` | an open intention, passed **verbatim** | `memory.getOpenGoals` |
| `person_occasion` | a person's upcoming birthday / saved-item date | `people.getBirthdaysForUser` + `getAgentContext` |

Interest categories `food` and `other_freeform` are **deliberately not planned in
v1**: they have no single clean lookup shape, and planning a guess would violate
the no-fabrication rule. Widen `INTEREST_PLAN` when a real lookup shape exists.

Only **active** interests reach the planner (`listInterests` returns active-only
by default), so the per-interest opt-out (`surfacing_state='off'`) is honored by
construction. The user's own `is_self` person is **excluded** — you do not plan a
lookup about your own birthday. Out-of-window dates never appear (birthday window
14d, saved-event window 30d).

### `near` — where a local lookup gets localized

`resolveLocation` fills `near` from the first available source, each fully traced,
never invented:

1. `opts.location` — a place the caller resolved at call time (geo/IP, etc.) → `caller`
2. profile — a future `app_users.home_location` (see `DISCOVERY.proposed.sql`); null
   today, wired forward through the injectable `getUserLocation` read → `profile`
3. the freshest active `place` interest the user follows → `interest_place`

If none exist, `near` stays `null` and the hobby lookup is still planned (just
un-localized) — honest, not fabricated.

## No fabrication — the `source` field

Every item carries a required `source` that traces to the exact datum it came from:

```
interest-derived:  { kind:'interest', interestId, category, label, near?: {kind, value, ...} }
goal-derived:      { kind:'goal',     goalId, personId }
person-derived:    { kind:'person',   personId, occasion:'birthday'|'saved_event', title? }
```

If a datum can't be traced, it is never emitted. An empty profile yields a
strictly empty plan. (Proven in `test/discovery.test.js`.)

## Ranking — deterministic, testable, no model

`computeDiscoveryPlan({ user, interests, goals, birthdays, context, location, now,
limit, maxPerType })` is a **pure** function: no DB, no clock of its own (the
caller passes `now`), no model, no fetch. Score is a fixed numeric formula:

```
score = BASE[type] + urgency(item, now) + (isCoreFive ? CORE_FIVE_BOOST : 0)
```

- `BASE` — `person_occasion` 82, `goal_context` 70, `sports_schedule` 60,
  `media_release` 55, `local_event` 52, `place_context` 46.
- `urgency` — for `person_occasion`, how soon the date is; for interests, a
  provenance boost (`user_stated` +5) plus a freshness bucket off `last_affirmed_at`
  (≤7d +5, ≤30d +3, ≤90d +1), plus a `near` boost (+4) for a localizable hobby.
- `CORE_FIVE_BOOST` 10 — a Core-5 person's occasion ranks up (person items only).

Ties break on a fixed order (type rank → subject → source signature), so the
ranking is **total and reproducible regardless of input order**. `formatPlanItem()`
is a **separate, swappable** natural-language layer holding no ranking logic — it
can be replaced (or handed to a model) without touching the core. House style
(voice spec): warm, brief, no em dashes, no exclamation marks.

### The cap

- `limit` (default **6**) — the global cap; "a brief is enriched by a handful of
  good lookups, not a firehose."
- `maxPerType` (default none) — an optional diversity cap the surface can pass to
  keep one category from dominating; keeps the highest-scored N of each type.

## Safety — spec §6/§7 (a requirement, not a preference)

Discovery **is** the "learn your interests" / Pro-promo track that
`CEDRUS_SAFETY_AND_CRISIS_ESCALATION_SPEC.md` §6 names by hand. So:

- `getDiscoveryPlan` checks `safetyFlags.isInSuppressionWindow(user.id)` **before
  gathering anything**. Inside the 48h crisis-suppression window it returns
  `{ suppressed: true, plan: [] }` — no gather, no plan. (Proven: the suppression
  test wires gather deps that throw, and the empty plan still returns.)
- The check **fails open** (the safetyFlags read returns `false` when its flag
  column is unavailable), exactly as the safety module intends: ordinary product
  keeps working; only this promo layer pauses, and only when the flag is genuinely
  active.
- Per §7, crisis content is never enriched. The planner only reads interests,
  goals, and upcoming dates, and it never executes a lookup — so nothing sensitive
  is ever sent anywhere. Per-item *content* classification (e.g. a goal whose text
  is sensitive) is a future gate, noted but out of scope for this inert planner.

## Entitlement — TAG only, never enforced here

The internet-lookup enrichment is the Pro feature, so items are tagged
`'pro'`/`gated` — **except** a Core-5 person's upcoming occasion, which stays in
the free tier's "your inner circle's moments" promise (`'free'`/ungated),
consistent with `insights.js`. The planner still computes and tags **every** item;
billing enforcement is deliberately left to the surface. `getDiscoveryPlan` also
returns `viewerTier` (`free`/`trial`/`pro`) so the surface can enforce against each
tag.

## Read API (what a future surface calls)

```js
// The user's ranked discovery plan: directed lookups that would enrich a brief,
// ranked and capped (default 6). Empty + suppressed inside the §6 crisis window.
await getDiscoveryPlan(user, { now?, limit?, maxPerType?, location? }, deps?)
//   → { generatedAt, viewerTier, suppressed, plan: PlanItem[] }

// Pure core + gather are exported too (for tests / a custom surface):
computeDiscoveryPlan(...)              // deterministic planning core
formatPlanItem(item)                   // swappable phrasing
gatherDiscoverySignals(user, opts, deps) // the reads + location resolution, injectable
planTier(user)                         // free | trial | pro
```

`deps` is dependency injection for every read — `getInterests`, `getOpenGoals`,
`getBirthdays`, `getAgentContext`, `getUserLocation`, `isInSuppressionWindow`
(plus `db`); defaults wire to the real services, so the pure core stays testable
and callers can stub the gather. **Imported by nothing** — this module is inert
until a surface chooses to call it.

## Schema

**No structural schema change is required.** Every datum the planner reads already
exists (`interests`, `user_goals`, `people.birthday_*`, `saved_items` via
`v_agent_person_context`). `docs/DISCOVERY.proposed.sql` holds two **optional,
unrun** items: a forward-looking `app_users.home_location` column (so `near` can be
localized without a `place` interest) and a partial index matching the active-
interest read. Neither is a dependency; the planner already falls back gracefully.
**Nothing was run.**

## Tests

`test/discovery.test.js` (bundle 13 in `test/run-tests.sh`) seeds fixtures and
proves: each mapped category / goal / person-date produces its type; unmapped
categories, out-of-window dates, and self are absent (no fabrication);
deterministic + tie-broken ranking; the global + per-type caps; source-tracing;
empty-profile → empty plan; the free/Pro tag; house-style phrasing; the read-layer
gather → resolve-location → compute wiring; and the §6 suppression gate short-
circuiting before any gather. Runs dependency-free under bun/node/jsc.
