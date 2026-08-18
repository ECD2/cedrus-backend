# Overnight session — five tasks, 2026-08-18

**Read:** CEDRUS.md Parts II and III.
**Merged to local `main`, NOT pushed.** Battery green on merged main at every step.

Branches, each its own worktree (Law 1), each merged and battery-gated in turn:
`feat/nul-guard-2026-08-18`, `fix/scrub-phone-regex-2026-08-18`,
`fix/dry-run-recording-2026-08-18`, `audit/dead-guards-2026-08-18`,
`docs/canon-2026-08-18`.

## 1. NUL guard

`test/no-nul-bytes.sh`, first stage of the battery. Scans all tracked files.
Structural rather than advisory: it verifies its own detector on every run
(positive control, negative control, and an empty scan is an explicit failure),
so it cannot pass having examined nothing.

The negative control earned its keep on the first run. `has_nul()` used
error-code convention (1 = found) where shell wants truth-value convention
(0 = true). With that inversion the POSITIVE control still printed PASS by
accident of branch ordering, while every clean file was flagged. One control
would have shipped the bug.

410 tracked files, zero legitimately binary, allowlist empty.

## 2. Dead-guard audit

Every condition enforced in more than one place, each layer mutated
independently, measured against the full battery.

Already observable on both layers, no change needed:
  - outbound SMS allowlist (selection filter + wire refusal)
  - CoS send ledger (read check + 23505) — distinguishable since yesterday's
    `sentAt` assertion, which only the read path can produce
  - ResendTransport (constructor gate + send() re-check)
  - budget guard (scheduler / inbound pipeline / broadcasts — complementary,
    not duplicated; all three observable)
  - opted_out — NOT duplicated. Loaders filter it for briefs and nudges;
    reminders and card jobs read app_users directly and check it themselves.
    One enforcement point per path, each observable.

The one real gap: **the card rail's compare-and-set**. Four mutations left the
battery green. Nine assertions added to Bundle 30; all four now go RED.

## 3. The category the dichotomy missed

Yesterday an uncatchable mutation meant the guard was DEAD (`briefMode`
precedence encoded three times over) and the fix was to collapse it. Applying
that here would have deleted the only thing stopping two overlapping ticks from
sending a card twice.

An uncatchable mutation has two meanings demanding opposite actions: the guard
is unreachable (collapse), or it is real and the test never drove its failing
branch (falsify). Decide by asking what would have to happen in production for
the branch to run. Written up as Lesson 19.

And the corollary, which bit inside this same audit: the first CAS test passed
for the wrong reason, because `seedBase()` sets `config.briefDryRun = true`
(`prelude-cards.js:47`) and the dry-run branch, not the refused claim, was
stopping the send. **A test asserting "nothing was sent" must prove sending was
possible.** Every such assertion is now paired with a control that really sends.

## 4. Dry-run recording

`recordBriefSent()` and `openPendingPrompt()` ran under `BRIEF_DRY_RUN`, and
every dry-run branch logged `outcome: 'sent'`. Fixed. `markSent()` deliberately
still runs — it is the re-dispatch guard, not a delivery claim.

### Production damage, measured read-only. NOT cleaned.

| Where | Count | Verdict |
|---|---|---|
| `messages` rows, `weekly_brief / dry_run` | 6 | **honest** — correctly tagged |
| `messages` rows, `reply|onboarding / null` | 7 | **real** — TwiML replies, the only true outbound path |
| **`app_users.total_briefs_sent`** | **3 + 3 = 6** | **false** — phantom deliveries, both users |
| **`app_users.last_brief_sent_at`** | **2** | **false** |
| **`briefs` rows `status='sent'` + `sent_at`** | **6** | **false** — never delivered |
| `opportunity_cards`, `reminders` | 0 | n/a |

**So: zero false rows in `messages`.** The prompt's framing assumed the false
outbound rows were there; they are not. `messages` was already telling the
truth. The falsehood is entirely in the counters and the `briefs` rows.

## 5. Scrub bug

Phone regex treated `-` as a separator, so `2026-08-15` became `[phone:0815]`.
Fixed by masking ISO timestamps before the phone pass, **not** by a negative
lookbehind — `(?<![\d-])` also stops redacting `call-7869727469`, and a false
negative leaks a phone number while the bug it fixes only mangles a date. The
two errors are not symmetric. Bundle 39, 59 assertions; every phone case asserts
both that the marker appeared AND that no 7-digit run survives anywhere.

## Could not verify

- **`briefs.sent_at` is still written under dry run.** Nulling it would be the
  honest fix, but `briefs` has no DDL in this repo and its nullability cannot be
  checked without a schema read I could not do under the hard stops. Left alone
  and filed in III.1 rather than guessed at.
- **The unbound-`error` fraction.** II.5's "45 of 101" denominator is now 114
  call sites; the numerator was NOT re-counted. Marked stale in canon rather
  than replaced with a number I did not measure.
- **Nothing was run against the live scheduler.** The 11-job registration is
  proven by `scheduler.started` in the deploy logs from the previous session,
  not by observing a tick.

## Process error worth recording

A `cd` into the main repo for a read-only prod query silently changed the
working directory for every later command, so a commit intended for a worktree
ran against `main` (it failed harmlessly — nothing to commit). **`cd` inside a
long session is sticky.** Prefer absolute paths, or re-assert the worktree path
at the top of each step.
