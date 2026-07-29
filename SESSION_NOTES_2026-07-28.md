# SESSION NOTES — 2026-07-28

**Every overnight session appends its report here. One file, so morning review is one file.**

## How to use this file

- **Append only.** Never edit or delete another session's entry. If a later session proves an
  earlier one wrong, add a new entry saying so — do not rewrite history. (Doctrine Lesson 13 says
  correct your stale notes; that means *your own*, in the same session, and it means annotate, not
  erase.)
- **Newest entry at the bottom.** Emil reads top to bottom in the morning.
- **Every session writes an entry, including a session that did nothing.** "Blocked, did not start"
  is the single most useful thing to find at 7am.
- **Copy the template below verbatim.** A consistent shape is what makes ten entries skimmable.
- **Report what is true, not what you hoped.** If the battery was red, say red and paste the count.
  If you skipped a step, say which one. A green claim without its proof is worse than no claim.
- **You did not push.** Say so explicitly in every entry (doctrine Law 5). If a session's entry
  doesn't state it, Emil has to go check, and that defeats the file.

---

## Template

```
### <session name> — <start time> → <end time>

**Scope.** One or two sentences: what this session was asked to do.
**Repo / branch / worktree.** e.g. cedrus-backend, branch feat/x, worktree .claude/worktrees/nb-x,
branched from <sha>.
**Status.** SHIPPED-TO-BRANCH / PARTIAL / BLOCKED / NO-OP.
**What landed.** Files changed, what each change does. Commit shas.
**Proof.** What was actually run and what it returned. Match the evidence to the claim
(doctrine Part 3). Quote exit codes and PASS/FAIL counts, not impressions.
**Blockers.** What stopped you, and precisely what unblocking would take.
**Did NOT push.** Confirm. Note the exact merge/push command Emil would run if he approves.
**For the next session.** The one thing the next agent needs to know first.
```

---

## Standing context for tonight

- Pivot day. Read `CEDRUS_OPERATING_DOCTRINE.md`, then `CEDRUS_V1_SPEC.md`, before anything else.
- `BRIEF_DRY_RUN` stays `true`. Nothing goes on the wire tonight.
- Nothing is deleted. The old app must still work; new work is additive.
- No Stripe, no pricing.
- **STOP before push.** Without exception.

---

## Entries

### Pivot canon session — 2026-07-28

**Scope.** Read the doctrine and `CLAUDE.md`; write the V1 spec as the new canon; append the pivot
entry to the doctrine; open this notes file.

**Repo / branch / worktree.** `cedrus-backend`, `main`, no worktree — documentation only, no code,
schema, or config touched. Also `cedrus-frontend`, `main`. Both repos were clean and in sync with
`origin/main` at start (`cedrus-backend` at `aed4b25`, `cedrus-frontend` at `042e4cf`).

**Status.** SHIPPED-TO-BRANCH (docs only, uncommitted in the working tree).

**What landed.**
- `cedrus-backend/CEDRUS_V1_SPEC.md` — new. The product canon: the daytime social layer for people
  who work from home, Miami launch, web-primary/SMS-secondary, the five-step loop, the product
  rules (cadence, single-sided data, forwardable invite, never message an invitee, the five replies,
  the garden), founding-member pricing with no Stripe, the preservation law, how it interacts with
  the doctrine, and six open questions.
- `cedrus-backend/CEDRUS_OPERATING_DOCTRINE.md` — Part 0 now points at the spec as required reading
  after the doctrine; header date moved to 2026-07-28; **Law 5 strengthened** (overnight/autonomous
  sessions STOP before push without exception; `BRIEF_DRY_RUN` stays true until a named arming
  session); Part 7 changelog entry appended.
- `cedrus-backend/CLAUDE.md` — now points at both files, in order.
- `cedrus-frontend/CLAUDE.md` — new. The frontend repo had **no pointer to the doctrine at all**, so
  frontend sessions were starting cold. It now points at the doctrine and the spec by absolute path.
- `cedrus-backend/SESSION_NOTES_2026-07-28.md` — this file.

**Proof.** Documentation only, so the claim is "these files say what they should" and the evidence
is the files themselves. What was actually verified: both repos on `main`, clean trees (untracked
`.claude/` and `NOTES.md` only), in sync with origin. No test battery was run and none was needed —
zero `src/` files were touched, so nothing the battery covers could have changed.

**One correction to the brief, folded into the spec.** It said add `member_status='founding'` to
`users`; the real table is **`app_users`**. Written that way in PART 4 with the discrepancy noted,
so a later session doesn't go hunting for a table that doesn't exist.

**Blockers.** None.

**Did NOT push.** Confirmed — nothing left either repo.

