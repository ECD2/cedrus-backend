# CEDRUS — OPERATING DOCTRINE

**Read this file at the start of every session, before doing anything else.**

This is the standing context for all Claude Code work on Cedrus. It holds how Emil works, the
rules that don't bend, the mistakes we've already made and how we caught them, and the verified
facts about this environment that sessions keep re-deriving wrong.

If you are about to diagnose a problem, **check Part 4 and Part 5 first** — there is a real chance
we have already seen it, already been wrong about it, and already written down the answer.

Last updated: 2026-07-27 (autonomous run).

---

## PART 0 — HOW TO USE THIS FILE

**At session start:** read it in full. It is not long relative to the cost of repeating a mistake
in it.

**When you hit a bug:** search Part 5 (Lessons) and Part 6 (Verified Environment Facts) before
forming a hypothesis. Several failures in this codebase look like one thing and are another.

**At session end:** if you learned something durable — a new failure mode, a corrected fact about
prod, a proof technique that worked — append it. Say plainly what you changed. A lesson that
isn't written down will be re-learned at full price.

**If this file contradicts what you observe:** the observation wins, and the file is wrong and
must be corrected in the same session. A stale doctrine file is worse than none, because it
produces confident wrong answers. This has already happened once (a session recorded `interests`
as missing after the migration created it, and corrected its own note).

---

## PART 1 — HOW EMIL WORKS

Emil is a non-engineer solo founder building by conversation plus Claude Code. Adapt to that.

- **Plain English.** No jargon-first explanations. Say what happened, then what it means.
- **One thing at a time when debugging.** Do not present five hypotheses. Investigate the most
  likely one, report, then move.
- **A recommendation, not a menu.** If there are options, cost them honestly and then say which
  one you'd pick and why. "Your call" without a recommendation is work handed back.
- **Complete, copy-paste-ready prompts.** If the next step needs a new session, write the whole
  prompt. Don't describe what the prompt should say.
- **Celebrate real wins, then recenter.** Say what actually landed, then what's still open.

### Everything runs through Claude Code

This is the strongest preference and it is close to absolute.

- **Do not send Emil to a dashboard, SQL editor, or terminal to hand-run something.** If it can be
  done from a session, do it from the session. Railway CLI, the migration runner, direct pg
  access, log reads, env inspection — all of it is set up so he doesn't have to.
- **Do not hand back raw terminal commands** for him to paste. He runs and monitors sessions from
  his phone. Write the work as a session prompt; the agent runs the bash.
- **Exceptions are the irreversible actions only** — pushes, deploys, and anything the rules below
  reserve for him.

### The downloads workflow

When Emil is given a file (a doc, a config, a script, a spec), he downloads it to `~/Downloads`
and nothing more. He does not move it, rename it, or place it.

**A session is expected to go find it.** Look in `~/Downloads`, identify the right file (usually
the most recent match by name or content), confirm what it is before acting, and place it in the
correct repo and path. Then report where it landed. If several files could match, say which ones
you found and ask — don't guess and don't dump it in the repo root.

### Session model policy

- **Opus by default** for everything. That's his Max plan default.
- **Fable is reserved for a genuine reasoning wall.** Flag it explicitly before spending one.
  Budget is roughly 5/week and near-zero used.
- **Sonnet for trivial relay only.**

### The boardroom / build split

Chat is the **boardroom**: verdicts, gating, "should we?" decisions, and writing session prompts.
All building happens in **Claude Code sessions**. The boardroom gates every merge; only Emil
pushes. Sessions STOP before push and return a report.

---

## PART 2 — THE LAWS

These do not bend. If an instruction conflicts with one, say so rather than following it.

1. **STEP 0 is always a worktree check.** Isolated git worktree per piece of work. Confirm repo,
   branch, clean tree, and the commit you're branching from. STOP if anything is wrong.
2. **Never touch the safety modules.** `safetyDetection.js`, `safetyFlags.js`, `voiceGuard.js`.
   The safety suite must stay green on every merge, no exceptions.
3. **The full battery re-run on MERGED main is the real gate.** `sh test/run-all.sh`. In-session
   results are advisory. A battery that passed before the merge proves nothing about after it.
4. **One merge at a time.** Never batch. Battery between each.
5. **STOP before push. Only Emil pushes.** No deploys, no migrations without explicit go.
6. **BOTH repos deploy on push. There is no "safe" repo.** cedrus-frontend is on Lovable, and the
   cedrus-backend Railway service is **repo-linked to `ECD2/cedrus-backend`** — pushing `main` in
   EITHER repo ships to users. Verified 2026-07-26: a backend push auto-built and was live in
   production in ~50 seconds, with no separate deploy step. This law previously said only
   "frontend push = live deploy", which wrongly implied the backend was safer. Treat every merge
   to main, in either repo, as a release — and note a DB view/migration is even more immediate
   than that: it changes live behaviour with no deploy at all.
7. **`.env.production` is sacred.** 3 lines, sha256 starts `6b2955d3` ends `549cd5`. Byte-check
   before and after any frontend work, and again after any build step.
8. **Migrations run through the runner**, never by hand:
   `node ~/.config/cedrus/migrate/run-migration.mjs <ddl.sql> <table>`. Additive idempotent DDL
   auto-runs. Anything touching existing DATA shows the plan and waits for Emil.
9. **Disjoint file ownership for parallel work.** Shared files (`src/index.js` route mounts,
   `test/run-tests.sh` registrations) are never edited in parallel — they're noted in a
   `docs/FLAGS_FROM_*.md` and wired at merge time by the merging session.
10. **Diagnose from the logs and the database.** Not from files. See Lesson 2.

---

## PART 3 — WHAT COUNTS AS PROOF

A green test suite is not proof. Proof is specific to what changed. Match the evidence to the
claim.

