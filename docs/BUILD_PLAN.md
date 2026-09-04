# Cedrus build plan — the task IDs canon cites

**11 of 54 complete as of 2026-09-04.**

Generated from the live build ledger artifact. The ledger is the working view;
this file exists so a CEDRUS.md bullet citing `P1.4` has something in the repo
to resolve against. When the two disagree the ledger is newer — regenerate this
file rather than editing it by hand.

`[x]` = proven and ticked. Owner is who does the work, not who approves it.

## Phase 0 — Close the foundation

The multi-user schema is live but the code that uses it is sitting unpushed on a laptop. Nothing else can start until what is written is running.

- [x] **F0.0 — Apply the multi-user migration**  _(done 2026-08-31)_
  - Roles, capabilities, per-person settings and the append-only audit table, with RLS enabled and forced. Applied via the Management API and verified by reading the database back.
  - *Owner:* Emil · *Proofs:* A6, A7, D4
  - *Done when:* Read-back confirmed 3 tables, 6 policies, 0 exposing anon.
- [x] **F0.1 — Bootstrap one admin**  _(done 2026-08-31)_
  - Promote Emil's account to admin. This is the one deliberate exception the system allows — somebody has to be first — and it is recorded as such. His account shape is still normalised in Phase 1.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Exactly one row with role='admin', confirmed by read-back.
- [x] **F0.2 — Resolve the ghost account**  _(done 2026-09-03)_
  - The unnamed row from 10 July that never onboarded. Multi-user made it look like a legitimate member. Suspend it, or claim it as Dad's — deliberately either way.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Its account_status is what you chose, not what it defaulted to.
- [x] **F0.3 — Delete the stale pooler credential**  _(done 2026-09-03)_
  - `supabase/.temp/pooler-url` holds a database credential from the August link. Gitignored, but sitting on disk.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* File absent.
- [x] **F0.4 — Commit what's uncommitted**  _(done 2026-09-03)_
  - The vendored V9 source under `web/`, the NUL-gate allowlist for its three images, the migration's self-proof block, and the three apply/verify scripts.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Clean tree; full battery green; no `Bin` entries in the diff.
- [x] **F0.5 — Push and deploy**  _(done 2026-09-03)_
  - Push is deploy on this repo. Ships the per-person send ledger and the scoped readers.
  - *Owner:* Emil · *Proofs:* A4, A8
  - *Done when:* Deployment SUCCESS on the new commit.
- [x] **F0.6 — Verify the deploy**  _(done 2026-09-03)_
  - Eleven jobs at boot, /health 200 against a 404 control, zero error lines.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* scheduler.started names eleven jobs on the new deployment.
- [x] **F0.8 — Correct two stale canon claims and one broken script**  _(done 2026-09-03)_
  - CEDRUS.md still says 410 tracked files with zero binary and an allowlist that should stay empty (now 492, three, three), and still says `supabase/migrations/` does not exist while Law 8 in the same document says it does. Separately `scripts/local-dev-supabase.sh` claims its controls passed if the stack came up — it cannot: the only migration alters `app_users` rather than creating it, so `db reset` dies on a fresh local database.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Both canon lines match what is on disk; the script refuses rather than claiming a pass it cannot deliver.
- [x] **F0.9 — Close the NUL allowlist matcher hole**  _(done 2026-09-04)_
  - The allowlist entries are exact paths but the matcher is `case "$ALLOWLIST" in *"$f"*` — a substring test against one joined blob. A tracked file named `travel.png` at the repo root would be silently exempted. Latent today; a guard with a hole in it is still a hole.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* A line-exact match, with a mutation proving a same-named file at a different path is still scanned.
- [x] **F0.7 — Watch the first scoped brief run**  _(done 2026-09-04)_
  - The 11:00 UTC run after deploy is the first time eight tables are read with a user filter against real data. If a table lacks the column, the brief aborts loudly.
  - *Owner:* Claude Code · *Proofs:* A4
  - *Done when:* `verify-brief-run.mjs` exits 0 and the email arrives.

## Phase 1 — Provisioning and parity

Make one code path that creates a person, and run Emil's own account through it. This is the phase that makes him a normal user rather than the exception the system was built around.