**Committed to local `main` in both repos** on Emil's explicit instruction, after the entry above
was first written saying nothing was committed. Correcting it here rather than rewriting it, per
Lesson 13.

- `cedrus-backend` — `77228f6`, ahead of `origin/main` by 1. Four files: the spec, the doctrine,
  `CLAUDE.md`, this file.
- `cedrus-frontend` — `d14fa28`, ahead of `origin/main` by 1. One file: `CLAUDE.md`.

Untracked and deliberately left alone: `.claude/` in both repos, `NOTES.md` in the backend.

**Both pushes are still Emil's to make, and they are not equal.** The backend push is docs-only but
still auto-builds and ships (Law 6). **The frontend push is a live deploy to cedrus.life** — for a
markdown file that changes nothing a user can see, which makes it low-risk but not zero-ceremony.

```
cd "/Users/ec/Desktop/Desktop - EC’s MacBook Air/cedrus-backend"  && git push origin main
cd "/Users/ec/Desktop/Desktop - EC’s MacBook Air/cedrus-frontend" && git push origin main
```

If either is unwanted, `git reset --hard HEAD~1` on that repo undoes it cleanly — neither commit has
a child.

**For the next session.** Read the doctrine, then `CEDRUS_V1_SPEC.md`. The preservation law is the
part most likely to be violated by accident: moving the existing routes to `/classic` is a
route-prefix move in TanStack Start file-based routing, `routeTree.gen.ts` is generated, and the
move is riskier than anything you build on top of it. Prove `/classic/*` renders before the root
routes change.

---

### Night build: budget guard, card rail, broadcasts, member_status, onboarding API — started 2026-07-28 23:24 EDT

**Scope.** Five backend builds in order, each its own commit + tests: (1) budget guard consuming
`v_daily_token_usage` / `v_daily_sms_usage` with a kill-switch row, (2) opportunity-card rail
(admin queue → dry-run sender → reply vocabulary → follow-up → met_confirmed), (3) admin
broadcasts (draft → explicit approve → send; web feed channel), (4) `member_status='founding'`,
(5) web onboarding answers API. Full state-machine, dry-run-suppression and crisis-precedence
tests; mutation-test the kill switch and broadcast caps. STOP before push.

**Repo / branch / worktree.** cedrus-backend, branch `feat/night-2026-07-28-v1-rail`, worktree
`.claude/worktrees/night-v1-rail`, branched from `34559b9` (main). Frontend untouched;
`.env.production` sha256 verified at start: `6b2955d3…549cd5` (matches doctrine Law 7).

**Progress log (grows as items land; full report at the end of this entry).**

- 23:24 recon done. Live-prod facts pinned before any code (Lesson 2): both usage views are
  per-user/per-day, `day` = `date_trunc('day', …)` in **UTC**; token unit = `total_tokens`
  (strings over supabase-js — must `Number()`), SMS unit = `sms_segments` summed over BOTH
  directions (the real Twilio exposure). No name collisions: `opportunity_cards`,
  `suppressed_pairings`, `broadcasts`, `system_flags` all absent in prod. `messages.message_type`
  is plain text (no CHECK, no enum) so new message types are additive-safe;
  `messages.channel` enum already has `web` if ever needed. `people` has no met_confirmed columns.
  `app_users` has 2 rows, 0 opted out; no `member_status` column yet.
- Ordering decision (safety vs pipeline): budget gate sits AFTER STAGE B3's per-user cap and
  immediately BEFORE the model call, gated on `!crisisOverride` from the existing STAGE B2.5
  pure pre-check — so safety detection always runs first, a crisis message keeps the 988 path
  even over budget, STOP/HELP compliance and the Twilio-approved onboarding script stay intact,
  and paused-mode template replies stay bounded by the existing cap (an unbounded "back shortly"
  reply would itself be Twilio spend). Outbound JOBS are gated at the scheduler's `guard()`
  choke point (`outbound: true` per job) — the scheduler is the only caller of all four outbound
  entry points (verified by grep), and this avoids re-plumbing three rig-concatenated job files.
- ~00:20 **Item 1 committed** (`6b928fe`): budget guard live-able end to end. New
  `services/budget.js` + `jobs/budgetGuard.js` (hourly at :10), `system_flags` kill-switch row
  (proposed DDL only), pipeline STAGE B3.5, scheduler outbound gate, env parsing. Bundles 28+29;
  rig 1 exit 0, 765 PASS at that point. Every read fails OPEN with `quota.read.failed`; the job
  announces armed/DISARMED + numbers every run.