| Change type | What actually proves it |
|---|---|
| **A route mount** | A real request through the real booted server returning 200, against an **unmounted control path** returning 404 — plus a router-specific discriminator (an error string or response shape that exists only in that router). |
| **A schema migration** | A post-check reading live prod: object exists, constraints as intended, grants scoped, row count as expected — and the user-facing symptom demonstrably gone. |
| **A data write** | Row counts asserted before, inside the transaction, and after. Every other row diffed to prove it didn't drift. |
| **A prompt change** | A live model call against the real configured model, on the exact input that produced the bug. Nothing in the test battery exercises prompts. |
| **A parsing/format fix** | Before/after on the real reported inputs, showing old behavior and new behavior side by side. |
| **A filter added to a shared query** | A regression run proving existing consumers see exactly the rows they saw before — with a guard that fails if the fixture returns nothing. |
| **Graceful degradation** | Reproduce the actual failure condition (real SQLSTATE, real missing relation) and show the code surviving it — plus a test proving the catch isn't over-scoped. |
| **Replacing a view** | The dependent views still exist and still return rows; the output column list is byte-identical (names, types, order); the branch you did NOT mean to change is byte-identical in `pg_get_viewdef` before and after — that sibling branch IS the control; and the new values are hand-verified against their inputs, not just "non-null". Capture the verbatim prior definition as a rollback artifact FIRST. |
| **A new test / regression guard** | **Revert the fix and show the suite goes RED**, then restore it. A test written against already-fixed code has never once been observed to fail, so its passing carries no information. Quote the mutation run's exit code. (Cheap: copy the file, revert, run, restore — under a minute.) |
| **Arming a previously-inert guard** | Drive the REAL module against real prod through all three states — off, ON, and expired — **plus a control proving the "off" answer now comes from the healthy path and not the broken one.** For a boolean guard the two look identical, so reproducing the OLD failure signature side by side is the only thing that separates them. Then enumerate every consumer and confirm none of them can now break. |

**The universal rule: run the control.** Whatever you think proves your claim, ask what result you
would get if the claim were false. If it's the same result, you have no proof. This has caught
false proofs three separate times in one day.

---

## PART 4 — VERIFIED ENVIRONMENT FACTS

Established against live prod. Do not re-derive these from files; if you must re-verify, verify
against the database or a real request, and update this section if reality has moved.

**Auth and routing**
- `app.use('/api', apiRouter)` is a catch-all that **runs auth before route matching**. Every
  path under `/api` returns 401 unauthenticated, mounted or not. **A 401 proves nothing about
  whether a route is mounted.** Use a 200 vs an unmounted-control 404 instead.
- Route mounts go in `src/index.js` **before** the catch-all.

**Dates and timestamps**
- `toTimestamptz()` in `memory.js` is the single parsing boundary for all model-fed timestamps.
- It **deliberately anchors a bare `YYYY-MM-DD` to 12:00Z** so the calendar day survives every US
  timezone. Noon UTC in the data is correct, not a bug.
- Unparseable date → `null`, and the item still saves. `reminders.trigger_at` is NOT NULL, so a
  bad time skips **that reminder only**.
- Frontend `formatShortDate` handles null. A bare date-only string would render a day early in
  negative-offset zones — currently protected by the noon anchor.

**Tooling**
- `run-migration.mjs` takes **one** argument (`<path-to.sql>`). An older note said `<ddl.sql>
  <table>`; the second arg is read by nothing. Corrected 2026-07-26.
- **`run-migration.mjs` cannot parse a schema-qualified `ALTER TABLE`.** Its regex captures
  `([A-Za-z_]\w*)`, so `ALTER TABLE public.app_users` makes it verify a table literally named
  `public` — the in-txn check then fails and it ROLLS BACK. It **fails closed**, so nothing lands
  and nothing is corrupted, but the migration silently does not apply. **Write table names
  unqualified**, as every prior `docs/*.proposed.sql` does. (Verified by hitting it, 2026-07-26.)
- **`run-migration.mjs` CANNOT verify a `CREATE OR REPLACE VIEW`.** A view replacement declares no
  CREATE TABLE / ADD COLUMN / CREATE INDEX, so `parseObjects` returns three empty lists, the in-txn
  loop iterates nothing, and it prints "all declared objects present" — then COMMITs. It applies
  the change and vouches for nothing. Write a purpose-built script (see
  `~/.config/cedrus/migrate/apply-days-since.mjs` for the pattern: pre-check → BEGIN → apply →
  in-txn asserts incl. a control → COMMIT/ROLLBACK → fresh post-check).
- **`CREATE OR REPLACE VIEW` keeps dependents intact** as long as the output column list is
  unchanged (or only appended to). `v_agent_person_context` sits on top of `v_people_for_agent`;
  replacing the latter did not require dropping the former. Verified in-transaction 2026-07-27 —
  assert it, don't assume it.
- `run-migration.mjs` parses **only DDL objects** (CREATE TABLE / ADD COLUMN / CREATE INDEX).
  **Never feed it a data write.** It would run the UPDATE inside its transaction while pre-check,
  in-txn verify, and post-check all iterate empty lists and print "all declared objects present"
  having verified nothing. Write a data-write script with real row-count assertions instead.
- `test/run-tests.sh` is a **concat rig**: it strips imports and depends on concatenation order.
  Tests using real ESM imports or `mock.module` cannot run under it — register those in
  `run-all.sh` instead. `run-all.sh` invokes `run-tests.sh` first, so either way they execute
  inside the one gating battery.
- **Bundle numbers in use: 17 (model-timestamps), 18 (interests), 19 (goals), 20 (§6 suppression
  read), 21 (quota reads), 22 (crisis vs pre-model short-circuits), 23 (relationships writes),
  24 (memory silent failures), 25 (consent audit trail).** Next free: **26.** Station docs have claimed already-taken numbers more than once —
  check `test/run-tests.sh`, don't trust.
- **The concat rig can host failure-branch tests — but not with `reliability-core.js`.** Its fake
  Supabase is a working in-memory DB: it always resolves `{ error: null }` and can never throw, so
  it cannot drive an error path. It also declares `const supabase`, so you cannot add your own
  alongside it. For a suite that needs a *programmable* seam, write a dedicated prelude declaring
  its own `supabase` / `logger` / `makeChecker` and skip `reliability-core.js` entirely
  (`test/prelude-suppression.js` is the worked example; Bundle 16 set the precedent). This is
  usually better than reaching for `mock.module`, which forces the suite out of the rig and into
  `run-all.sh` and needs bun.
- `run-all.sh` deliberately excludes the live extraction eval; it needs `OPENAI_API_KEY` and makes
  real paid calls. **Zero battery suites exercise the extraction prompt.**

**Data model**
- Reminder delivery state is the linked `messages.provider_status`, **not** a column on
  `reminders`.
- `user_goals`: `week_of` is NOT NULL (a `date`); `user_goals_status_check` allows only
  `open / completed / missed / canceled`. `origin` defaults to `'cedrus_inferred'`; user-set goals
  use `'user_set'`. Isolation between the two populations is enforced by **`origin`**, not status.
