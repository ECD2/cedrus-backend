# Session notes — 2026-08-05, Slice 1 (canon, contracts, honest front door)

Executed `docs/NEXT_BUILD_PROMPT_SLICE_1.md` from the boardroom planning worktree, under Emil's
2026-08-05 approval of decision (a).

**Phases A and B: complete and merged to local `main`. Phase C: partial — C3 and C4 done, C1, C2,
C5, C6, C7, C8 not started.** Continuation prompt at
`_worktrees/cedrus-labs-boardroom-2026-08-05/docs/NEXT_BUILD_PROMPT_SLICE_1_PHASE_C_REMAINDER.md`.

**NOTHING PUSHED. NOTHING PUBLISHED. NO MIGRATION RUN. NO DATA WRITE RUN.** (Laws 5, 6, 8.)

---

## Commits

| Repo | SHA | What |
|---|---|---|
| cedrus-backend | `dc442ba` | canon: Law-12 push-state corrections + Part I §22 boardroom entry |
| cedrus-backend | `abf4228` | **merge** `planning/cedrus-reboot-2026-08-04` → main (Phase A) |
| cedrus-backend | `0b89cc8` | vendored contracts, amended, flag-off validation on POST /api/goals |
| cedrus-backend | `66e7fc4` | **merge** `feat/contracts-v0` → main (Phase B) |
| cedrus-miami | `a0f7614` | merge of `origin/main` @ `2f38904` (the two-writer pull) |
| cedrus-miami | `beafb52` | C3 consent writes checked, C4 Resend webhook |
| boardroom worktree | `5468b73` | continuation prompt for the Phase C remainder |

`cedrus-backend` `main` is **5 commits ahead of `origin/main` @ `6723c0a`**.
`cedrus-miami` `feat/miami-founding-beta-shell` is **2 commits ahead of `origin/main` @ `2f38904`**.

## Gates

| Gate | Result |
|---|---|
| Battery on merged main, after Phase A | **exit 0**, 1848 PASS, 0 `^  FAIL` |
| Battery on merged main, after Phase B | **exit 0**, 1898 PASS, 0 `^  FAIL`, contracts 97/97 |
| Contracts package | typecheck 0, 97 tests, **30/30 mutation controls** |
| cedrus-miami | `bun run build` **exit 0**, `bun run lint` **exit 0** (8 react-refresh warnings, 0 errors — the recorded baseline) |
| Law 7 `.env.production` | 3 lines, `6b2955d3…549cd5`, **byte-identical at session start and end** |

Gated on `echo $?` throughout, never on a banner (II.5). **New finding: the `grep '^  FAIL'`
cross-check does not cover the new contracts stage**, which uses node:test `✔`/`✖` output. Under
a deliberate mutation the battery exited 1 while `^  FAIL` still read 0. The exit code is sound;
the cross-check is now partial. Recorded because a session that greps and stops reading would
call that run green.

---

## Phase A — canon

`A1` was already done (`8ad5695`). Verified, then:

**Law 12 corrections, evidence `main == origin/main @ 6723c0a`, observed 2026-08-05.** The prompt
named two sites, Part I §6.0 and III.1. **III.1 does not contain the claim** — it already reads
"deployed but disarmed". The real second site is **II.5's budget-guard note**, which said "local
`main` is unpushed, so Railway is still running pre-merge code". Corrected all three:

- Part I §6.0 — the 2026-07-29 onboarding API is pushed and therefore deployed. Notes that this
  does not open the door (the calling surface is still mock-wired) and that live-deploy
  confirmation against Railway logs is still owed: a ref comparison proves the code shipped, not
  that it is running.
- II.5 budget guard — same correction, same evidence.
- II.6 flag 17 — the false claim removed from the open list; two items remain plus the owed
  Railway confirmation.
- III.1 / III.2 — the four stale worktree registrations recorded (`goals-lane` `0990199`,
  `voice-personas` `58ee981`, `life-reboot` `cf79437`, `life-product-experience-v2` `f2f322b`),
  their content-only local copies, and that all four branch tips are safe as refs.

**A discrepancy worth keeping:** the boardroom report records `life-product-experience-v2` at
`9c90803`. The observed tip is `f2f322b`. The observation wins and canon now says so.

**Part I §22** gained a dated entry for the boardroom's §20 amendments — outcome vocabulary, card
lifecycle with hash-bound approval, `proposed_action` spelling — recorded as **approved by Emil
2026-08-05**, with that approval's exclusions written down so no later session reads it wider.

**Part II integrity.** Operating law II.0–II.4 is **byte-identical** to `6723c0a`: 239 lines,
sha256 `6cd5ca61c23607599f3d6deda7eb6420164ebf34d4d96ac6584f14acccc1df88` before and after. Only
II.5 and II.6 changed, which the document itself designates as the verified record, corrected in
place when reality moves. Emil's exclusion on "altering Part II operating law" is intact.
Part II across the merge: 409 lines, `9e3f14f3…e8bfc`, identical before and after.