- ~01:10 **Item 2 committed** (see log): full card rail. `opportunity_cards` +
  `suppressed_pairings` + `people.met_confirmed_count`/`last_met_confirmed_at` (proposed DDL,
  NOT applied); `POST/GET /admin/cards` (panel auth); sender job (dry-run byte-exact with
  weeklyBrief.js:77 semantics, hard cap 3/user/rolling-7d announced-never-silent, cap-unreadable
  HOLDS — cards fail closed, they're optional; suppression re-checked at send time; CAS claims);
  STAGE B2.6 inbound reply vocabulary (crisis never touches card state — proven); follow-up job
  3d post-YES; follow-up YES = the ONLY tree-advancing event (card + people counters + a
  `source='confirmed'` contact event so "Last touch" agrees with the garden). Failed NOT
  THEM/NEVER writes reply with honest copy and leave the card awaiting (Lesson 1). Bundles
  30/31/32; rig 1 exit 0, **850 PASS**. Two traps hit and fixed en route: unicode-range regex
  escapes typed through the session tooling became raw NUL/DEL bytes in source (perl-cleaned;
  grep/sed would have treated the file as binary), and a multi-line `import {}` broke the concat
  strip (single-lined; the strip only removes lines STARTING with `import `).
- ~01:45 **Item 3 committed** (`003938a`): broadcasts, draft → explicit approve → send/publish.
- ~02:00 **Item 4 committed** (`32d8e0f`): `member_status` DDL + `GET /api/me` (web-api suite
  84 PASS exit 0). **Item 5 committed** (`6b9d8d3`): `POST /api/onboarding/answers` → facts/
  people layer. Rig 1 at **910 PASS exit 0**.
- ~02:20 **Mutation pass + full battery** — details below.

---

**FINAL REPORT**

**Status. SHIPPED-TO-BRANCH.** All five items complete, each its own commit with tests, on
`feat/night-2026-07-28-v1-rail` (worktree `.claude/worktrees/night-v1-rail`, branched from
`34559b9`). **Did NOT push. Did NOT merge. No migration was applied. `BRIEF_DRY_RUN` untouched
(true).** Frontend untouched; `.env.production` sha256 byte-identical at start AND end:
`6b2955d3…549cd5`, 3 lines.

**The five commits (oldest first).**
1. `6b928fe` budget guard — `services/budget.js`, `jobs/budgetGuard.js` (hourly :10),
   `system_flags` kill-switch row (proposed DDL), pipeline STAGE B3.5 (after the per-user cap,
   before the model call, crisis-exempt), scheduler `outbound: true` gate, env parsing.
2. `e85d04b` card rail — tables (proposed DDL), `POST/GET /admin/cards`, sender (15-min cron)
   with dry-run + 3/user/rolling-7d cap + send-time suppression + CAS claims, STAGE B2.6 reply
   vocabulary, follow-up job (hourly :25), met_confirmed writes.
3. `003938a` broadcasts — table (proposed DDL), `POST /admin/broadcasts` (DRAFT only),
   `POST /admin/broadcasts/:id/approve` (the only sender; quiet hours 21–09 ET, 1/ET-day cap,
   500-recipient refusal, opted-out exclusion, kill-switch refusal, dry-run),
   `GET /api/broadcasts/active` (JWT) for Session F's feed.
4. `32d8e0f` member_status — `app_users.member_status text NOT NULL DEFAULT 'founding'`
   (proposed DDL; the ADD COLUMN default backfills existing rows — no data-write script needed)
   + `GET /api/me` curated payload.
5. `6b9d8d3` onboarding answers — `POST /api/onboarding/answers` (JWT), 7 steps into
   self-person facts + people rows via `memory.addFact` supersession; SMS onboarding untouched.

**Proof (evidence matched to claims, doctrine Part 3).**
- **Worktree full battery: `sh test/run-all.sh` → exit 0, 1848 PASS, zero `^  FAIL` lines,**
  true-end banner "ALL BATTERY SUITES PASSED" present (gated on the exit code, not the banner).
  Battery was 1613 PASS before tonight; +235 from bundles 28–34 and the web-api /me section.
  Per Law 3 this is advisory — **the real gate is the re-run on merged main.**
- **Seven guard mutations, each reverted → suite RED → restored** (exit codes from the runs):
  m1 remove the pipeline kill-switch gate → exit 1, 5 FAILs ("returns MSG_BUDGET_PAUSE" got
  MODEL_AUTHORED_REPLY); m2 drop the crisis exemption → exit 1, 5 FAILs — the failing output
  itself shows a crisis message receiving the budget template instead of 988, exactly the
  disaster the ordering prevents; m3 remove the outbound-job gate → exit 1; m4 remove the card
  weekly cap → exit 1, 4 FAILs; m5 remove broadcast quiet hours → exit 1; m6 remove the
  1/ET-day cap → exit 1; m7 remove the 500-recipient refusal → exit 1. After restores: working
  tree clean, rig 1 back to 910 PASS / 0 FAIL.
- Crisis precedence is pinned by the REAL `evaluateSafety()` in bundles 29/32 (same concat as
  bundle 22), not by a double: over budget, over cap, and with a card awaiting, a crisis body
  returns the Category A template containing 988 and the model seam records zero invocations.
- Dry-run suppression is asserted at every new outbound point: card sender, card follow-up, and
  the broadcast approve loop each show ZERO Twilio calls under `BRIEF_DRY_RUN=true` while
  recording per-recipient `messages` rows with `provider_status='dry_run'`.

**The morning ceremony, in order (nothing is live until it runs).**
1. **Migrations first (Lesson 6), through the runner:** `BUDGET_KILL_SWITCH.proposed.sql`, then
   `CARD_RAIL.proposed.sql`, `BROADCASTS.proposed.sql`, `MEMBER_STATUS.proposed.sql` (all in
   `docs/` on the branch; additive, idempotent, unqualified names). Post-check: `to_regclass`
   on `system_flags` / `opportunity_cards` / `suppressed_pairings` / `broadcasts`, and
   `app_users.member_status = 'founding'` on both rows.
2. Merge the branch (one branch = one merge, Law 4), re-run the FULL battery on merged main
   (Law 3), gate on exit code. Then push — **Emil only** (Laws 5/6).
3. Railway env: set `DAILY_TOKEN_BUDGET` and `DAILY_SMS_BUDGET`. Units: total tokens per UTC
   day and SMS segments per UTC day (BOTH directions) across all users. Suggested starting
   points: `DAILY_TOKEN_BUDGET=750000`, `DAILY_SMS_BUDGET=400` (roughly $1–2/day OpenAI, ~$3/day
   Twilio of headroom). NOTE: dry-run rehearsal rows count toward the SMS number — keep headroom
   until the arming session. Unset = that dimension disarmed, announced hourly, never silent.
4. Verify in prod logs within the hour: `scheduler.started` lists 10 jobs (new: budget-guard,
   card-sender, card-followup) and a `budget.check` line with `mode=armed` and real numbers.

**ACCOUNT-LEVEL CAPS TO SET BY HAND (dashboards — flag 18, still open). Set the in-app budgets
LOWER than these so the crisis-aware in-app guard always trips first.**
- **OpenAI** (platform.openai.com → Settings → Limits/Budgets): a **monthly budget with a hard
  limit** (suggest $60/mo) plus an email alert threshold around 50%. The dashboard has no
  per-day knob — `DAILY_TOKEN_BUDGET` is the only day-granular control, which is why it had to
  exist before marketing traffic.
- **Twilio** (Console → Monitor → Usage → **Usage triggers**): alert triggers on total price at
  ~$5/day and ~$50/month. Then **Billing → auto-recharge OFF** (or minimum recharge) so an
  exhausted balance is a hard stop, not an auto-refilling leak. Twilio has no true hard
  spend-cap; balance + triggers is the real mechanism.

**Judgment calls made overnight (each reversible; flag if wrong).**
- Budget gate sits AFTER the Twilio-approved onboarding script and AFTER the per-user cap:
  consent/compliance stays intact, and paused-mode replies stay bounded by the existing 20/day
  cap (an unbounded "back shortly" would itself be Twilio spend). New users still get the
  opt-in script during a pause; their SECOND message defers. Deferring the script would also
  permanently break `needsFreshStart` (our reply would create message history).
- Card replies process BEFORE the cap and the budget gate: fixed templates, no model call,
  bounded by the awaiting-card set. A crisis body never reaches card handling at all.
- "One polite reply" reading: every non-crisis inbound while paused gets the template. Reminders
  SKIP while paused → they stay `pending` and deliver late, not never. A skipped weekly-brief
  hour means that user's brief is missed for the week (briefs spend OpenAI even in dry-run —
  that spend is exactly what the pause stops).