- `getOpenGoals` orders `week_of DESC`, and **Postgres defaults to NULLS FIRST on DESC** — a NULL
  `week_of` row sorts to position `[0]`, which `briefEngine` quotes verbatim into the weekly brief.
  NULL `week_of` + `status='open'` is a hijack scenario. Always stamp `week_of`.
- `getOpenGoals` feeds **three** consumers: `jobs/brief/gather.js`, `services/insights.js`,
  `services/discovery.js`. Changing it is never local.
- `app_users.id` is a uuid. `u_c6cf9fb9` in logs is a **truncated log label** (`'u_' + user.id`),
  not a text primary key.
- `discovery.js` has **no importers in `src/`** — it is the inert Pro planner. Hardening it
  protects a path that isn't live yet.
- Frontend `createInterestsClient` (`src/lib/cedrus/interests.ts`) still returns a **localStorage
  mock**. That file is the single wiring point to the real endpoint.

**Supabase client behaviour — the single most load-bearing fact in this file**
- **`supabase-js` does NOT throw on a database error.** It resolves `{ data, error }`. Verified
  2026-07-26: **45 of 101 `supabase.from()` call sites in `src/` never bind `error`.** Each is a
  place where a DB failure yields no exception, no log, and a plausible return value.
- **Corollary that has already bitten us:** a `try/catch` wrapped around a service function that
  doesn't check `error` is **decorative — it can never fire.** `07_persist.js:97` wraps
  `rel.logContact()` this way — still true after the 2026-07-27 sweep, which added logging but
  deliberately did NOT start throwing. Before trusting any catch on a write path, confirm the
  callee actually converts `error` into a throw.
- Which write paths genuinely **throw**: `memory.js` `addFact` / `addSavedItem` / `addReminder` /
  `addGoal` (the post-incident fix, and it works). Everything else resolves.
- **Sweep progress (flag 14).** Eight call sites hardened as of 2026-07-27; the crude bind-count
  moved 56 → 60 of 101. None changed control flow — they still resolve, they just say so now:
  `usage.js` `getMessageQuota`/`getNudgeUsage` → `quota.read.failed`; `relationships.js`
  `logContact`/`linkMessagePerson` → `relationships.write.failed`; `memory.js` supersession
  `.update()` → `facts.supersede.failed`; `memory.js` `getOpenGoals`/`getOpenGoalsThisWeek` →
  `goals.read.failed`; `consent.js log` → `consent.write.failed`. Bundles 21, 23, 24, 25, each
  mutation-checked. **~41 sites remain**, mostly in `people.js` and `users.js`.
- **`test/stubs.js`'s logger now carries `event`** — bundles 1/15/17 concatenate the real
  `memory.js`, so any new `logger.*` method used there must be added to that stub or those three
  bundles break. Same trap applies to `reliability-core.js`, which declares **no logger at all**.
- **Next sweep candidate and its obstacle:** `briefEngine.js:355` (`catch { interests = [] }`,
  whose comment still claims the interests table might be missing — it exists). `briefEngine.js`
  does **not import logger**, and its two bundles (11, 12) use `reliability-core.js`, which
  declares no logger. Hardening it means editing a shared prelude used by ~14 bundles — wider than
  the sweep recipe covers. Deliberately deferred 2026-07-27.

**Contact tracking and the person panel** (verified live 2026-07-26)
- `contact_events` **ARE** written on the saved-item path — Flag 3's premise was wrong. Written by
  `relationships.js:12` from `07_persist.js:99`, gated on the model's `contact_signal` being one of
  `explicit_contact / confirmed_contact / implied_contact`. The DB trigger correctly freshens
  `people.last_contact_at`.
- **`people.contact_frequency_days` has no writer anywhere** — not backend, not frontend, no column
  default, 0 of 4 prod rows populated.
- `v_people_for_agent.days_since_contact` was NULL-gated on **`contact_frequency_days`**, a field
  it does not need. **FIXED IN PROD 2026-07-27** — that one condition removed from the days-since
  branch only. Both Lucas now read `days_since_contact = 2`, hand-verified. Artifacts:
  `docs/DAYS_SINCE_CONTACT.proposed.sql` and `.rollback.sql` (verbatim prior definition).
- **`relationship_health_score` is STILL NULL for every person, and that is CORRECT.** Its guard on
  `contact_frequency_days` is load-bearing — the field is its denominator
  (`NULLIF(contact_frequency_days * 2, 0)`). It was deliberately not touched. The health bar and
  the "drifting" pill therefore stay hidden, and the backend drift nudge / drift brief moment stay
  dormant because both `gate on relationship_health_score == null → continue`, NOT on days-since.
  The real remaining gap is that **nothing ever sets `contact_frequency_days`** — see flag 19.
- **What the days-since fix woke up** (Lesson 7 enumeration, all verified by reading the consumers):
  person-panel "Last touch" now shows a real value; `insights.js` **recency** insights can now fire
  for the first time (core ≥14d, regular ≥30d) and flow into the weekly brief and `/api/insights`;
  frontend `today.ts` drift moments can now fire (≥45d); `people.ts` row subtitle "no word since
  {month}" can now appear (≥45d). Nothing treated NULL as an affirmative signal — every consumer
  read it as "no data, skip" — so these are the features working for the first time, not
  regressions. Backend drift nudges are NOT among them (health-gated, still dormant).
- The two person panels read **different tables, and both are authoritative for what they show**:
  WHAT CEDRUS KNOWS → `facts` (`is_current=true`); SAVED FOR LATER → `saved_items`
  (`is_current=true`, `status IN ('active','surfaced')`). A dinner logged as an *event* lands in
  `saved_items` and produces **no** `facts` row — so "Nothing saved yet" above a populated saved
  list is accurate copy, not a bug.
- `app_users.crisis_suppressed_until` — **CORRECTED same day.** It did not exist when the census
  ran (39-column dump, 2026-07-26 ~19:20), which is why `safetyFlags.js` had been inert since it
  shipped. **It EXISTS as of 2026-07-26 ~23:30**: `timestamptz`, nullable, no default, added by
  `docs/SAFETY_SUPPRESSION_COLUMN.proposed.sql`. The §6 cooldown is now armed and proven end to
  end against prod. **Schema-only — no code change was needed**, and `safetyFlags.js` was not
  touched (Law 2).