**A5.** Not pushed. The reboot worktree was **not** removed (it becomes redundant only after Emil
pushes). `git worktree prune` was **not run**; the dry run says it would remove exactly:
`cedrus-backend`: `worktrees/goals-lane`, `worktrees/voice-personas`;
`cedrus-frontend`: `worktrees/life-product-experience-v2`, `worktrees/life-reboot`.

---

## Phase B — contracts

Vendored from `Cedrus-Labs/01-cedrus-contracts` @ **`113a3389c424222c37f421b2944c495d13ed1c30`**,
lab tree clean, **lab unmodified**. Provenance and every amendment: `contracts/VENDORED_FROM.md`.

**Compile decision: (a), compile to `.js` + `.d.ts` at vendor time.** Reasons, and what (b) would
have cost, named as required:

1. **JSON Schemas cannot carry most of these rules.** 7 of 24 contracts fully expressed in JSON
   Schema; 19 of 51 counterexamples TypeScript-only. Schemas-only would silently drop: all four
   guards (`provenance`, `authorization`, `calendar-boundary`, `fabrication`), every cross-field
   `refine` including `card_outcome/silence_source_mismatch`, `availability/basis_notice_mismatch`
   and `window/ends_before_starts`, every `inspect` rule including `goal_set/member_mismatch` and
   `fabrication/progress_contradicts_counts`, and `Count` derivation (`value === refs.length`),
   which is trust law item 3 made mechanical.
2. No new runtime dependency; (b) needs Ajv in production deps.
3. No raised Node floor. The backend declares `node >=20`; the lab needs `>=24` type stripping.
   Importing `.ts` directly would make that a **deploy-time, module-load** failure on a change
   whose entire point is that it cannot alter behaviour.
4. Source stays byte-comparable with the lab (`rewriteRelativeImportExtensions`).

Cost, stated: `dist/` is committed build output and goes stale if someone edits `contracts/src/`
without rebuilding. Partly closed — Bundle 35 asserts `dist/` agrees with the amended source on
the values Slice 1 depends on. Not fully closed.

**Amendments** (1–5 from the catalog, 6 added by this session and flagged):

1. `goal.status` → `open|completed|missed|canceled` (the deployed CHECK).
2. `goal.origin` → `+ cedrus_inferred` (the live partition key).
3. `card_outcome` → `not_this_reason` renamed `rejection_reason`, `+ unspecified`; new nullable
   `rejection_scope` (`this_action|today`).
4. `connection_authorization.status` → `+ disconnected`.
5. Assistant jobs re-derived from reboot §6.4. Dropped `find_local_activity` and
   `answer_calendar_of_events` as the prompt says, **and `connect_with_member`**, which is not in
   §6.4 and which §4 forbids in the founding release.
6. **Beyond the prompt's list:** `goal.stated_text` cap 200 → 280, per catalog item 2 and the
   deployed service. At 200 every legitimate 201-to-280 character goal would be a logged
   violation, and a validation log full of false alarms gets ignored.

**The analytics better-day props the prompt pairs with amendment 5 do not exist in this package.**
No better-day enum anywhere in `src/`; the stale vocabulary belongs to Labs 09/10, which Slice 1
does not vendor. Nothing changed, because there was nothing to change.
`cedrus.progression`'s `nothing_moved` boolean, which catalog item 10 rules against, **is** here
and was **left alone** — outside the named amendments, untouched by any Slice 1 path, and Slice 2's
job. Filed, not fixed.

**Wiring.** `src/services/contractGuard.js` validates the goal about to be written, immediately
after `cleanGoalText` and **before** the insert. `CONTRACTS_VALIDATE` unset (**the shipped
default**) logs `contract.violation` and changes nothing; `'true'` refuses with a 422 whose body
is `cedrus.api_error`. **The flag was not flipped.** Every log line names which mode it ran in
(Lesson 7). Nothing is rewritten: where contract and service disagree, that is recorded.

