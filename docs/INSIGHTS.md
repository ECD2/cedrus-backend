# The Insight Engine — contract & design

`src/services/insights.js` computes, **per person**, a ranked list of *insights* —
reasons to reach out or things to know right now. It is the read-side "reason to
reach out" logic. It is READ + RANK only: it never sends, and is not wired into
SMS, the weekly brief, or the daily sweeps. Surfacing/sending is a later, separate
step.

## Signals (all from data the backend already produces)

| Insight `type` | Real signal | Source |
|----------------|-------------|--------|
| `recency` | `days_since_contact` (from `people.last_contact_at`, freshened by the `contact_events` trigger), with `relationship_health_score` as a corroborating booster | `v_agent_person_context` |
| `birthday` | `people.birthday_month` / `birthday_day` | `people.getBirthdaysForUser` |
| `saved_event` | `saved_items.event_date` (upcoming) | `active_saved_items` on the context view |
| `new_fact` | `facts.created_at` of a current fact within a recent window (mood excluded) | `current_facts` on the context view |
| `open_reminder` | a still-`pending` reminder tied to a person, within/just past its window | `reminders` |
| `open_prompt` | an `open` question Cedrus is awaiting an answer to | `pending_prompts` |
| `open_goal` | an intention the user set to reach out to a person | `user_goals` |

The user's own `is_self` person is excluded (you do not reach out to yourself);
archived people are excluded because none of the source reads include them.

## Ranking — deterministic, testable, no model

`computeInsights({ user, context, birthdays, goals, reminders, prompts, now, perPerson, limit })`
is a **pure** function: no DB, no clock of its own (the caller passes `now`), no
model call. Score is a fixed numeric formula:

```
score = BASE[type] + urgency(item, now) + (isCoreFive ? CORE_FIVE_BOOST : 0)
```

Ties break on a fixed order (type rank → name → personId → detail signature), so
the ranking is total and reproducible regardless of input order. `formatInsight()`
is a **separate, swappable** natural-language layer holding no ranking logic — it
can be replaced (or handed to a model) without touching the core.

Tunables (in-file, adjust from real data): recency thresholds
`{ core: 14, regular: 30 }` days, birthday window 14d, saved-event window 30d,
reminder window 14d (+7d overdue grace), new-fact window 14d, `CORE_FIVE_BOOST`
12, `HEALTH_DRIFT` 60.

**Ring priority (tier weighting):** `is_core_five` both *tightens* the recency
threshold (Core 5 flagged as drifting at 14d vs 30d) and *boosts* the score, so
the Inner/Core 5 are watched closest.

## Entitlement — TAG only, never enforced here

Every insight carries `entitlement` (`'free'` for Core 5, `'pro'` for everyone
else) and `gated` (`true` ⇒ requires Pro at the surface). The engine still
computes and tags insights for **all** people; billing enforcement is deliberately
left to the surface. `getInsightsForUser` also returns `viewerTier`
(`free`/`trial`/`pro`) so that surface can apply enforcement against each tag.

## Read API (what the frontend calls)

```js
// The user's ranked feed: top `perPerson` (default 1) per person, ranked,
// optionally capped to `limit`. Each item is entitlement-tagged.
await getInsightsForUser(user, { now?, perPerson?, limit? }, deps?)
//   → { generatedAt, viewerTier, insights: Insight[] }

// Every ranked insight for ONE person (a person page wants all the reasons).
await getInsightsForPerson(user, personId, { now? }, deps?)
//   → { generatedAt, viewerTier, personId, insights: Insight[] }

// Pure core + gather are exported too (for tests / a custom surface):
computeInsights(...)            // deterministic ranking core
formatInsight(insight)          // swappable phrasing
gatherInsightSignals(user, deps)// the 5 reads, injectable
```

`Insight = { personId, personName, isCoreFive, type, score, detail, entitlement,
gated, message }`.

`deps` is dependency injection for the five reads
(`getAgentContext`, `getBirthdays`, `getOpenGoals`, `getOpenReminders`,
`getOpenPrompts`) plus `db`; defaults wire to the real services, so the pure core
stays testable and callers can stub the gather.

## Schema

**No structural schema change is required.** The real last-touch signal already
exists (`people.last_contact_at` → `days_since_contact`, plus
`relationship_health_score`), and every other signal reads an existing
table/view. The only thing in `docs/INSIGHTS.proposed.sql` is a pair of **optional,
unrun** partial indexes for the two new per-person reads (`reminders`,
`pending_prompts`) — a performance nicety, not a dependency. Nothing was run.

## Tests

`test/insights.test.js` (bundle 10 in `test/run-tests.sh`) seeds fixtures and
proves: each signal produces its type, self exclusion, deterministic + correctly
ordered ranking (incl. the tie-break), ring/tier weighting (threshold + boost),
the free/Pro tag, "compute for all", house-style phrasing, and the read-layer
gather → compute wiring.