- Arming it enforces suppression in **six** live consumers: `dailySweeps.js:31`,
  `weeklyBrief.js:37` + `:117`, `briefEmail.js:212`, `briefEngine.js:310`, `pipeline/index.js:133`
  (`discovery.js:396` is inert). **Every one of them only REMOVES optional content** — playful
  nudges, Pro teasers, clarification re-asks. None blocks a core function or can throw. That is
  why flipping this switch was safe, and it is the enumeration Lesson 7 demands before arming any
  inert guard.
- `app_users` carries `trg_app_users_updated_at` (BEFORE UPDATE → `set_updated_at()`). **Any write
  bumps `updated_at`, so a write test can never restore the table byte-for-byte.** Nothing in
  `src/` reads `app_users.updated_at`. Don't try to forge it back — that needs a trigger disable
  on a live table, which is riskier than the drift.
- ~~No test anywhere imports the real `safetyFlags.js`~~ — **fixed the same day.** Bundle 20
  (`test/suppression-read.test.js`) is the first suite to exercise it. Every OTHER suite still
  injects its own `isInSuppressionWindow` stub, so coverage of that module is Bundle 20 and
  nothing else: if you change `safetyFlags.js`, that bundle is the only thing standing under you.

**Rings, cadence, and the proactive layer** (established read-only 2026-07-27, flag 19 design pass)
- **The ring selector is cosmetic today.** `dashboard.tsx:335` writes `dunbar_tier` +
  `dunbar_tier_source='manual'`, and **`dunbar_tier` has ZERO references anywhere in the backend
  `src/`.** Nothing reads it. The UI copy "Where someone sits sets how often Cedrus checks in about
  them" is not true in any functional sense.
- ~~`is_core_five` has no writer either~~ — **WRONG, corrected 2026-07-27.** `is_core_five` HAS a
  live writer: the `set_priority_people(target_user_id, priority_person_ids, max_priority,
  selection_source)` RPC (exists in prod, EXECUTE to service_role only), called by
  `prioritySwap.js` from `POST /api/priority/swap`. The earlier claim came from grepping for
  `update|insert`, which misses an `.rpc()` call — **grep for `.rpc(` too when hunting writers.**
  The real gap is that **the frontend never calls that endpoint** (zero references to
  `priority/swap`), so the writer exists and is unreachable from the UI.
- `coreFive.js:recomputeCoreFive()` IS a `throw new Error('TODO')` stub, but it is the *auto*
  fallback, not the primary path. **The throw is unreachable:** `runMonthlyCoreFive()` has its
  import commented out and its body is only `logger.info('...not yet implemented')`. So the
  `0 3 1 * *` cron has never failed — it succeeds at doing nothing. `trialDowngrade.js` is the same
  shape, EXCEPT the downgrade itself is live and will flip both trials to `free` on Aug 6/8.
- **Two disconnected notions of "the five".** `dunbar_tier` ('core'|'close'|'meaningful'|'network')
  is written by the ring UI and has zero backend readers. `is_core_five` is what every backend
  free-tier gate gets read from, and what the frontend maps to `isPriority` (`data.ts:82`).
  `mapPerson` produces `circle` and `isPriority` from these two independent fields, and nothing
  keeps them in sync — so dragging someone into "Inner 5" sets `dunbar_tier='core'` and leaves
  `is_core_five` false, and the app's own `isPriority` does not reflect the ring just chosen.
- **Nothing in the proactive layer sends SMS today.** `BRIEF_DRY_RUN=true` on Railway, and ALL
  THREE outbound paths honour it: `weeklyBrief.js:77`, `dailySweeps.js:54`, `reminders.js:100`.
  The only real outbound SMS is the synchronous TwiML reply to an inbound message. Arming the
  proactive layer therefore takes TWO independent switches — populate `is_core_five` (decides what
  content is selectable) AND set `BRIEF_DRY_RUN=false` (decides whether anything is sent). Neither
  alone puts a message on the wire. Note briefs still make their OpenAI call under dry-run.
- **Consequence nobody had filed: on the FREE plan the proactive layer is entirely dead.**
  `v_people_for_agent.proactive_enabled` is `plan=pro AND active` → `plan=trialing AND not expired`
  → `is_core_five` → `is_self` → else false. A free, non-trial user has no pro branch and
  `is_core_five` is always false, so every person evaluates to `proactive_enabled = false`. Both
  current prod users are `trialing` (to 2026-08-06 / 08-08), so this is masked right now and will
  surface the moment a trial lapses. See flag 22.
- So the chain is dead in **four** independent places: ring not read → `is_core_five` never set →
  `contact_frequency_days` never set → `relationship_health_score` NULL → both drift paths skip.
  Fixing any one alone changes nothing.
- **Health-score formula** (from `v_people_for_agent`):
  `clamp(0..100, round(100 − days_since / (2 × contact_frequency_days) × 100))`. So 100 at 0 days,
  50 at exactly one cadence, 0 at two. Drift (`< 60`) therefore fires at **0.8 ×** cadence and
  urgent (`< 40`) at **1.2 ×**. Two quirks worth knowing before relying on it: it flags drift
  *before* the cadence has actually elapsed, and it saturates at 0 by 2 × cadence, so someone 10 ×
  overdue ranks identically to someone 2 × overdue in the nudge priority (the frontend re-sorts by
  `daysSinceContact`, the backend does not). `NULLIF(freq * 2, 0)` also means a cadence of **0**
  silently disables health for that person rather than erroring.
- **All four prod people are `dunbar_tier='network'`** with `source='auto'`. Under the recommended
  tier→cadence mapping (network ⇒ no cadence) that means a cadence rollout would activate for
  **nobody** until Emil actually sorts people into rings — the safest possible arming path.

**Spend, quotas, and the crisis ordering**
- **`checkRateLimit()` is the ONLY per-user spend ceiling in the application.** It fronts the one
  OpenAI call on both the inbound SMS path (`pipeline/index.js:97`, STAGE B3) and web capture
  (`capture.js:154`). Free cap is 20 inbound/day (`v_message_quota`).
- **Nothing reads `v_daily_token_usage` or `v_daily_sms_usage`** — the cost views exist and have
  zero consumers in `src/`. There is **no alerting, no budget guard, and no automatic kill switch**
  anywhere in the backend (`config.enableJobs` is a manual global switch for jobs only). The real
  backstops are OpenAI's and Twilio's own account-level limits, which live outside this repo —
  verify them in those dashboards, don't assume the code has you covered.