- Cards hold to a 10:00–19:00 user-local window (not in the brief; mirrors the sweeps rail — a
  3am card is a bug even in a daytime product; only delays sends). Card cap unreadable → HOLD
  (cards are optional, so they fail closed); budget reads fail OPEN (blocking the core product
  on a DB blip is the worse harm); broadcast recipient resolution fails CLOSED (a wrong set is
  the harm).
- NEVER suppresses (person, ALL kinds); NOT THEM suppresses (person, this card's kind) — spec
  V4 answered pragmatically. LATER records state; the resurface job is deliberately NOT built
  (V3 open). Unanswered cards fade via match windows (14d card / 7d follow-up); no fade job.
  Follow-up NO and NOT YET both land `met_no`; no re-ask built.
- Broadcast approve refusals (quiet hours / caps / kill switch) leave status `draft` — nothing
  ever retries automatically. A row stuck `approved` = the send loop died mid-way; check logs.
- `GET /api/me` coalesces `member_status` to `'founding'` pre-migration (true in V1 by spec).
- Card SMS body goes out verbatim (Emil authors the reply-vocabulary instructions in the copy);
  the YES reply carries the forwardable invite + "send it from your own phone" — no code path
  here contacts anyone but the account holder (spec PART 3's hardest line).

**Contracts for Session F** (all JWT-authed): `GET /api/me` →
`{id,name,phone,timezone,member_status,onboarding_complete,created_at}`;
`GET /api/broadcasts/active` → `{broadcasts:[{id,body,sent_at}]}` (≤20, newest first);
`POST /api/onboarding/answers` `{step, answers}` → `{step, facts_saved, people_touched}`; steps:
work_setup, neighborhood, free_windows, activities, current_groups, people, social_prefs.

**Shared files edited (solo session, wired directly; for merge review):** `src/index.js`
(3 mounts + imports), `src/jobs/scheduler.js` (3 new crons + outbound gate),
`src/pipeline/index.js` (stages B2.6 + B3.5), `src/config.js` (2 env fields),
`test/run-tests.sh` (bundles 28–34), `test/web-api.test.mjs` (/me section),
`test/prelude-crisis-cap.js` (budget + cards knobs; bundle 22 still green).

**Law 2:** `safetyDetection.js`, `safetyFlags.js`, `voiceGuard.js` untouched (`git diff
main..HEAD --stat` shows none of the three); `evaluateSafety` / `isInSuppressionWindow`
imported read-only like their existing consumers. Safety suites in the battery: green.

**Known gaps filed.** (a) The two new admin routers' HTTP wiring is covered by `node --check` +
pattern-identity with the tested adminPanel router; business rules ARE rig-tested at the
service layer (bundles 30/33). (b) Nothing alerts on `quota.read.failed`/`budget.check` — the
guard enforces, it pages nobody (noted on flag 17). (c) `resolveRecipients`' DB-error branch is
fail-closed by code shape, not by a rig case (reliability-core cannot produce errors). (d)
Dry-run rows inflate `v_daily_sms_usage` — deliberate conservatism, now in doctrine Part 4.

**Doctrine updated (uncommitted on main alongside this file, for the morning commit):** bundle
numbers 28–34 claimed (next free 35), two new concat-strip facts, budget-guard branch status in
the Part 4 spend section, flag 17 re-scoped, changelog entry.

**Did NOT push.** Confirmed — nothing left this machine. After review, from the backend root:

```
node ~/.config/cedrus/migrate/run-migration.mjs .claude/worktrees/night-v1-rail/docs/BUDGET_KILL_SWITCH.proposed.sql
node ~/.config/cedrus/migrate/run-migration.mjs .claude/worktrees/night-v1-rail/docs/CARD_RAIL.proposed.sql
node ~/.config/cedrus/migrate/run-migration.mjs .claude/worktrees/night-v1-rail/docs/BROADCASTS.proposed.sql
node ~/.config/cedrus/migrate/run-migration.mjs .claude/worktrees/night-v1-rail/docs/MEMBER_STATUS.proposed.sql
git merge --no-ff feat/night-2026-07-28-v1-rail
sh test/run-all.sh   # gate on the exit code, then push — Emil only
```

**For the next session.** The kill-switch table does not exist in prod until the ceremony runs —
the code fails open loudly by design, but run the migrations BEFORE the push anyway (Lesson 6).
Bundle numbers through 34 are claimed by this branch; next free is 35. If you touch any file
this branch also touched, merge it first or coordinate — it is one merge away from main.

---

### V1 frontend: /classic move + the new root experience — 2026-07-28 ~23:05 → 2026-07-29 ~00:10 EDT

**Scope.** Complete new frontend for the WFH positioning: move the ENTIRE existing app intact to
`/classic`, then build the new root — marketing page, conversational onboarding, Your Day,
concierge chat, garden, admin — with unmerged APIs mocked behind one adapter. Subagents built the
six screens; the parent session owned routing, design tokens, and review.

**Repo / branch / worktree.** cedrus-frontend, branch `feat/v1-wfh-frontend`, worktree
`.claude/worktrees/nb1-v1-wfh`, branched from `d14fa28` (main, which is itself 1 docs commit
ahead of origin). Backend repo untouched except this file.

**Status. SHIPPED-TO-BRANCH.** Three commits, all gates green, browser-verified.

**The three commits (oldest first).**
1. `5d57f28` classic move — all app routes into `src/routes/classic/` (landing, today, people,
   person, archived, my-cedrus, dashboard, admin, admin login, upgrade, affiliate, dev preview);
   path literals, canonicals, and test expectations updated; `routeTree.gen.ts` regenerated.
2. `e99c76c` foundation — `DESIGN.md` ("a garden at noon"), additive `--v1-*` token + motion
   layer in styles.css, shared components (TreeGlyph, Seedling, WindowChip, V1Shell, primitives),
   the v1 API adapter, thin routes for `/`, `/start`, `/day`, `/chat`, `/garden`, `/admin`.
3. `57cc9b8` the six screens + verification fixes + a DEV-only `/v1-preview` harness.

**Proof (evidence matched to claims).**
- **/classic renders, with a control:** `/classic/`, `/classic/my-cedrus`, `/classic/admin` →
  `/classic/admin/login` (TOTP form), `/classic/today` all render in dev; `/classic/today`'s
  signed-out output is string-identical to unmoved `/today` served from main as the control.
  Hydration warnings on `/classic/` are byte-for-byte the same float-precision SVG `cx` warnings
  the UNMOVED main root logs (Dunbar dots, `index.tsx:629`) — pre-existing, not a regression.
- **Gates:** `tsc --noEmit` clean; eslint 0 errors (3 pre-existing-class react-refresh
  warnings); **vitest 137/137**; `bun run build` exit 0.
- **Law 7:** `.env.production` sha256 `6b2955d3…549cd5`, 3 lines — verified at session start,
  mid-session, after all work, and again AFTER the production build. Byte-identical throughout.
- **Browser-verified** (dev server on 5178, desktop + 375px mobile): marketing hero/sections,
  onboarding name step + neighborhood chips + pacing, Your Day cards (YES → in-place accepted
  state persisting the reply; SKIP/LATER fold-outs), garden ring + tree selection panel, chat
  send (graceful ApiError path), admin draft → two-press approve → **the approved broadcast then
  appears under "Happening in Miami" on Your Day** (the cross-surface loop works). Test data
  cleared afterward.

**What is REAL tonight (calls the live backend):**
- `POST /api/onboard/start` — the onboarding phone step (optional, skippable) triggers the
  existing public SMS flow. My browser test used the skip path; no SMS was sent tonight.
- `POST /api/capture` + `POST /api/capture/confirm` — the concierge chat is fully wired to the
  existing web brain. `channel='web'` is already first-class on the confirm write, so **no
  web-channel flag is needed; nothing to change on the backend for basic chat.** The
  propose→confirm shape is surfaced honestly ("Save this to your Cedrus? Save · Not now").

**MOCKED — all behind `src/lib/api/v1.ts` (registry const `V1_MOCKED`; every mock logs
"[v1 mock]" in the dev console; state is localStorage-backed so the demo is stateful):**
onboarding answers · free windows · opportunity-card feed + replies · broadcasts feed · garden
trees · admin segments/broadcast draft+approve/card queue.

**Morning wiring map — read together with the night backend entry above, whose branch
`feat/night-2026-07-28-v1-rail` already builds most of the real side. Three contract
reconciliations, all localized to `src/lib/api/v1.ts` (the single seam):**
1. **Broadcast shape:** backend serves `GET /api/broadcasts/active` → `{broadcasts:[{id, body,
   sent_at}]}`; my mock returns structured `{title, blurb, whenLabel, whereLabel}`. Either map
   `body` into the card as one text block (5-minute frontend change) or structure the backend
   column later. Frontend change is the cheap one.
2. **Onboarding answers:** backend `POST /api/onboarding/answers` takes per-step `{step,
   answers}` (steps: work_setup, neighborhood, free_windows, activities, current_groups, people,
   social_prefs); my interview submits one combined object at the end. Wire = submit per-step as
   the interview advances and map my field names onto those seven steps (name → work_setup?
   confirm with the backend session's field expectations before mapping).
3. **Admin paths + auth:** backend admin composes live at `POST/GET /admin/cards` and
   `POST /admin/broadcasts` + `/admin/broadcasts/:id/approve` (panel Bearer auth), not
   `/api/admin/*` as my mocks assumed. Point the admin adapter functions at `/admin/*` through
   the same Bearer-session fetch `real.ts` already uses.
   Note: **no member-facing card feed endpoint exists yet** (the night branch built the admin
   queue + SMS sender + SMS replies; web feed + web replies for cards still need a small
   endpoint pair) — Your Day's card feed stays mocked until then.

**Decisions a reviewer should check (in order of weight).**
1. **KEPT AT ROOT, not moved:** `/terms`, `/privacy`, `/support`, `/sms` (externally registered
   legal/compliance URLs — Twilio verification links break if these move; classic pages link to
   them absolutely, so classic stays fully functional) and protocol endpoints
   (`/.well-known/oauth-protected-resource`, `/mcp`, `sitemap.xml` — these do not work under a
   prefix by spec). Everything else moved. "Entire app" was read as "every app screen."
2. **Reuse seams instead of duplicated auth:** `AdminSessionGate` gained `loginTo`,
   `AdminLoginForm` gained `redirectTo`, `PageShell` gained `homeTo` — classic defaults
   preserved, V1 passes root paths. One in-memory TOTP session serves both admin surfaces.
3. **V1 sign-in surface does not exist yet:** marketing "Sign in" links to `/classic/my-cedrus`
   (the existing OTP flow), which lands on the classic dashboard. Morning decision: V1-styled
   sign-in, or a post-login redirect to `/day`.
4. **The `frontend-design` skill was not available** in this session (Unknown skill); the
   mandated design pass was done directly as `DESIGN.md` in the worktree root, and all six
   screens were reviewed against it.
5. Flagged, untouched: the sitemap route still points at stale domain `https://cedrussignal.com`
   and lists only `/`. One-line morning decision.
6. Root `__root.tsx` default meta now carries the WFH positioning (spec wins over stale copy);
   classic routes keep their own per-route heads with `/classic/` canonicals.

**Blockers.** None.

**Did NOT push.** Confirmed — nothing left this machine, no push, no merge, no deploy. After
review, from the frontend root:

```
git merge --no-ff feat/v1-wfh-frontend
npm test && npx tsc --noEmit && bun run build   # gate on exit codes
shasum -a 256 .env.production                    # must stay 6b2955d3…549cd5
git push origin main                             # Emil only — this IS the deploy
```

To preview first: the dev-server entry `cedrus-v1-worktree` (port 5178) was added to
`.claude/launch.json`; `/v1-preview?screen=day|chat|garden|admin` shows the gated screens
without a session (dev-only route, redirects home in production).

**For the next session.** The two night branches are complementary but UNMERGED: this one
(frontend) and `feat/night-2026-07-28-v1-rail` (backend). Wire in this order: backend ceremony
first (migrations → merge → battery → push), then the three adapter reconciliations above, then
delete each `V1_MOCKED` entry as its real endpoint takes over. The adapter is the only file that
should need touching for wiring.

---

### Morning merge ceremony — 2026-07-29 ~08:40 EDT

**Scope.** Integrate the three overnight branches. Migrations first, then one merge at a time with
the gate re-run between each. STOP before push.

**Repo / branch / worktree.** Both repos, `main` directly — no worktree, this IS the integration.
cedrus-backend from `34559b9`, cedrus-frontend from `d14fa28`.

**Status. SHIPPED-TO-LOCAL-MAIN.** All four migrations applied to prod; all three branches merged;
every gate re-run on merged main. Nothing pushed.

**What landed.**
- **Prod schema (4 migrations, runner, in order):** `system_flags`; `opportunity_cards` +
  `suppressed_pairings` + 4 indexes + `people.met_confirmed_count`/`last_met_confirmed_at`;
  `broadcasts` + 1 index; `app_users.member_status text NOT NULL DEFAULT 'founding'`.
- **cedrus-backend `main` → `19cdf87`.** `076a1c8` = the night session's doctrine + notes edits it
  left staged for this morning (committed first so the merge ran on a clean tree, Law 1).
  `19cdf87` = merge of `feat/night-2026-07-28-v1-rail`.
- **cedrus-frontend `main` → `af6be72`.** `be7a211` = merge of `feat/v1-wfh-frontend`;
  `af6be72` = merge of `docs/marketing-launch-kit`.
- Doctrine corrected (three claims this ceremony made false) + a new **Frontend gates** block.

**Proof.**
- **Migrations:** runner pre-check → in-txn verify → COMMIT → fresh post-check, exit 0 each. Then
  one consolidated live-prod post-check after all four: 4 tables present, 5 indexes present, 3
  columns present with the right types, every CHECK constraint verbatim, all 4 new tables 0 rows.
  **Controls:** a table I did not create reads `ABSENT` (so the probe can report absence), and
  both `app_users.updated_at` values are byte-identical before/after — `ADD COLUMN` did not fire
  `trg_app_users_updated_at`, and `plan`/`billing_status` are untouched. Both rows `'founding'`.
- **Backend battery on merged main: `sh test/run-all.sh` → exit 0, 1848 PASS, 0 `^  FAIL`, 0
  `TEST(S) FAILED`.** Gated on the exit code, not the banner — and this run reproduces the trap:
  `ALL WS-B SUITES PASSED` sits at line 1766 of 3087 with **12 suite banners after it**. All seven
  new suites ran green (BUDGET-GUARD, BUDGET-PIPELINE, CARD-STATE, CARD-FAILURE, CARD-PIPELINE,
  BROADCAST, ONBOARDING-ANSWERS) and so did SAFETY (Law 2). **Re-run at the end: identical.**
- **Frontend on merged main:** `tsc --noEmit` exit 0; vitest **137/137, 21 files**, exit 0;
  `bun run build` exit 0 (its 34 "error" log lines are rollup `"use client"` notices from
  `node_modules/@tanstack/react-router`, not build errors). **`.env.production` sha256
  `6b2955d3…549cd5`, 3 lines / 163 bytes — verified at session start, before the merge, after the
  merge, after the production build, and after the marketing merge. Byte-identical throughout.**
- **Marketing kit is docs-only:** `git diff --name-only main...docs/marketing-launch-kit` = 9 files,
  all under `marketing/`, zero `src/`. Post-merge, nothing outside `marketing/` changed.

**What looked off.**
1. **The brief said `docs/marketing-launch-kit` was a cedrus-backend branch. It is not** — it lives
   in cedrus-frontend (`.claude/worktrees/marketing`). Merged there instead. No such branch exists
   in the backend.
2. **Frontend `npm run lint` fails: 104 errors.** It also failed BEFORE any of this work — the
   control (a detached worktree at pre-merge `d14fa28` with `node_modules` symlinked) reports
   **103 errors**, all pre-existing `prettier/prettier` formatting. The merge's true net is **+2
   new errors** (`TodaySections.tsx`, `rings-home.test.tsx` — both just a `/classic/…` path string
   pushing a line past print width), **−1** (`PageShell.tsx` reflowed), **+3** react-refresh
   warnings in the new `src/components/v1/` files. The night entry's "eslint 0 errors (3
   pre-existing-class react-refresh warnings)" describes linting only its own new V1 files; those
   3 warnings are exactly the 3 I see. **Nobody regressed lint; it was already red.**
3. **`eslint .` walks `.claude/worktrees/`**, so the raw run reports 314 errors — every finding
   once per worktree checkout plus once for real. Scope to `npx eslint src`, or ignore `.claude`.
4. The step-5 battery re-run was on a tree identical to step 2 (the marketing kit went to the
   frontend, so backend `main` never moved after `19cdf87`). It proves reproducibility, not more.

**Blockers.** None.

**Did NOT push.** Confirmed — nothing left this machine. No deploy, no Railway env change,
`BRIEF_DRY_RUN` untouched. Backend `main` is ahead of origin by 4, frontend by 3.

**For the next session.** The schema is live but the guard is NOT enforcing: `main` is unpushed so
Railway still runs pre-merge code, and `DAILY_TOKEN_BUDGET`/`DAILY_SMS_BUDGET` are unset (unset =
DISARMED). After Emil pushes, verify within the hour that `scheduler.started` lists 10 jobs and a
`budget.check` line appears with real numbers. Then the three frontend adapter reconciliations in
the night entry above, and flag 18's account-level caps.

**Post-push addendum (2026-07-29 ~09:12 EDT).** Emil authorized the backend push in the boardroom;
`aed4b25..3a84b8d` pushed, exit 0. Railway deployment `107b2bcd` SUCCESS ~40s later, `/health` 200,
and the new boot's `scheduler.started` lists **exactly 10 jobs** including the three new ones
(`budget-guard`, `card-sender`, `card-followup`). Zero error lines. No `budget.check` yet — the job
runs hourly at :10 and the server booted at 13:10:20 UTC, just past the tick, so the first run is
~14:10 UTC. Both budget env vars are still unset, so it will announce DISARMED.

**One thing I could NOT prove, honestly reported.** The two new admin routers' HTTP mounts are
still unproven — the night entry's known gap (a) is still open. Unauthenticated, `/admin/cards`,
`/admin/broadcasts`, `/admin/broadcasts/x/approve` and the nonsense control
`/admin/definitely-not-a-route` ALL return 403 with the byte-identical body `Forbidden`. The
control does not discriminate, so per Lesson 3 I have no proof either way. Recorded in Part 4:
`/admin` has the same catch-all-auth shape as `/api`. What the deploy DOES prove is that the merged
code is running — `budget-guard`/`card-sender`/`card-followup` are new modules from this merge and
they registered at boot. Closing the mount gap needs an authenticated 200 vs an authenticated 404.
