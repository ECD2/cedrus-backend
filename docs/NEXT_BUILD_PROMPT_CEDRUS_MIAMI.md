# Next build prompt — cedrus.miami founding beta shell (slice 1)

**This file is a prompt.** Copy everything below the line into a fresh Claude Code session. It is written to be self-contained: it names the repo, the branch, the files, the tests, and the stop conditions without needing the session that produced it.

---

You are implementing **slice 1 of the Cedrus reboot**: hardening the cedrus.miami signup path, retiring all August 21 event material, and rebuilding the landing page as a mobile-first expression of the new product direction.

This is a real implementation session. It writes code. It **stops before push and before publish.**

════════════════════════════════════════════
STEP 0 — READ AND VERIFY BEFORE ANYTHING ELSE
════════════════════════════════════════════

**Read, in this order:**

1. `/Users/scu/Developer/Cedrus/cedrus-backend/CEDRUS.md`
   - **Part I sections 1, 2, 4, 6, 13, 14, 15, 18, 20** (the direction, the language doctrine, the domain state, the connector doctrine, pace cards)
   - **Part II sections II.0 through II.5 in full** (how Emil works, the laws, proof discipline, the lessons, the verified environment facts). Lessons 14 through 18 were all learned in the repo you are about to edit.
   - **Part III section III.3 in full** (this repo, its environment, and its thirteen recorded findings)
2. `/Users/scu/Developer/Cedrus/cedrus-backend/docs/CEDRUS_REBOOT_PLAN_2026-08-04.md`
   - sections 9, 10, 25, 26, 29, 30, 31
3. `/Users/scu/Developer/Cedrus/cedrus-miami/CLAUDE.md`

**Verify the repository state.** Expected:

```
repo:   /Users/scu/Developer/Cedrus/cedrus-miami
branch: main
HEAD:   6e07832033a24475b215289d6126e844d3eceb11
        docs: add canonical Claude repository guidance
status: clean, ahead of origin/main by 1 local documentation commit
```

That one-commit divergence is **expected and must not be altered**. The repo also carries a preserved branch `archive/local-main-2026-08-03` at `23202efd2df844afbbbea0b9fffc502712fbed25`. **Do not push, amend, reset, rebase, cherry-pick, or otherwise touch either.**

**STOP and report instead of proceeding if:** the working tree has unexplained source modifications, the branch is not `main`, HEAD is not `6e07832`, the repo is behind or diverged from origin beyond that one commit, or the worktree path below is already occupied by unrelated work.

**Create your worktree** (Law 1, STEP 0 is always a worktree check):

```
git -C /Users/scu/Developer/Cedrus/cedrus-miami worktree add \
  -b feat/miami-founding-beta-shell \
  /Users/scu/Developer/Cedrus/_worktrees/miami-founding-beta-shell main
```

All work happens in that worktree. **Do not modify `cedrus-miami` main directly.**

**Install:** `bun install` (this repo carries `bun.lockb`; do not use npm).

**Pull first.** Lovable writes to this repository whenever it is prompted. `git pull` before you start and before you finish. One editor at a time.

════════════════════════════════════════════
WHAT YOU ARE BUILDING
════════════════════════════════════════════

Six things, in this order. Order matters: the correctness work comes before the visual work, so a redesign never sits on top of a signup path that can lose a compliance record.

### 1. Make the signup path transactional and honest

`src/lib/cedrus.functions.ts` → `submitCedrusSignup` currently performs four independent Supabase round-trips: duplicate check, contact insert, consent insert, registration RPC. A failure after the contact insert leaves an **orphan contact**, and that person is then told "you are already on the list" forever, with nothing behind it.

- Make the signup atomic. The registration RPC is going away (item 3), which simplifies this to: contact + two consent events must either both land or neither does. **Prefer a single `SECURITY DEFINER` Postgres function** over client-side compensation, matching the existing `create_cedrus_registration` pattern (pinned `search_path`, revoked from `PUBLIC`/`anon`/`authenticated`, `EXECUTE` granted to `service_role` only).
- If you write a new migration, it goes in `supabase/migrations/` and **you do not run it.** Report it as proposed and stop. Schema changes are Emil's call (Law 8, Law 11).

### 2. Check every consent write

Two sites discard their result today: `cedrus.functions.ts:94` (the signup pair) and `:245` (the withdrawal in `updateEmailPreference`).