- **The Priority 0 crisis gate lives INSIDE `understand()` (STAGE C).** The comment in
  `05_understand.js` about crisis "short-circuiting earlier" means earlier *within* `understand()`,
  not earlier than anything in the pipeline. Every early return above STAGE C therefore bypasses
  crisis detection entirely. **This still decides the fail-open/fail-closed question for every
  quota guard on the inbound path: failing closed can answer a crisis message with a cap message.**
- **STAGE B2.5 (added 2026-07-26) is the fix.** `const crisisOverride = evaluateSafety(body).action
  === 'crisis'` — pure, no model, no I/O — sits after compliance and gates the `needsFreshStart`
  and STAGE B3 short-circuits. It deliberately builds NO reply: the crisis response is authored in
  exactly one place, `understand()`'s gate, which re-runs the same pure function. Scope is
  `'crisis'` only, NOT `isSafetyOverride()` (which also covers the substance `'boundary'`).
- **The exemption cannot buy model calls.** The predicate that skips the cap is the same predicate
  that makes `understand()` short-circuit pre-model, so a bypassed message can only ever cost one
  fixed-template SMS. Bypass-scope and no-model-call are one condition, not two that could drift.
- **`evaluateSafety()` is free enough to run anywhere.** `safetyDetection.js` has **zero imports**,
  zero `async`, 457 lines of regex. Measured 2026-07-26: **5.94 µs** on a typical SMS, 2.39 µs on a
  crisis hit (early exit), 78 µs at 1600 chars, 5.7 ms at the 100kb express limit. **Scaling is
  linear — no catastrophic backtracking**, so it is safe to run on untrusted input before a rate
  limit. For scale, the OpenAI call it protects takes 1–3 seconds.
- The third pre-cap early return, `loneName`, is **not** reachable with crisis text — verified: a
  crisis phrase never matches `bareName()` and a bare name never trips the detector. Bundle 22
  asserts this so it stays true.
- STOP/START/HELP (STAGE B2) still outrank the crisis pre-check, deliberately — opt-out is a legal
  obligation. Note the carrier-mandated `HELP` reply is compliance boilerplate, which is what
  someone texting "HELP" in distress receives. Not currently changeable.
- Both quota reads now emit `quota.read.failed` (`error_category: 'db_error'`,
  `outcome: 'fail_open'`, `error_code`) on error OR missing row; healthy reads stay silent. The
  views are `... FROM app_users u`, so a missing row means the id isn't a user — abnormal in itself.
- `sweeps/eligibility.js:22` guards with `if (budget && ...)`, so a nullish budget **skips the
  weekly nudge cap entirely** rather than clamping it. Fail-open there too, now announced.
- A *thrown* quota read was never silent — it propagates to the `routes/sms.js:41` catch and logs
  `sms.pipeline.error`. Only the `{ data, error }` path was invisible.

**Config**
- `NODE_ENV` must be set to `production` on the Railway backend service. `assertSecureBoot()`
  gates its hard failures on it; unset means several checks silently downgrade to warnings or
  emit nothing at all. **Verified set to `production` 2026-07-26**, alongside
  `VALIDATE_TWILIO_SIGNATURE=true` and `PUBLIC_BASE_URL`. The guard is armed again — but it still
  cannot announce which mode it ran in, so Lesson 7 stands.
- **The `run-all.sh` false-pass trap — measured 2026-07-26.** The script prints
  **"ALL WS-B SUITES PASSED" at line 1096 of 2404 — 46% of the way through — with THIRTEEN more
  suites still to run** (CORS, N1 admin panel, N3 web API, WS-F email ×3, admin auth, web
  onboarding, import, interests, insights, reminders). `set -e` protects the exit code, so the
  gate itself is sound. But the banner is a mid-run status line for one workstream, not a verdict.
  **Gate on `echo $?` — never on that line, and never on eyeballing the tail.** A session that
  greps for "PASSED" and stops reading will report a green battery it never observed. There is a
  second banner, "ALL BATTERY SUITES PASSED", at the true end; even that is weaker proof than the
  exit code.
- **When you cross-check the log, grep `^  FAIL`, not `FAIL`.** A bare `grep -c FAIL` matches
  prose — a section heading reading "still FAILS OPEN" made an all-green run report a failure
  (2026-07-26). The assertion prefix is two spaces + `FAIL`; `TEST(S) FAILED` is the other real
  marker. Corollary: **never put the token `FAIL` in a test's section heading.**

---

## PART 5 — LESSONS (THE DISEASES)

Each one is a real incident. The rule is the takeaway; the story is why it's believable.

### 1. Catch → warn → continue is a disease

**Incident.** Every SMS was silently failing to persist. `persist` caught per-item errors, logged
`String(err)` — which renders as `[object Object]` — and continued. Meanwhile the model-authored
reply said *"Got it, added that to Luca."* The user got a confirmation; nothing was written.

**Rule.** A swallowed error is worse than a crash, because it produces confident false success.
Every catch in a write path logs `err.message`, `err.code` (SQLSTATE), `err.constraint`, and
`err.detail`. **Never `String(err)`.** And a reassuring user-facing message must never be emitted
on the assumption that a write succeeded.

**Generalization.** Any mechanism that can fail silently will eventually fail silently and cost a
day. Look for this shape everywhere: guards that don't run, filters that match nothing, checks
that iterate empty lists.

### 2. Files lie. The database doesn't.

**Incident.** Three consecutive confident diagnoses of the same bug, all wrong. (a) A stale
`pending_clarifications` row — there were zero active rows. (b) The `pending_clarifications` table
doesn't exist in prod — it existed with 19 columns and resolved rows. That second one was
"confirmed three independent ways": no migration file, absent from generated types, and a
`-- NOT EXECUTED` header. All three were **stale artifacts of the same blind spot** — migrations
now run through a runner that doesn't write to the migrations folder, and the type snapshot
predated the ship.

**Rule.** Migration folders, generated type files, and comments in SQL files are **not** evidence
about prod. Query the database. `SELECT to_regclass('public.<table>')` settles existence in one
line.

**Corollary.** Three pieces of evidence that share a common cause are **one** piece of evidence.
Ask what would have to be true for all of them to be wrong together.

### 3. A green result is guilty until proven innocent

**Incidents, three in one day.**
- A `401` on `/api/insights` was about to be reported as proof the route was mounted. The control
  — an *unmounted* path — also returned 401, because the catch-all authenticates the whole prefix.
- A regression check returned "identical" for both scenarios because the fixture rows lacked
  `user_id`, so the filter excluded everything and the comparison was vacuously true.
