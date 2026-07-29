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

**Did NOT push.** Confirmed. Nothing committed either — the five files are uncommitted in the
working trees of `cedrus-backend` and `cedrus-frontend`, both still on `main` at their original
shas. Emil's call whether these go on `main` directly (docs only, no deploy risk in the backend
repo — but **the frontend `CLAUDE.md` still means a frontend push, and a frontend push is a live
deploy, Law 6**) or onto a branch first.

**For the next session.** Read the doctrine, then `CEDRUS_V1_SPEC.md`. The preservation law is the
part most likely to be violated by accident: moving the existing routes to `/classic` is a
route-prefix move in TanStack Start file-based routing, `routeTree.gen.ts` is generated, and the
move is riskier than anything you build on top of it. Prove `/classic/*` renders before the root
routes change.
