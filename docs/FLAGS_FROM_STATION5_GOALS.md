# Station 5 (INFRA-15 goals foundation) → FLAGS for the merge owner

New files only. This station did NOT edit any shared file (src/index.js,
test/run-tests.sh, test/run-all.sh, package.json) or any safety module. The
exact one-line changes those files need are below, for the owner to apply at
merge.

Files added by this station:
- `src/services/goals.js`        — user-set goals service + pure vital-few selection
- `src/routes/api/goals.js`      — /api/goals router (self-carries json + requireUser)
- `test/goals.test.js`           — dependency-free concat-rig proof (71 checks)
- `docs/GOALS.md`                — contract + design
- `docs/GOALS.proposed.sql`      — schema (PROPOSED, not run)
- `docs/FLAGS_FROM_STATION5_GOALS.md` — this file

---

## 1. Route mount — `src/index.js`

Mirror the interests router exactly (self-carries `express.json` + `requireUser`,
so it mounts BEFORE the authed `/api` router).

Add with the other `/api/*` imports (near line 13, beside `interestsRouter`):

```js
import goalsRouter from './routes/api/goals.js';
```

Add the mount BEFORE `app.use('/api', apiRouter);` (beside the interests mount,
~line 45):

```js
app.use('/api/goals', goalsRouter); // INFRA-15: user-set goals CRUD + vital few (JWT, self-carries json+requireUser)
```

Routes exposed (all behind Supabase-JWT `requireUser`; identity is token-derived):
- `GET    /api/goals`            — list (default active; `?status=completed|all`)
- `GET    /api/goals/vital-few`  — the deterministic 3–5 focus set
- `POST   /api/goals`            — add (unlimited)
- `PATCH  /api/goals/:id`        — edit text / re-rank priority / due_at / mark done / reactivate
- `DELETE /api/goals/:id`        — remove

## 2. Test registration — `test/run-tests.sh`

The proof is dependency-free (concat rig). Append this bundle before the final
`printf '\n✅ All test bundles passed.\n'` line (it becomes Bundle 17):

```sh
# ── Bundle 17: user-set goals — pure vital-few selection + store/read layer ──
section "user-set goals"
run_js "$(bundle test/reliability-core.js src/services/goals.js test/goals.test.js)"
```

`test/run-all.sh` runs `sh test/run-tests.sh` as its first step, so no separate
edit to run-all.sh is needed — the goals bundle rides along in the full battery.

Standalone validation done in-session (advisory under parallel load): the bundle
above passes 71/71 under both `bun` and `node`, exit 0.

## 3. Schema — `docs/GOALS.proposed.sql` (apply BEFORE serving traffic)

REQUIRED before POST/PATCH /api/goals can succeed (the route writes these):
- `user_goals.origin text NOT NULL DEFAULT 'cedrus_inferred'`
- `user_goals.priority integer NOT NULL DEFAULT 0`
- `user_goals.updated_at timestamptz`
- `user_goals.week_of` made nullable (route inserts NULL for standing goals)
- `status` CHECK widened to allow `'active'` (if such a CHECK exists)

Idempotent; run through the normal Supabase ceremony. This station ran nothing.

## 4. Integration note — no change needed, one optional lever

`memory.getOpenGoals` / `getOpenGoalsThisWeek` do NOT filter by `origin`. That is
fine and intentional here: user-set goals carry `status='active'`, and those
reads filter `.eq('status','open')`, so user-set goals are **excluded by
construction** — the weekly brief's `getOpenGoals()[0]` follow-up (jobs/brief/
select.js, briefEngine.js) cannot be hijacked by a person-less life goal. Proven
in `test/goals.test.js` ("isolation" section).

IF a future product decision instead WANTS user-set goals to surface in the
brief/insights/discovery, that is a one-line change in the memory.js owner's
file (not made by this station):

```js
// src/services/memory.js getOpenGoals(), to include user-set goals:
//   .in('status', ['open', 'active'])   // instead of .eq('status', 'open')
```

Leave it as-is for isolation (recommended for launch).

---

## CHECKLIST

- [x] Own branch/worktree off cedrus-backend main; clean tree; new files only
- [x] Extended existing user_goals (memory.addGoal/getOpenGoals), did not duplicate
- [x] New goals service + route added; no shared file edited; no safety module touched
- [x] Proposed SQL written in docs/ (.proposed.sql house format, idempotent); nothing run
- [x] Tests added; pass standalone 71/71 under bun + node (advisory)
- [x] `node --check` clean on all new files
- [ ] Owner: apply §1 (mount), §2 (test bundle), §3 (schema) at merge; full-battery re-run