- [x] **P1.1 — Write the bootstrap-admin exception into canon**  _(done 2026-09-04)_
  - One account must be admin before any account can be created. Record that as a named, one-time act — not a silent precedent for hand-editing accounts later.
  - *Owner:* Claude (Cowork) · *Proofs:* —
  - *Done when:* Stated in CEDRUS.md with the date and the reason.
- [ ] **P1.2 — Build provisionUser() as one atomic operation**
  - Sign-in, account row, settings defaults, capability grants and exactly one audit entry — or none of them. No table parameter, no caller-chosen ids.
  - *Owner:* Claude Code · *Proofs:* B4
  - *Done when:* Fail it midway; assert no partial account survives, with a control showing the successful path creates all five.
- [ ] **P1.3 — Backfill existing accounts through that same path**
  - Emil's July row gets its settings and capabilities from provisionUser, not from a hand-written INSERT. The ghost account too, if kept.
  - *Owner:* Claude Code · *Proofs:* B1, B2
  - *Done when:* Diff Emil's complete shape against a freshly provisioned account: empty. Control: two new accounts also diff empty.
- [ ] **P1.4 — Prove no environment variable names a person**
  - Boot with the legacy per-user variables set to nonsense and assert every person's brief still resolves from their row.
  - *Owner:* Claude Code · *Proofs:* B3
  - *Done when:* Test green with the nonsense values; red if a code path still reads them.
- [ ] **P1.5 — Close the remaining isolation proofs**
  - Cross-user writes refused (A2); anon reads nothing from every table holding a person's data (A5); owner resolution refuses rather than guessing (A9); no identifier crosses into another person's log trace (A10).
  - *Owner:* Claude Code · *Proofs:* A2, A5, A9, A10
  - *Done when:* All four proven with controls, all mutations red.

## Phase 2 — The brief, per person

The one thing that leaves the system unprompted. Getting this wrong sends someone else's morning to the wrong inbox, and it cannot be recalled.

- [ ] **B2.1 — Drive the brief from settings rows**
  - Recipient, enabled, hour, CoS identity and usage account all read per person from `user_settings`. The environment variables stop being read.
  - *Owner:* Claude Code · *Proofs:* B3, C2
  - *Done when:* Two accounts with different addresses each receive their own.
- [ ] **B2.2 — Iterate people, not the person**
  - One composition, one ledger claim, one recipient and one spend record each. The ledger key is already per person; the loop around it is not.
  - *Owner:* Claude Code · *Proofs:* C1, C2
  - *Done when:* Both send on the same UTC day; control: the same person is still refused twice.
- [ ] **B2.3 — Make a missing settings row loud**
  - `brief_enabled` defaults false, so the switchover could silently stop a brief with no error at all. Absence must announce itself.
  - *Owner:* Claude Code · *Proofs:* C3
  - *Done when:* A person with no row is announced and skipped; control: a person with a row sends in the same run.
- [ ] **B2.4 — Resolve the brief_email collision**
  - The field exists on both `app_users` (retired consumer machinery) and `user_settings`. Same name, two homes — the shape that has broken this system three times.
  - *Owner:* Claude Code · *Proofs:* C4
  - *Done when:* The suite asserts the two cannot diverge, or that the retired one is unreadable.
- [ ] **B2.5 — Honour each person's hour and timezone**
  - A fixed 11:00 UTC cron is one hour for everyone. Dispatch hourly and select whose hour it is.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Two people at different hours each get theirs at their hour.
- [ ] **B2.6 — Prove it on a real two-person morning**
  - Emil plus a second test account, both live, one morning, no crossover.
  - *Owner:* Claude Code · *Proofs:* C1, C5
  - *Done when:* Recipient asserted on the wire per send; zero citations resolve to the other person's records.

## Phase 3 — Sign-in and the API

An address Emil can open from anywhere, that knows who he is and shows only his day.

- [ ] **A3.1 — Wire Supabase Auth with a second factor**
  - Email and password plus 2FA, enforced in code rather than configuration. Identity comes from the token, never the request.
  - *Owner:* Claude Code · *Proofs:* D2, A3
  - *Done when:* A first-factor-only session is refused at a surface a full session reaches.
- [ ] **A3.2 — Build the per-person read API**
  - `/api/interface`: session, status, today's brief, workspace. Every response scoped to the caller. No shared token anywhere.
  - *Owner:* Claude Code · *Proofs:* A1, D1, D3
  - *Done when:* Unauthenticated gets 404 not 401; a second account's session sees none of the first's records.