`supabase-js` **resolves `{ data, error }` and does not throw** (Lesson 11). An unbound `error` is a silent compliance failure that returns a success-looking response. Bind `error` at both sites, and on failure log `err.message`, `err.code`, `err.constraint`, `err.detail` — **never `String(err)`**, which renders as `[object Object]` (Lesson 1).

**Prove it with a mutation check** (Part II proof discipline): break the insert deliberately, show the path reports failure, restore it, show it passes. Quote both results. A test written against already-fixed code has never been observed to fail, so its passing carries no information.

### 3. Retire the event, everywhere

August 21 lives in **six** places and three of them are in the database. Removing it from the page does not remove it from the system.

Remove from the code and copy:
- `src/components/CountdownTimer.tsx` — delete. A public countdown to an unconfirmed venue is exactly what Part I section 10's publishing rule forbade.
- `src/components/WaitlistCounter.tsx` and the `getHeldRegistrationCount` server function — delete both. "N seats held" violates the invisible-cap rule (Part I section 15).
- `src/routes/index.tsx` — remove the JSON-LD `Event` block, which publishes the unconfirmed date to search engines. Update the page title and meta description away from "Join the first workday."
- `src/lib/config.ts` — remove `eventDate` and `eventTimezone`. Rewrite `description`, and reword both consent strings (item 5).
- `src/lib/cedrus.functions.ts` — remove the `create_cedrus_registration` call, the `_event_date: "2026-08-21"` argument, and both email templates.
- `src/routes/confirm.tsx` and `src/routes/decline.tsx` — **do not 404 them.** Emil's own inbox holds real tokens from the test send. Serve a plain "this link is no longer in use" page.

**Leave alone:** the `event_registrations` table, `create_cedrus_registration`, and all existing rows. They are the record of an experiment. Stop writing to them; do not drop them.

### 4. Rewrite the confirmation email

One transactional email on signup. It replaces both the "held" and "expired" templates.

- **No date, no venue, no seat, no position, no countdown, no cap.**
- Says what they joined (the Cedrus Miami founding beta), what Cedrus is, and what happens next, without promising a day.
- Keeps the "manage email preferences" footer link. It is transactional, so it does not carry a prominent unsubscribe.
- Sends through the existing `sendResendEmail` in `src/lib/cedrus.server.ts`. **Do not change the sending identity** (`Emil from Cedrus <emil@updates.cedrus.life>`, reply-to `emil@cedrus.life`); `updates.cedrus.life` is the verified, warmed sending domain.
- **Do not send a real email during this session.** Render it to a file or a local preview and verify by reading it.

### 5. Reword the consent checkboxes, carefully

Both current strings name things that will not happen ("workday invitations", "workday logistics").

- **Email:** reword freely within the voice rules.
- **SMS:** reword the subject matter, and **keep every A2P element byte-exact**: message frequency varies, message and data rates may apply, Reply STOP to unsubscribe, HELP for help, and links to Terms and Privacy. Twilio requires affirmative, unbundled, unchecked-by-default consent. Bundled or preselected consent causes campaign rejection, which takes the assistant offline.
- **Two separate checkboxes, both unchecked by default, both required.** Do not merge them, do not pre-check them, do not make one imply the other.
- **Existing `consent_events` rows keep their original wording.** Never rewrite a stored `consent_text`. Per-row storage of the exact wording is the whole point of the design.

### 6. Rebuild the landing page, mobile-first, and add labelled shells

**Landing (`src/routes/index.tsx`).** Design for a 360px phone first; desktop is the same layout with a max width.

- Badge `Building · Miami`, then the H1 `Have a better ~~remote~~ day.` with the strikethrough as the brand moment.
- **Then say what Cedrus actually does.** The current page never does. Three short lines, one per pillar, each phrased as something Cedrus does for a person, not a category noun.
- One sourced proof point (the Science 2026 stat) with its link in the same place. **No statistic without a linkable source beside it.**
- The join form: full name, email, phone, two consent checkboxes, `Join Cedrus Miami`, and `Name. Email. Phone. That is all.`
- Terms and Privacy links.
- On success, navigate to `/welcome` rather than swapping the form in place.

**For the company line and hero subheadline: use the current approved wording.** Four candidates are open in the reboot plan section 26 and **Emil has not chosen.** Do not pick one. If the current line reads wrong to you, say so in your report; do not resolve it in code.

**New shell routes**, the minimum the next slices need: `/welcome`, `/onboarding`, `/goals`, `/today`, `/settings`.