- A boot log with zero warnings was about to be read as "all security checks pass." Three of the
  four checks emit nothing at all when the guard is disarmed. Silence carried no information.

**Rule.** Before reporting a pass, ask: *what result would I see if this were broken?* If the
answer is "the same result," you have no proof. Run the control. Add a guard that fails loudly if
the fixture is empty.

### 4. A test can encode a falsified belief and never expire

**Incident.** Station 5's isolation test filtered on `status` alone and asserted only the inferred
row came back. That test encoded a claim we had just proven false. Left alone, it would have sat
in the suite forever as green evidence for a wrong belief. A second test used `'open'` as its
*invalid* status value — which had become valid, silently turning the assertion meaningless.

**Rule.** When you change a mechanism, **audit the tests that assert the old mechanism.** A test
that passes for the wrong reason is worse than a missing test. When a constant changes value,
grep for every assertion that depends on its old meaning, not just its old name.

### 5. Fixing the code does not fix the data

**Incident.** The onboarding self-name bug wrote `"Had"` as the user's name — from *"Had dinner
with..."*. Station 3 fixed the extraction so it can't happen again. The greeting still read
*"Morning, Had"*, because the bad row was already in `app_users` — and in `people`, since the
pipeline writes both.

**Rule.** After fixing an extraction or write bug, **ask what bad rows already landed** and repair
them explicitly. Check every table the buggy path wrote to, not just the obvious one.

### 6. Deploy ordering: schema before code, always

**Incident (both directions).** The clarifications code shipped to Railway before its table
existed on Supabase — every operation threw 42P01 silently. Later, adding an `origin` filter to
`memory.js` would have thrown 42703 across the brief, insights, and discovery if the column
weren't already live.

**Rule.** Run and verify the migration **first**, then merge and ship the code that depends on it.
Never create a window where deployed code expects an object that isn't there.

### 7. A guard that can't distinguish "checked and fine" from "didn't run"

**Incident.** `NODE_ENV` was unset on the Railway service for a full day. `assertSecureBoot()`
gates its hard failures on `isProduction`, so several checks that should refuse to boot silently
downgraded — and three of them emitted nothing at all. A clean boot log looked identical to a
correctly-configured one.

**Rule.** Every guard must announce which mode it ran in. Absence of a warning is not evidence of
a pass. This is the same disease as Lesson 1, wearing a different hat.

**Related.** Before *arming* a previously-inert guard, enumerate what it will enforce and verify
each input — otherwise flipping the switch takes the service down on redeploy.

### 8. A bad garnish field must never destroy the memory

**Incident.** An unparseable `event_date` ("tonight") threw on insert, and the entire saved item
was lost. The user's memory of a dinner was destroyed by a decorative field.

**Rule.** Distinguish load-bearing fields from decorative ones. A decorative field that fails
gets dropped; the record still saves. Parse at **one** boundary, not per call site.

### 9. Don't trust a station's own documentation

**Incident.** Station 5's doc left a literal `OLD_NAME` placeholder for a constraint name, and its
code comment claimed `status='active'` was "the LOAD-BEARING isolation" — which was false; the
isolation lived in `origin`. Station 7's doc claimed bundle 17, already taken. A `.proposed.sql`
header said "NOT EXECUTED" long after it mattered.

**Rule.** Read the **code and the live schema**, not the accompanying prose. Docs record what
someone intended at authoring time, not what is true now.

### 10. Push back on bad instructions

**Incident.** Emil (via the boardroom) instructed a session to run a data-write `UPDATE` through
the DDL-only migration runner. The session checked, found the runner would verify nothing while
printing a success line, refused, and wrote a proper script instead. Separately, an instruction to
read "the current warnings" as the list of what would become fatal was wrong — most of the checks
emit nothing when disarmed — and the session said so.

**Rule.** If an instruction would produce a false proof or an unsafe action, **say so and propose
the correct approach.** Compliance that produces a wrong answer helps nobody. This has already
saved us twice.

### 11. The library that never throws makes every catch a lie

**Incident.** The Flag 1 census (2026-07-26) asked how many other guards could be silently inert.
The answer was structural, not a list: `supabase-js` resolves `{ data, error }` instead of
throwing, and 45 of 101 call sites never bind `error`. So the disease isn't 45 careless catches —
it's one library contract that turns *every* unbound call into a silent-failure site, and turns
some existing `try/catch` blocks into decoration that can never fire.

Two guards were found actively broken and unable to say so: `isInSuppressionWindow()` returns
`false` ("no crisis cooldown") because the column it reads doesn't exist, and `checkRateLimit()`
returns `allowed: true` on any quota-query failure, with no log line at all.

**Rule.** When auditing for silent failure, **start from the library contract, not the call sites.**
Ask "what does this client do on error?" before reading a single catch block. One wrong assumption
about a dependency's error model reproduces itself everywhere the dependency is used.

**Corollary.** A guard that returns a boolean is the highest-risk shape in the codebase, because
the failure value is almost always also a legitimate answer. `false` means both "checked, fine" and
"couldn't check." Prefer three states, or log the mode.

### 12. Removing the cause is not removing the shape

**Incident.** The §6 crisis cooldown was dead because `app_users.crisis_suppressed_until` didn't
exist. One additive column fixed it, no code change, proven end to end (2026-07-26). Tempting to
call the bug closed.

It isn't. `isInSuppressionWindow()` still funnels **four** different situations into a bare
`return false` with no logging: query error, user row not found, column NULL, thrown exception.
Only the third is a legitimate "no window." The migration removed the condition that was firing
branch one — it did nothing to the fact that branches one, two and four are still invisible and
still indistinguishable from three. Drop the column, rename it, or let PostgREST's schema cache go
stale on a redeploy, and the guard silently goes inert again with no signal.

**Rule.** After fixing a silent-failure instance, ask: **would I find out if this broke again
tomorrow?** If the answer is no, you fixed the trigger, not the defect. Record the remaining shape
as an open flag in the same session — otherwise the green result becomes evidence the whole class
is handled.

**Corollary.** This is Lesson 5 ("fixing the code does not fix the data") pointed the other way:
fixing the *data* does not fix the *code*.

### 13. Correct your own stale notes

**Incident.** A session recorded `interests` as missing from prod. It then ran the migration that
created it — and went back and corrected the note, because a future session reading it would have
re-derived a wrong diagnosis.

**Rule.** When you invalidate something you or a previous session wrote down, fix it in the same
session. Including in this file.