- [ ] **A3.3 — Freeze the shapes in a contract**
  - A JSON Schema plus example fixtures generated by running the real handlers, and a battery stage that fails when they drift.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Examples validate; changing a response shape turns the suite red.
- [ ] **A3.4 — Serve the interface at /app as an installable app**
  - Same origin as the API, so no CORS. Manifest and icons so it goes on a phone home screen.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Opens on Emil's phone from the home screen, over cellular.
- [ ] **A3.5 — Deploy and verify the whole path**
  - Push, confirm the build produced the app bundle, confirm sign-in works from a device that has never seen it.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Signed in on a phone, not a laptop.

## Phase 4 — Connect the interface

V9 stops running on fixtures and starts showing the real system. This is where we decide what survives and what gets rebuilt.

- [ ] **C4.1 — Decide what of V9 is kept and what restarts**
  - The hard-coded day, the invented drift inbox and the decorative numbers are the candidates to rebuild. The visual system, the layer model and the Runs grammar are the candidates to keep.
  - *Owner:* Claude (Cowork) · *Proofs:* —
  - *Done when:* A written keep/rebuild list agreed before any code.
- [ ] **C4.2 — Add sign-in to the interface**
  - The app asks who you are before it shows anything, and shows only that person's data.
  - *Owner:* Claude Code · *Proofs:* A1
  - *Done when:* Emil signs in on his phone and sees his own day.
- [ ] **C4.3 — Render the real brief in Now**
  - Summary, priorities with the confidence gloss verbatim, citations, workspace state, the truncation note. The composition, not a hand-written sentence.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* This morning's actual brief renders in the app.
- [ ] **C4.4 — Drive Day and Atlas from the real workspace**
  - His real workstreams, loops and decisions. The drift inbox shows computed workspace state, not invented items.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* The five real workstreams appear, with their real missing next actions.
- [ ] **C4.5 — Make Connect tell the truth per person**
  - Each service's real state and freshness for the signed-in person, not a shared constant.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* The page's states match what the backend reports.
- [ ] **C4.6 — Remove or badge every remaining fixture**
  - Anything not computed is labelled demo, or deleted. No number on screen that the code cannot stand behind.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* A test fails on any bare figure that isn't derived or tagged.

## Phase 5 — Emil onboards as a user

The whole point. He goes through the same door his father and brother will, and if it is awkward for him it is unusable for them.

- [ ] **O5.1 — Build the admin panel**
  - Invite, revoke, grant a capability, read the audit trail. Every action audited with actor, action, target and time.
  - *Owner:* Claude Code · *Proofs:* B5, D4
  - *Done when:* Revoking access removes it from interface, brief and SMS at once; control: all three worked immediately before.
- [ ] **O5.2 — Re-provision Emil through the panel**
  - Not a database edit. The same invite-and-activate flow, so the path is exercised by the person who can fix it.
  - *Owner:* Emil · *Proofs:* B1, B2
  - *Done when:* His account diffs empty against a freshly provisioned one.
- [ ] **O5.3 — Set a password and a second factor from scratch**
  - As a new user would, on a device with no session.
  - *Owner:* Emil · *Proofs:* D2
  - *Done when:* Signed in with 2FA on a clean browser.
- [ ] **O5.4 — Connect his own things**
  - Phone number for SMS with consent recorded as a fact; brief address and hour; his own Markdown plans compiled into programs.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* A consent row exists with a timestamp and a source, not an assumption.
- [ ] **O5.5 — Write down every rough edge**
  - Anything confusing, unexplained or manual becomes a task before Dad sees it. He will not push through friction the way you will.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* A list, honestly kept, of everything you had to know that wasn't on screen.

## Phase 6 — Real data, real use

Cedrus stops being a system that describes work and becomes one that holds it. The brief has said the same thing for a week because the workspace has one actionable record.

- [ ] **R6.1 — Build the write API for the workspace**
  - Create and edit workstreams, next actions, target dates, outcomes; archive with a timestamp. Every write audited.
  - *Owner:* Claude Code · *Proofs:* A2
  - *Done when:* A write against another person's record is refused; control: the same write on your own succeeds.
