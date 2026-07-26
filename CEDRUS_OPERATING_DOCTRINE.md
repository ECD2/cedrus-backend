# CEDRUS — OPERATING DOCTRINE

**Read this file at the start of every session, before doing anything else.**

This is the standing context for all Claude Code work on Cedrus. It holds how Emil works, the
rules that don't bend, the mistakes we've already made and how we caught them, and the verified
facts about this environment that sessions keep re-deriving wrong.

If you are about to diagnose a problem, **check Part 4 and Part 5 first** — there is a real chance
we have already seen it, already been wrong about it, and already written down the answer.

Last updated: 2026-07-26.

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
6. **Frontend push = live deploy.** cedrus-frontend is on Lovable; pushing main ships to users.
   Treat every frontend merge accordingly.
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
- `run-migration.mjs` parses **only DDL objects** (CREATE TABLE / ADD COLUMN / CREATE INDEX).
  **Never feed it a data write.** It would run the UPDATE inside its transaction while pre-check,
  in-txn verify, and post-check all iterate empty lists and print "all declared objects present"
  having verified nothing. Write a data-write script with real row-count assertions instead.
- `test/run-tests.sh` is a **concat rig**: it strips imports and depends on concatenation order.
  Tests using real ESM imports or `mock.module` cannot run under it — register those in
  `run-all.sh` instead. `run-all.sh` invokes `run-tests.sh` first, so either way they execute
  inside the one gating battery.
- **Bundle numbers in use: 17 (model-timestamps), 18 (interests), 19 (goals).** Next free: 20.
  Station docs have claimed already-taken numbers more than once — check, don't trust.
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
  `rel.logContact()` this way. Before trusting any catch on a write path, confirm the callee
  actually converts `error` into a throw.
- Which write paths genuinely throw: `memory.js` `addFact` / `addSavedItem` / `addReminder` /
  `addGoal` (the post-incident fix, and it works). Which do **not**: the supersession `.update()`
  inside `addFact` (`memory.js:80`), `relationships.js` `logContact` / `linkMessagePerson`,
  `consent.js log`, `usage.js` `getMessageQuota` / `getNudgeUsage`, most of `people.js` and
  `users.js`.

**Contact tracking and the person panel** (verified live 2026-07-26)
- `contact_events` **ARE** written on the saved-item path — Flag 3's premise was wrong. Written by
  `relationships.js:12` from `07_persist.js:99`, gated on the model's `contact_signal` being one of
  `explicit_contact / confirmed_contact / implied_contact`. The DB trigger correctly freshens
  `people.last_contact_at`.
- **`people.contact_frequency_days` has no writer anywhere** — not backend, not frontend, no column
  default, 0 of 4 prod rows populated.
- `v_people_for_agent.days_since_contact` is NULL-gated on **`contact_frequency_days`**, a field it
  does not need: `WHEN last_contact_at IS NULL OR contact_frequency_days IS NULL THEN NULL`. The
  guard is correct for `relationship_health_score` on the next line (it is the denominator) and was
  copy-pasted onto the days-since branch. **Result: `days_since_contact` and the health bar are
  NULL for every person of every user, permanently.** "Last touch: no record yet" is this, not a
  write failure.
- The two person panels read **different tables, and both are authoritative for what they show**:
  WHAT CEDRUS KNOWS → `facts` (`is_current=true`); SAVED FOR LATER → `saved_items`
  (`is_current=true`, `status IN ('active','surfaced')`). A dinner logged as an *event* lands in
  `saved_items` and produces **no** `facts` row — so "Nothing saved yet" above a populated saved
  list is accurate copy, not a bug.
- `app_users.crisis_suppressed_until` **DOES NOT EXIST in prod** (full 39-column list pulled from
  `information_schema`, 2026-07-26). Everything in `safetyFlags.js` that reads or writes it has
  been inert since it shipped.

**Config**
- `NODE_ENV` must be set to `production` on the Railway backend service. `assertSecureBoot()`
  gates its hard failures on it; unset means several checks silently downgrade to warnings or
  emit nothing at all. **Verified set to `production` 2026-07-26**, alongside
  `VALIDATE_TWILIO_SIGNATURE=true` and `PUBLIC_BASE_URL`. The guard is armed again — but it still
  cannot announce which mode it ran in, so Lesson 7 stands.
- `test/run-all.sh` prints **"ALL WS-B SUITES PASSED" roughly halfway through**, with six suites
  still to run. `set -e` protects the exit code so the gate is sound — but that line is NOT proof
  the battery passed. Quote the exit code, never that line.

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

### 12. Correct your own stale notes

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
| 10 | **The §6 crisis cooldown has never worked.** `app_users.crisis_suppressed_until` does not exist in prod, so `isInSuppressionWindow()` always returns `false` = "not suppressed" | Highest-priority fix. Safety path, actively broken, structurally silent. Schema first (Lesson 6), then make the read fail closed or log. Needs its own gated session. |
| 11 | **`checkRateLimit()` fails OPEN with zero log output.** `getMessageQuota` discards `error`; `undefined` ⇒ `allowed: true` | Should an unreadable quota fail open or closed? Decide deliberately. Blast radius is uncapped OpenAI + Twilio spend per user. |
| 12 | `days_since_contact` NULL-gated on the never-written `contact_frequency_days` | One-line view fix, but needs a real post-check that "Last touch" renders a value and that no consumer depends on the NULL. Also fix the unchecked `healthRes.error` at frontend `data.ts:197` — a latent second path to the identical symptom. |
| 13 | "Nothing saved yet" is facts-only copy sitting above the saved-items panel | Copy/IA, not data. Scope the string to facts. |
| 14 | 45 of 101 `supabase.from()` sites don't bind `error` | The generator of this whole class. A sweep, not an emergency — but track it as ONE item so it doesn't fragment into forty-five. |

---

## PART 7 — CHANGELOG

Append here when the doctrine changes. Date, what changed, why.

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
