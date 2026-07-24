# User-set goals + the vital few (INFRA-15)

The user's standing, self-authored goals: store and read, **unlimited**, plus a
deterministic **vital few** (3–5) focus view. Backend only — service
`src/services/goals.js`, router `src/routes/api/goals.js`, schema
`docs/GOALS.proposed.sql`, proof `test/goals.test.js`.

## Why it extends user_goals (and does not duplicate)

There was already a goals table — `user_goals` — but it models a *different*
thing: the pipeline's weekly reach-out **intentions**, auto-captured from chat
(`memory.addGoal`), tied to a person and a `week_of`, consumed by the weekly
brief's "did you reach out?" follow-up. This feature is the user's **standing
goals**: deliberate, durable, priority-ranked, not weekly, often not about one
person.

Rather than stand up a second store, INFRA-15 extends `user_goals` with an
`origin` partition and reuses the row shape. Two guarantees keep the two
populations from disturbing each other:

| | inferred intention | user-set goal |
|---|---|---|
| `origin` | `cedrus_inferred` (default) | `user_set` |
| `status` (open state) | `open` | `active` |
| `week_of` | the user's local week | `null` |
| written by | `memory.addGoal` (pipeline) | `goals.addGoal` (this API) |
| read by | brief / insights / discovery | `/api/goals` |

**Isolation is load-bearing and by construction.** `memory.getOpenGoals` /
`getOpenGoalsThisWeek` and `relationships.js` filter `.eq('status','open')`.
User-set goals are `'active'`, so those reads never see them — a person-less
life goal can never hijack `getOpenGoals()[0]` in the brief. This service's own
reads filter `.eq('origin','user_set')`. Proven in `test/goals.test.js`
("isolation"). See `docs/FLAGS_FROM_STATION5_GOALS.md` §4 for the one-line lever
if a future product decision *wants* the two merged.

## The vital few (deterministic)

Pareto's few-that-matter: a user may store unlimited goals, but focus is finite,
so the API surfaces the 3–5 that matter most. `selectVitalFew()` is a **pure**
function — same goals in, same few out, no clock / model / randomness — over a
total order:

1. `priority` **descending** (the user's importance signal; default 0)
2. then `created_at` **ascending** (older goals first — you have carried them longer)
3. then `id` **ascending** (final tiebreak, stable to the row)

Take the top `VITAL_FEW_MAX` (5). `VITAL_FEW_MIN` (3) is advisory: `belowFloor`
tells the client the user has room to name more focus goals. It is a hint, never
an error, and never blocks storage.

## API

All routes are behind `requireUser` (Supabase JWT → `req.appUser`). Identity is
token-derived; any `user_id` in a body/path/query is ignored. Ownership: a
foreign, unknown, or malformed id all answer the same `404`.

### `GET /api/goals`
List the user's goals, **most important first** (focus order). Default is active
only; `?status=completed` or `?status=all` widen it.
→ `200 { "goals": [Goal, …] }`

### `GET /api/goals/vital-few`
The deterministic 3–5.
→ `200 { "vitalFew": [Goal, …], "total": 8, "min": 3, "max": 5, "belowFloor": false }`

### `POST /api/goals`
Add a goal (unlimited — the add is the user stating it).
Body: `{ "goal_text": "Run a half marathon", "priority"?: 0–100, "due_at"?: ISO,
"person_id"?: uuid }`. Any other field → `422` (server-owned columns are refused,
not silently rewritten). `person_id`, if given, must be one of the user's own
people.
→ `201-shape 200 { "created": true, "goal": Goal }`

### `PATCH /api/goals/:id`
Edit `goal_text`, re-rank `priority`, change `due_at` / `person_id`, or set
`status` (`active` ⇄ `completed`; completing stamps `completed_at`, reactivating
clears it). Empty or unknown-field patch → `422`.
→ `200 { "updated": true, "goal": Goal }`

### `DELETE /api/goals/:id`
A real delete (distinct from completing).
→ `200 { "removed": true, "id": "…" }`

### Shapes

```
Goal = {
  id, goal_text, priority, status,        // status: "active" | "completed"
  person_id, due_at, completed_at,        // nullable
  created_at, updated_at
}
Error = { error: <code>, message: <warm copy> }
```

Error codes: `401 auth_required`, `403 no_linked_account`, `404 not_found`,
`422 invalid_request`, `500 internal`. `user_id`, `origin`, `week_of`, and
`source_message_id` are server-side and never appear in a response.

## Entitlement

User-set goals are core and **ungated** (free): setting and reading your own
goals is not a Pro feature. If a plan-based cap is ever wanted, it belongs in the
route/service as a plan-derived limit (the storage layer stays unlimited); no
schema change is needed for that.

## Limits / validation

- `goal_text`: non-empty after trim, ≤ 280 chars.
- `priority`: whole number 0–100 (default 0).
- `due_at`: any parseable date; normalized to ISO. Optional.
- `person_id`: the user's own person. Optional.

## Not in this foundation (future)

- Surfacing user-set goals in discovery/brief (the one-line lever in FLAGS §4).
- Sub-goals / milestones, recurring goals, reminders off a goal's `due_at`.
- A plan-based storage cap (see Entitlement).