- [ ] **R6.2 — Build programs and training sessions**
  - Markdown compiled into an immutable revision; sessions with planned, proposed and actual kept separate.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* Publishing the same source twice creates one revision, not two.
- [ ] **R6.3 — Wire the write surfaces into the interface**
  - Editing a next action or logging a set happens in the app, not in SQL.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* A change made on the phone appears in tomorrow's brief.
- [ ] **R6.4 — Enter the real projects**
  - The five workstreams with no next action and four with no target date are the reason the brief repeats. Fix them as data, not as code.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Workspace state stops reporting five workstreams with no next action.
- [ ] **R6.5 — Log a real training session live**
  - Start it, edit mid-session, finish it, and have the actual attach as evidence.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* One session with planned, proposed and actual all populated and different.
- [ ] **R6.6 — Get a morning brief that says something new**
  - The measure of everything above: a brief that differs from yesterday's because the underlying work moved.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Two consecutive briefs with different priorities.

## Phase 7 — Dad and brother

The gate. Isolation and parity must be proven before a second person's data exists, because being wrong here is not recoverable by fixing it afterwards.

- [ ] **T7.1 — Gate check: every A and B proof reads proven**
  - Not 'should be fine' and not 'the code looks right' — a test that fails when the property breaks, and a control showing the test can tell the difference.
  - *Owner:* Claude (Cowork) · *Proofs:* A1–A10, B1–B5
  - *Done when:* Fifteen proofs green with mutations red. Anything less and the gate is closed.
- [ ] **T7.2 — Invite Dad and let him onboard unaided**
  - No screen sharing, no walking him through it. If he needs help, that is a Phase 5 task that was missed.
  - *Owner:* Emil · *Proofs:* B1
  - *Done when:* He reaches his own day without being told anything not on screen.
- [ ] **T7.3 — Add his number to SMS with consent recorded**
  - Allowlisting the number is the technical step. Recording consent is the legal one, and they are not the same step.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* A consent event with a timestamp and a source.
- [ ] **T7.4 — Verify a real two-person morning**
  - Both briefs arrive, each from that person's records only, each to the right address.
  - *Owner:* Claude Code · *Proofs:* C1, C5
  - *Done when:* Zero crossover in citations; recipient asserted per send.
- [ ] **T7.5 — Invite your brother**
  - Third account, same flow, nothing new written to support him. If anything had to change, parity was not real.
  - *Owner:* Emil · *Proofs:* B1
  - *Done when:* No code or configuration changed to add the third person.

## Phase 8 — The Mac Studio

Local inference and agent execution on hardware you own, reachable from anywhere over the tailnet, never from the public internet.

- [ ] **M8.1 — Set it up on the tailnet with no public ports**
  - Wired, always on, reachable by the three of you from anywhere. Nothing exposed to the internet.
  - *Owner:* Emil · *Proofs:* D5
  - *Done when:* A public probe fails while the tailnet probe succeeds.
- [ ] **M8.2 — Install and benchmark the local model**
  - A 70B at 8-bit fits comfortably in 128 GB. Measure tokens per second and time to first token before depending on it.
  - *Owner:* Emil · *Proofs:* —
  - *Done when:* Real numbers written down, not expected ones.
- [ ] **M8.3 — Give each person their own execution root**
  - One machine, three people's work, three separate roots on the filesystem.
  - *Owner:* Claude Code · *Proofs:* E1, E5
  - *Done when:* A path escaping the root is refused; control: a legitimate path inside it succeeds.
- [ ] **M8.4 — Build the pinned-verb executor**
  - The model proposes; a closed list of verbs executes. No shell and no path to one.
  - *Owner:* Claude Code · *Proofs:* E2
  - *Done when:* A refused verb is driven in the suite, not only a permitted one.
- [ ] **M8.5 — Walk the dry-run and approval ladder**
  - A rehearsal writes nothing and advances no cursor; a scoped receipt exists before any write.
  - *Owner:* Claude Code · *Proofs:* E3, E4
  - *Done when:* Control: the live run does both, in the same suite.
- [ ] **M8.6 — Feed Observer digests into agent runs**
  - Machine work stops being invisible. The brief has said 'no agent run appears' every morning since it started.
  - *Owner:* Claude Code · *Proofs:* —
  - *Done when:* The brief stops saying no agent run appears.