**Divergences found and recorded** (`VENDORED_FROM.md`): `stated_text` min 3 vs the service's
any-non-empty (kept — this is what the wiring actually catches); `priority` is the same name for
two different concepts (the adapter sends `null`, never the service's 0-100 weight); ids are
prefixed; `lane` is null because the column does not exist yet.

**Mutation controls.**

| Control | Under mutation | Restored |
|---|---|---|
| Provenance guard neutered (`checkKnownSource` always passes) | contracts check **exit 1**, 2 tests red; full battery **exit 1** | **exit 0**, 97/97; file sha256 back to `4ea5587c…` |
| Goal-status amendment reverted to the lab's enum, `dist/` rebuilt | contracts check **exit 1**, 10 tests red; full battery **exit 1**, 7 `^  FAIL` | **exit 0**, 1898 PASS; file sha256 back to `2766d584…` |

The second is the stronger one: reverting the amendment makes **every legitimate goal** a
violation, which is exactly what the amendment prevents.

**M28 refused rather than reporting a pass** when amendment 6 moved its target string, and was
retargeted. That is the harness behaving as D-12 records, and it is why the other 29 are worth
believing.

**Rig work.** Only `test/run-tests.sh` concatenates `goals.js` (all three rigs checked). Bundle 19
gains `test/stub-contract-guard.js`: the strip removes the new import, and `reliability-core.js`
declares no logger, so the real guard cannot be concatenated. The stub **records** calls and
`goals.test.js` asserts them, so deleting the call site turns Bundle 19 red too. The real guard is
proven by Bundle 35, with real ESM imports and nothing about the contract stubbed.

---

## Phase C — partial

**The two-writer rule fired.** `origin/main` was **15 commits ahead** of local `main`, every one
authored by `gpt-engineer-app[bot]` (Lovable), ending `2f38904 Applied Bone Editorial design`
(2026-08-04). The boardroom recorded origin at `d36281a`; it had moved and nobody had fetched.
Pulled per the prompt's own instruction, branched from the result.

Lovable had already deleted `WaitlistCounter.tsx` and `getHeldRegistrationCount` and removed the
registration RPC call, and had replaced the visual system. **It had not removed the countdown, the
`Event` JSON-LD, the workday title, or any August-21 string.**

**A false all-clear, recorded because it nearly stuck.** The first acceptance check used
`git grep "2026-08-21\|August 21\|workday"`. Git did not parse `\|` as alternation and returned
**zero hits** — on a page that visibly renders `<CountdownTimer />` and a JSON-LD `startDate` of
`2026-08-21`. Law 3 in miniature: the check could not fail, so its passing carried no
information. Re-run one pattern at a time with a control that IS present, it found 18 hits across
6 files. **The continuation prompt requires the control.**

**Done: C3 and C4** (`beafb52`). Both consent writes now bind and check `error` and fail loudly
(Lesson 11); the withdrawal write is the worse of the two, because unchecked it returned success
while the record still read granted. The Resend webhook reads env through `getEnv()` (Lesson 15)
and returns **503** when unconfigured instead of 200 — it was acknowledging and silently
discarding every delivery, bounce and complaint event.

**Not done: C1, C2, C5, C6, C7, C8.** Stopped at a clean, committed, build-and-lint-verified
state rather than leaving half-applied edits across eleven files.

**C3's mutation control is owed.** This repo has no test harness, and the control the prompt asks
for needs the stubbed client that C2 introduces. C3 and C4 are implemented and build/lint
verified; they are **not** mutation-proven, and are recorded as such rather than as done.

**Also owed, and not attempted:** the mobile pass at 360/390/430.

---

## Anything observed that contradicts CEDRUS.md

1. The prompt's "III.1 says the onboarding work is unpushed" — it does not. The second site is
   II.5. Corrected there. (§A above.)
2. `life-product-experience-v2` is at `f2f322b`, not the boardroom's `9c90803`. Canon records the
   observation.
3. `grep '^  FAIL'` no longer covers the whole battery — the contracts stage uses node:test
   output. Gate on the exit code, as II.5 already says.
4. **Not fixed, filed:** the structured logger's `scrub()` mangles UUID correlation ids into
   `[phone:####]` fragments — e.g. `correlation_id":"788d[phone:4044]a-4b7e-…`. It is matching
   digit runs inside a uuid. Harmless to behaviour, corrosive to tracing, and Lesson 17's subject
   exactly: the field you would use to trace a request is the field being corrupted. Out of Slice
   1's scope; worth its own small gated session.

---

## What Emil runs to push

Nothing here is pushed. Three commands, in this order, each a release (Law 6).

**1. Backend — this is a Railway deploy, live in ~50 seconds.** Docs plus flag-off code; behaviour
is unchanged because `CONTRACTS_VALIDATE` is unset.
```
cd /Users/scu/Developer/Cedrus/cedrus-backend && git push origin main
```

**2. Miami — preview only.** C3 and C4 reach preview; the live app does not change.
```
cd /Users/scu/Developer/Cedrus/cedrus-miami && git checkout main && git merge --no-ff feat/miami-founding-beta-shell && git push origin main
```

**3. Miami — live.** Publishing is a Lovable action, not a command. **Recommend not publishing
yet:** the page still shows a countdown to the cancelled 21 August event, and C1 removes it.
Publish after the Phase C remainder lands.

After the backend push, the Railway-log confirmation that II.5 and II.6 now record as owed can
finally be collected: look for a `budget.check` line and confirm the deployed commit.