---

## PART 6 — OPEN FLAGS REGISTER

Live list. Close them at the root, not the surface. Update as they resolve.

| # | Flag | Root question |
|---|---|---|
| 1 | **ANSWERED 2026-07-26.** `assertSecureBoot()` can't distinguish "checked" from "didn't run" | Census done — the answer was structural, see Lesson 11 and the new flags 10–13. `NODE_ENV` is set again, so this specific guard is armed. The *shape* is unfixed. |
| 2 | `NODE_ENV` root cause unknown | Who or what removed it? Only the Railway Activity feed can say. If a variable can vanish without an actor, others can too. Still open — the variable is back, but nobody knows who took it. |
| 3 | **CLOSED / DISPROVEN 2026-07-26.** "Last touch: no record yet" after a logged dinner | `contact_events` ARE written; `last_contact_at` IS set. Real cause is the `days_since_contact` NULL guard in `v_people_for_agent` — see flag 12. |
| 4 | **CLOSED / NOT A BUG 2026-07-26.** "Nothing saved yet" while SAVED FOR LATER lists items | Different tables, both authoritative: `facts` vs `saved_items`. Prod had 0 facts and 3 saved items. It is a copy problem — see flag 13. |
| 5 | Insights `gated` is tagged, not enforced | The frontend is the only thing preventing Pro content reaching free users. Needs a test that fails if a gated insight renders. |
| 6 | Reminders has no entitlement model at all | Product decision, not a bug: free forever, or capped? Decide deliberately. |
| 7 | Interests frontend still on localStorage mock | Safe to wire now. Frontend change = live deploy, so it needs its own gated session. |
| 8 | Onboarding infers the user's name from an open reply | The rebuild should ask for the name in its own explicit step. |
| 9 | Extractor once emitted the same saved-item title for two different messages | Never root-caused, not currently reproducible. |
| 10 | ~~The §6 crisis cooldown has never worked~~ **CLOSED 2026-07-26.** Column added and the cooldown proven end to end; the read now announces its abnormal branches and is covered by Bundle 20. | Closed at the root, not the surface: the instance (missing column) AND the shape (a `false` that couldn't say why) are both addressed. |
| 11 | ~~`checkRateLimit()` fails OPEN with zero log output~~ **CLOSED 2026-07-26.** Both quota reads now emit `quota.read.failed`; verdicts unchanged. | Answered deliberately: stays OPEN, because STAGE B3 precedes the Priority 0 crisis gate and failing closed could answer a crisis with the rate-limit template. Covered by Bundle 21, mutation-checked. **The spend ceiling is now observable, not enforced any harder — see flags 17 and 18.** |
| 12 | ~~`days_since_contact` NULL-gated on the never-written `contact_frequency_days`~~ **VIEW HALF CLOSED 2026-07-27.** Fixed in prod, hand-verified, health-score branch untouched as the control. | **Still open — the frontend half:** `healthRes.error` is unchecked at `data.ts:197` (`healthRes.data ?? []`), so a failed health query still renders "no record yet", indistinguishable from no data. Latent second path to the identical symptom. Frontend change = live deploy (Law 6), so it needs its own gated session. |
| 13 | "Nothing saved yet" is facts-only copy sitting above the saved-items panel | Copy/IA, not data. Scope the string to facts. |
| 14 | ~~45~~ **~41 of 101 `supabase.from()` sites don't bind `error`** | IN PROGRESS. Eight hardened (bundles 21/23/24/25, all mutation-checked): quota reads, `logContact`, `linkMessagePerson`, fact supersession, both goal reads, `consent.log`. Remainder is mostly `people.js` and `users.js`. Next candidate `briefEngine.js:355` is blocked on `reliability-core.js` having no logger — see Part 4. |
| 15 | ~~`isInSuppressionWindow()` collapses 4 states into a silent `return false`~~ **CLOSED 2026-07-26** under an explicit narrow Law-2 exception from Emil. | Logging only; control flow unchanged; still fails OPEN. Covered by Bundle 20 and mutation-checked. **The same shape is still live in flags 11 and 14** — this fixed one instance, not the class. |
| 16 | ~~A rate-limited user in crisis gets the cap message~~ **CLOSED 2026-07-26.** STAGE B2.5 exempts a crisis message from both the cap AND the first-message onboarding return. | Scope turned out to be WIDER than filed: `needsFreshStart` was the worse path — a first-ever crisis message got the Twilio opt-in script. Both fixed, Bundle 22, mutation-checked. Residual risk accepted by Emil: a crisis message bypasses the cap, so fixed-template replies are uncapped (Twilio cost only, no model spend; inbound SMS costs the sender). |
| 17 | No cost monitoring anywhere | `v_daily_token_usage` and `v_daily_sms_usage` exist with **zero consumers**. Nothing alerts on spend. `quota.read.failed` is now emitted but nothing consumes it either — an alert has to be wired somewhere for it to matter. |
| 18 | No spend ceiling outside the app is verified | OpenAI and Twilio account-level caps are the only real backstops and they live outside this repo. Confirm they exist and are set before beta. |
| 19 | **Nothing ever sets `people.contact_frequency_days`** | Root cause behind the still-dead `relationship_health_score`, the hidden health bar, the "drifting" pill, and the dormant backend drift nudge + drift brief moment (all four gate on health being non-null). Unlike days-since this guard is CORRECT — the field is the score's denominator. So the fix is a product decision, not a view edit: who sets a per-person contact cadence, and what is the default? Probably derives from `dunbar_tier`. |
| 20 | **Should `addFact` fail closed when supersession fails?** | DECISION NEEDED. Today the retirement failure is logged (`facts.supersede.failed`) and the insert proceeds, so the person can end up with two current values for a single-valued slot. Alternative is to abort the insert, which loses the user's newest correction instead. I chose "keep the correction, log loudly" as the lesser harm — but it is a real product call. |
| 21 | **`coreFive.js:recomputeCoreFive()` is a `throw new Error('TODO')` stub** | ANSWERED 2026-07-27: the throw is **unreachable** — `runMonthlyCoreFive()` never calls it (import commented out, body is a log line), so the cron has never failed. The stub is the *auto* fallback; the primary path is the user-chosen `set_priority_people` RPC, which works but is unreachable from the UI. |
| 22 | **On the FREE plan the proactive layer is entirely dead** | Still true, but re-scoped 2026-07-27: it is currently moot because `BRIEF_DRY_RUN=true` means NOBODY gets proactive SMS. The live consequence on Aug 6/8 is **in-app**, not SMS — `today.ts` free-gates its drift feed on `isPriority` (= `is_core_five`), so the Today feed empties out. Fix is to wire the UI to `POST /api/priority/swap`, which already exists end to end. |

---

## PART 7 — CHANGELOG

Append here when the doctrine changes. Date, what changed, why.

- **2026-07-27 (autonomous run)** — Flag 19 design pass, read-only: established that the ring
  selector is cosmetic (`dunbar_tier` has no backend reader), that `is_core_five` has no writer at
  all (`coreFive.js` is a TODO stub), and that consequently the free-plan proactive layer is dead —
  filed as flags 21 and 22, neither previously known. Documented the health-score formula and its
  two quirks. Continued the flag-14 sweep: hardened `relationships.js` ×2, `memory.js` ×3 and
  `consent.js`, as bundles 23/24/25, each mutation-checked and each merged separately with a full
  green battery (1590 PASS, safety 161). Deferred `briefEngine.js:355` because it needs a shared
  prelude edit affecting ~14 bundles. Removed 9 merged worktrees under `.claude/worktrees/`.
  Verified prod: `/health` 200, `environment="production"` on all 342 log lines, all 7 cron jobs
  registered, zero error-level lines. Opened flag 20 (supersession fail-closed decision).
- **2026-07-27** — Corrected **Law 6** first: BOTH repos deploy on push (the Railway service is
  repo-linked), where it previously said only the frontend did — which implied the backend was
  safer. Then un-gated `days_since_contact` in `v_people_for_agent` (removed
  `OR contact_frequency_days IS NULL` from that branch only). Applied to prod with a purpose-built
  script because the runner's verification is vacuous for a view replacement; both Lucas now read
  2 days, hand-verified; the health-score branch was the in-transaction control and is
  byte-identical. Shipped a verbatim rollback artifact. Recorded that `CREATE OR REPLACE VIEW`
  preserves dependents when the column list is unchanged, and added a Part 3 proof row for view
  replacements. Enumerated what the fix wakes up (insights recency, frontend drift + row
  subtitles). Flag 12's view half closed, frontend half still open; flag 19 opened for the
  never-written `contact_frequency_days` behind the still-dead health score.
- **2026-07-26 (last)** — Closed flag 16, and it was wider than filed: `needsFreshStart` returned
  the Twilio opt-in script for a first-ever crisis message, which is worse than the cap case.
  Added **STAGE B2.5** to `pipeline/index.js` — a pure `evaluateSafety(body).action === 'crisis'`
  pre-check gating both short-circuits, building no reply so the crisis response keeps exactly one
  author. Four functional lines. Benchmarked `evaluateSafety` (5.94 µs typical, linear scaling, no
  ReDoS) to justify running it before a rate limit. Added **Bundle 22**; mutation-checked —
  reverting `index.js` fails 10 assertions and prints the opt-in script as the reply to "i want to
  kill myself". `safetyDetection.js` imported, never edited; import authorized by Emil. Next free
  bundle: 23.
- **2026-07-26 (latest)** — Closed flag 11. `getMessageQuota` / `getNudgeUsage` now emit a
  structured `quota.read.failed` event on error or missing row; healthy reads stay silent; return
  contracts and every verdict unchanged. **Kept failing OPEN deliberately** — the deciding factor
  was not cost but that STAGE B3 precedes the Priority 0 crisis gate, so failing closed could
  answer a crisis message with the rate-limit template. Recorded the spend picture (only ceiling,
  no cost consumers, no alerting) and the `grep '^  FAIL'` discipline after a section heading
  reading "FAILS OPEN" made a green run look red. Added **Bundle 21**, mutation-checked. Opened
  flags 16 (crisis message blocked by the cap — reachable today), 17 (no cost monitoring) and
  18 (unverified account-level ceilings). Next free bundle: 22.
- **2026-07-26 (late)** — Closed the §6 work at the root. `isInSuppressionWindow()` now logs its
  three abnormal branches (query error / no user row / thrown) and stays silent on the legitimate
  NULL branch; control flow unchanged, still fails OPEN. Made under an **explicit narrow Law-2
  exception from Emil** — `isInSuppressionWindow` only; `safetyDetection.js` and `voiceGuard.js`
  untouched. Added **Bundle 20**, the first suite anywhere to run the real `safetyFlags.js`, and
  mutation-checked it (reverting the fix turns it red, exit 1). New Part 3 proof row: a new test
  is not proof until you have watched it fail. Recorded that `reliability-core.js`'s fake Supabase
  cannot drive error/throw branches, so failure-path suites need their own prelude. Flags 10 and
  15 closed. Next free bundle: 21.
- **2026-07-26 (evening)** — Armed the §6 crisis cooldown. One additive column
  (`app_users.crisis_suppressed_until`, timestamptz/nullable/no default) applied via the runner;
  **no code change, `safetyFlags.js` untouched (Law 2)**. Corrected the same-day Part 4 note that
  said the column does not exist. Added: the `run-migration.mjs` schema-qualifier parse failure
  (fails closed, but silently doesn't apply), the measured `run-all.sh` false-pass trap (banner at
  46%, 13 suites after it), the `app_users` `updated_at` trigger, and the fact that no test imports
  `safetyFlags.js`. New Part 3 proof row for arming an inert guard. New Lesson 12 (removing the
  cause is not removing the shape); old 12 → 13. Flag 10 half-closed; flag 15 opened for Emil's
  Law-2 decision.
- **2026-07-26** — Moved into the `cedrus-backend` repo root and made load-bearing (`CLAUDE.md`,
  `README.md`, `NOTES.md` all now open with a pointer to it). Added the silent-guard census results:
  the `supabase-js` never-throws contract and the 45 unbound call sites (Part 4 + new Lesson 11),
  the crisis-suppression column that doesn't exist, the `days_since_contact` NULL guard, and the
  `run-all.sh` mid-script success line. Closed flags 3 and 4 — flag 3 was **disproven** (contact
  events are written; the bug is a view guard) and flag 4 was **not a bug** (two panels, two
  tables, both accurate). Answered flag 1. Opened flags 10–14. Renumbered old Lesson 11 to 12.
- **2026-07-25** — Created after a day that began with three consecutive wrong diagnoses of a live
  silent-write incident and ended with six stations merged and deployed. Every lesson in Part 5 is
  from that day.