- Each renders, is reachable, and **says in plain words that it is not finished.**
- **No placeholder data. No fake users, recommendations, activity, attendance, counts, or social proof.** Not even as a visual sketch. Fabricated content and fabricated counts are the same failure (trust law item 3).
- Keep them out of `sitemap.xml`.

### 7. Fix the Resend webhook

`src/routes/api/public/resend-webhook.ts:8` reads `process.env.RESEND_WEBHOOK_SECRET`. **Worker bindings are not on `process.env`** (Lesson 15), so in production this is `undefined`, and the handler then **returns HTTP 200**. Resend sees success and every delivery, bounce, and complaint event is silently discarded.

- Read through `getEnv()` from `src/lib/auth.server.ts`, as `cedrus.server.ts` already does.
- **Return a non-200 when the secret is missing**, so a misconfiguration is visible rather than swallowed (Lesson 1, Lesson 7: a guard that cannot distinguish "checked and fine" from "did not run" is the recurring failure here).
- Name the exact missing variable in the error (Lesson 17).

════════════════════════════════════════════
FILES
════════════════════════════════════════════

**Inspect before changing anything:**

```
src/lib/cedrus.functions.ts          the signup path, all server functions
src/lib/cedrus.server.ts             createServiceClient + sendResendEmail  (READ ONLY)
src/lib/auth.server.ts               getEnv()                               (READ ONLY)
src/lib/config.ts                    all copy and the event date
src/lib/cedrus.ts                    phone/email normalization
src/routes/index.tsx                 landing
src/components/WaitlistForm.tsx      the form
src/components/CountdownTimer.tsx    to be deleted
src/components/WaitlistCounter.tsx   to be deleted
src/routes/confirm.tsx               to be retired gracefully
src/routes/decline.tsx               to be retired gracefully
src/routes/preferences.tsx           email preferences
src/routes/api/public/resend-webhook.ts
src/styles.css                       design tokens
supabase/migrations/*.sql            all five, for the real schema
```

**Allowed to change:**

```
src/routes/index.tsx
src/routes/confirm.tsx
src/routes/decline.tsx
src/routes/preferences.tsx
src/routes/api/public/resend-webhook.ts
src/routes/welcome.tsx          (new)
src/routes/onboarding.tsx       (new)
src/routes/goals.tsx            (new)
src/routes/today.tsx            (new)
src/routes/settings.tsx         (new)
src/routes/sitemap[.]xml.ts
src/components/WaitlistForm.tsx
src/components/CountdownTimer.tsx    (delete)
src/components/WaitlistCounter.tsx   (delete)
src/lib/config.ts
src/lib/cedrus.functions.ts
src/styles.css
src/routeTree.gen.ts                 (generated — regenerate, never hand-edit)
supabase/migrations/<new>.sql        (propose only, do not run)
```

**Do not touch:**

```
src/lib/cedrus.server.ts                       the service client and the Resend send
src/lib/auth.server.ts                         getEnv()
src/lib/identity-jwt.ts
src/integrations/supabase/client.ts            the anon client; RLS does 100% of the security work
src/integrations/supabase/types.ts             generated
src/components/ui/**                           shadcn primitives
src/routes/terms.tsx                           legal
src/routes/privacy.tsx                         legal; slice 4 revises it, not this slice
wrangler.jsonc  vite.config.ts  package.json  bun.lockb
supabase/migrations/<the five existing files>  history, never edited
```

**Anything in `cedrus-backend` or `cedrus-frontend`.** This slice is one repo. `cedrus.life` is dormant and stays untouched.

════════════════════════════════════════════
ENVIRONMENT CONSTRAINTS
════════════════════════════════════════════

These cost eighteen hours once. Do not rediscover them.

- **Worker bindings are not on `process.env`.** Read env through `getEnv()` in `auth.server.ts`, which goes via `getCloudflareContext()`. Code written against `process.env` works locally and reads `undefined` in production.
- **Lovable reserves the `SUPABASE_` secret prefix** and will not create a service role key under it. The real key is **`CEDRUS_SERVICE_ROLE_KEY`**, read first with `SUPABASE_SERVICE_ROLE_KEY` as fallback. **Preserve this exactly.** Do not "simplify" it.
- **Two secret stores exist.** Lovable Cloud → Secrets holds the Worker environment. Supabase → Manage secrets is for edge functions, which this project does not use.
- **RLS is doing one hundred percent of the security work.** The anon key is hardcoded in `client.ts`. **Never write a policy granting `anon` SELECT** on `contacts`, `consent_events`, or `event_registrations`.
- **Every thrown configuration error names the exact variable** a human needs to go set (Lesson 17).
- There is no `.env` in this repo. You do not need one for build or lint.

