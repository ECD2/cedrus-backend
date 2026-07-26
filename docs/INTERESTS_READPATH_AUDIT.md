# Interests read-path audit — the missing-table discovery blocker (Station 7)

## The blocker

The `interests` table does not exist in prod. `INTERESTS_CONTRACT.md` and
`MOUNT_SOURCES.md` describe it as the N5 table created by migration
`20260719120002_interests_foundation.sql`, "already live". That migration is
**not in this repo** (no `*.sql` under it exists beyond the `docs/*.proposed.sql`
review files), and the table is absent in prod — so every read through
`interests.listInterests` errors on a missing relation.

Because migrations here are run by hand at the Supabase ceremony (not tracked as
timestamped files in the repo), the interests foundation was simply never
written as a reviewable `.proposed.sql` — hence the gap. That file is now
provided: **`docs/INTERESTS.proposed.sql`** (reconstructed from the code + the
contract; PROPOSED, not executed).

## Every `interests`-table touch point, and its failure posture

All eight table statements live in one file — `src/services/interests.js` (the
sole reader/writer). The two *consumers* of that service, and their resilience
to the missing table:

| Consumer | Path | Before | Posture |
|---|---|---|---|
| `interests.js` (the API service) | `/api/interests` GET/POST/PATCH/DELETE | throws → route maps to `500 internal` | **unchanged** (see decision 2) |
| `discovery.js` `gatherDiscoverySignals` | discovery plan gather | threw → sank the **whole** plan | **FIXED** — degrades to `[]` |
| `briefEngine.js` `gatherBriefProfile` | first-brief profile | already caught → `[]` | already resilient (the precedent) |
| `importScope.js` | — | n/a | **not a consumer** — `'interests'` is only a `PREFERENCE_KEYS` keyword, never the table |

`briefEngine.gatherBriefProfile` established the house answer to exactly this
problem:

```js
try { const res = await listInts(user); interests = (res && res.interests) || []; }
catch { interests = []; } // a missing interests table must not break the first brief
```

Discovery had no equivalent guard, so the named blocker ("discovery.js's interest
reads throw") was real: `gatherDiscoverySignals` awaited `listInterests` inside a
`Promise.all`, and a missing-relation error rejected the whole gather → a 500 out
of `getDiscoveryPlan`.

## The fix (small, scoped, mirrors the precedent)

`src/services/discovery.js` `gatherDiscoverySignals` now wraps **only** the
interest read in a catch that degrades to `[]`, so goals / people / location
still drive the plan:

```js
const readInterests = async (u) => {
  try { return await getInterests(u); } catch { return []; }
};
// ...Promise.all([ readInterests(user), getOpenGoals(...), ... ])
```

Deliberately scoped:

- **Interests only.** The other four reads (`getOpenGoals`, `getBirthdays`,
  `getAgentContext`, `getUserLocation`) hit long-established tables and keep
  their throw-on-failure behavior — degrading them would hide real outages.
- **Call-site, not central.** The catch lives in the discovery gather, matching
  `briefEngine`. It does **not** change `listInterests` (see decision 2).
- **Pure core untouched.** `computeDiscoveryPlan` stays pure/deterministic; only
  the I/O gather changed.

Proof: `test/discovery-interests-degradation.test.js` (new, owned) — 9 assertions,
all PASS standalone; the existing `test/discovery.test.js` still passes against
the edited file. Registration one-liner: `docs/FLAGS_FROM_STATION7.md`.

## Once the table exists: is any *other* code fix needed? No.

Checked the read-path against the proposed schema — it already matches:

- `listInterests` selects `id, category, label, provenance, surfacing_state,
  last_affirmed_at, created_at, updated_at` and filters `user_id` +
  `surfacing_state` + `category`, ordering by `created_at`. Every column and the
  active-only default exist in the proposed table. ✓
- The re-affirm / raced-insert recovery keys on `(user_id, category,
  lower(label))` and Postgres `23505` — backed by the proposed
  `uq_interests_user_category_label` unique index. ✓
- `confidence` is written (`1.0`) but never serialized (`toPublic` omits it) —
  present in the table, hidden from authenticated SELECT by the proposed grant. ✓

So creating the table (via `INTERESTS.proposed.sql`) is sufficient to unblock the
API and discovery; no further service change is required for correctness.

## Open decisions (flagged for the ceremony / owner — not taken here)

1. **RLS row-ownership predicate.** `interests.user_id = app_users.id`, mapped
   from the JWT via `app_users.auth_user_id` — NOT `auth.uid()` directly (that
   would match nothing and silently empty every browser read). The proposed file
   writes the through-`app_users` form; confirm it mirrors the live
   facts/people/dunbar_tier policies.
2. **Should `GET /api/interests` also degrade to `[]` pre-table?** Today it 500s
   until the table exists. That is arguably the *honest* signal for an ops-time
   missing table, and it keeps the shared service's contract unchanged, so this
   audit did **not** touch `listInterests`. If the dashboard would rather show its
   warm empty state than an error during the window before the ceremony, that is a
   one-line call-site catch in the interests router (or the frontend treating 500
   as empty) — a product call, deliberately left to the owner.
3. **`confidence` range CHECK.** The proposed `CHECK (confidence BETWEEN 0 AND 1)`
   matches the codebase's `clamp01` convention; relax it if the original live
   column was unconstrained.