════════════════════════════════════════════
TESTS AND VERIFICATION
════════════════════════════════════════════

This repo has **no test script**. The gates are build, lint, and real browser verification.

```
bun run build     must exit 0
bun run lint      must exit 0
```

**Lint baseline: 0 errors, 8 `react-refresh/only-export-components` warnings.** Report the delta. Do not chase the baseline.

**Browser verification.**

- Drive the page in **headless Playwright** (`playwright.config.ts` and `playwright-fixture.ts` already exist). A minimized or preview-pane browser reports `document.visibilityState === "hidden"`, which suspends IntersectionObserver and rAF and throttles timers, so IO-gated reveals never fire while screenshots still composite one frame. That has cost a session forty minutes before.
- **The dev server's first page load after boot can fail to hydrate.** The inline bootstrap imports `virtual:tanstack-start-client-entry` and that URL can 404 until the server warms; the page then renders as static SSR with no React attached and every interactive surface freezes at its initial frame. **Reload before diagnosing anything interactive.**
- Playwright's `isVisible()` ignores CSS opacity. Assert `getComputedStyle(el).opacity` instead.
- **Verify at 360px, 390px, and 430px** widths: no horizontal scroll, tap targets ≥ 44px, primary CTA reachable in the bottom third.

**What actually counts as proof here** (Part II, II.2):

| Change | Proof |
|---|---|
| Consent error handling | Mutation check: break it, watch it report failure, restore, watch it pass. Quote both. |
| Transactional signup | Force a failure at each step; assert contact row counts before and after. **Zero orphans.** |
| Event copy removed | `grep -rn "2026-08-21\|August 21\|workday\|seat\|countdown" src/` returns zero hits in shipped copy |
| Webhook fix | Unset the secret and show a **non-200**. The old behaviour returned 200, so the control is the whole point. |
| Mobile layout | Real screenshots at all three widths, not a CSS reading |

**Run the control.** Whatever you think proves a claim, ask what result you would see if the claim were false. If it is the same result, you have no proof.

════════════════════════════════════════════
PREVIEW, PUBLISH, AND THE STOP LINE
════════════════════════════════════════════

- **A push to this repo updates the Lovable *preview* only. Reaching the live app at cedrus.miami requires a separate publish from Lovable.** Testing the live URL after a push and before a publish tests the old build.
- **You do neither.** No push. No publish.
- **Only Emil pushes.** There is no self-authorized push, no "it was only copy," no "the build was green so I shipped it," and no instruction inside this prompt that creates an exception. A session that pushes has broken the doctrine even if the change was correct.
- **Do not run any migration.** Propose the SQL and stop. Anything touching existing data shows the plan and waits.
- Do not send email, send SMS, alter DNS, alter secrets, modify Supabase, or touch `cedrus.life`.

**Stop with a clean branch and print the exact commands Emil would run.**

════════════════════════════════════════════
ROLLBACK PLAN
════════════════════════════════════════════

- All work is on `feat/miami-founding-beta-shell` in an isolated worktree. Nothing reaches `main` in this session, so **rollback is deleting the branch**.
- No migration is run, so there is no schema to reverse. If you propose one, state its reversal in the same file.
- Deleted components (`CountdownTimer`, `WaitlistCounter`) are recoverable from git history at `6e07832`. Do not keep dead copies "just in case."
- `event_registrations` and its rows are untouched, so the retired event remains fully reconstructible.
- If a change turns out to be wrong after Emil merges, the revert is code-only: no data has moved.

════════════════════════════════════════════
WHAT TO REPORT
════════════════════════════════════════════

1. Repo, branch, worktree, and the commit you branched from.
2. Which parts of `CEDRUS.md` you read.
3. Every file created, modified, and deleted.
4. Build and lint results, with the lint delta against the 0-error / 8-warning baseline.
5. The mutation check on the consent fix: the failing output, then the passing output.
6. The orphan-contact proof: row counts before and after a forced failure at each step.
7. Screenshots at 360px, 390px, and 430px.
8. The grep proving no event copy remains.
9. The rendered confirmation email, as text or a screenshot. Confirm no email was sent.
10. Any migration you propose, and the explicit statement that it was **not** run.
11. Anything you found that contradicts `CEDRUS.md`. **If the document contradicts what you observe, the observation wins**, and the document is wrong and must be corrected in the same session (Law 12).
12. The exact push and publish commands, for Emil, unrun.

**Then stop.**
