# Session A — the multi-user foundation

**2026-08-30 · branch `feat/multiuser-foundation-2026-08-30` → merged `--no-ff` into `main` · NOTHING PUSHED**

Read: `CEDRUS.md` Part II (Laws 1–12, II.2 proof discipline, II.5 verified
environment facts, the bundle registry), `CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md`,
`cos_live_reads_2026-08-26.json`, `railway_logs_2026-08-26*.txt`.

## What Emil runs, in order

1. Six history repairs, then the apply, then the post-check — all in
   [docs/MIGRATION_PATH.md](docs/MIGRATION_PATH.md).
2. **Before deploying the code**, one SELECT against the *Chief of Staff*
   project to confirm `email_ai_analyses.user_id` exists (Step 4 of that
   document). If it does not, the daily brief aborts every morning.
3. `git push` — Law 5, Emil's alone. Nothing here has been pushed.

## Results

| Stage | Result |
|---|---|
| Baseline battery at `ea82371` | **2466 PASS**, 0 FAIL, exit 0 |
| After the code changes, before Bundle 41 | 2466 PASS, 0 FAIL, exit 0 |
| Branch battery, everything tracked | **2525 PASS**, 0 FAIL, exit 0 |
| **Merged main (the real gate, Law 4)** | **2525 PASS**, 0 `^  FAIL`, exit 0 |
| `test/mutate-bundle-41.sh` | **9 guards RED, 0 missed**, restore checksum-verified |
| `test/mutate-bundle-38.sh` | 48 guards RED, 0 missed |
| `test/mutate-bundle-40.sh` | 14 guards RED, 0 missed |
| `test/no-nul-bytes.sh` | clean, 484 tracked files |
| `git diff --stat 72d10f0..HEAD` | no `Bin` entries |

The +59 is Bundle 41 (`test/multiuser-isolation.test.mjs`).

## The bug that mattered most

`ledgerKey(now)` returned `cos_brief_send:<date>` — **one claim per day for
everyone**. The first brief composed took the day; the second person was
refused `already_sent` down the **fail-closed** path, which in the logs is
byte-identical to correct duplicate prevention. Dad's brief would never have
arrived and nothing anywhere would have said so.

Now `cos_brief_send:<user_id>:<date>`, and `ledgerKey()` **throws** without a
user id rather than defaulting — a default would rebuild the global key under a
new name and bring the silence back.

Proven, not asserted: `mutate-bundle-41.sh` guard 1 reverts to the day-only key
and Bundle 41 goes RED. That is what makes its passing mean anything.

## What the audit found that the amendment did not

Two things, both from reading files rather than working from the brief:

1. **`resolveCosUserId()` memoized one owner id in a process-global slot**
   (`let cachedUserId`). Iterating users in one process, user A's id would be
   returned for user B, and **B's brief would be written back to CoS attributed
   to A** — a cross-user leak with no read involved. Now a `Map` keyed by CoS
   project, and unreachable once a caller names a user.

2. **`email_ai_analyses` is read by the brief but is not in the live column
   dump**, so whether it carries `user_id` is unverified. Adding the filter to a
   table without the column returns `42703`, and the reader fails closed, so the
   whole brief aborts. This is the one thing in the session that could take
   production down, which is why it is Step 4 above and not a footnote.

## The isolation boundary

`cosSelect` is **gone from the export surface**. The only door is
`forUser(userId).select(table, build)`, which applies `.eq('user_id', userId)`
before the caller's narrowing; PostgREST builders are additive, so `build` can
narrow and cannot widen. `forUser()` throws on a missing id. An unscoped
service-role read is not discouraged — it is unexpressible.

All eight readers were unscoped, and the module header explained why
("CoS is a one-owner app"). That comment was rewritten rather than deleted:
left standing it would talk a future session out of the fix. One of those reads
is `plain_text_excerpt` — real message bodies — which is what makes this a
privacy breach rather than merely wrong data.

Bundle 41 **pins the entire client export surface**, so any new door fails the
battery until someone adds it to the pin deliberately.

## Two incidents worth keeping

**The NUL.** I wrote a raw NUL into `docs/SINGLETON_AUDIT_2026-08-30.md` while
quoting `client.js`'s memoization fingerprint — the third such incident here,
and the second where the NUL was typed while writing *about* NULs. It passed
every branch run and turned the merged-main battery red. The reason is now in
II.5: **`no-nul-bytes.sh` scans `git ls-files`, so an untracked file is
invisible to it.** Run the gate after `git add`. It is also the cleanest
demonstration of Law 4 this project has — the pre-merge battery was green and
proved nothing about after the merge.

**The trap.** `mutate-bundle-38.sh` and `-40.sh` had no `trap`, so an
interrupted run left source mutated on disk (2026-08-26). Before adding the
trap I reproduced it deliberately: TERM at the moment the source was genuinely
mutated left `scripts/verify-brief-run.mjs` broken with a stray `.bak`. The
identical interrupt against the trapped version restored it byte-identically.
Then a 2-minute tool timeout killed a real mutation run mid-flight later in the
session — the tree came back clean, unprompted.

## Unverified, stated plainly

- **The `supabase` CLI is not installed on this machine** (`which supabase` →
  not found). No migration was run, rehearsed, or syntax-checked by a database.
  The SQL is reviewed by hand only.
- **The six file-less remote versions come from the session prompt**, not from
  `supabase migration list --linked`. If the real list differs, regenerate the
  repair commands from it.
- **`email_ai_analyses.user_id`** — see above.
- **No production state was read.** Everything about prod in this session comes
  from the two supplied artifacts, per Law 10 and the session rails.

## Files

Changed: `src/services/cos/{client,reader,writer,ledger}.js`,
`src/jobs/cosDailyBrief.js`, `src/routes/api/auth.js`,
`test/cos-daily-brief.test.mjs`, `test/mutate-bundle-{38,40}.sh`,
`test/run-all.sh`, `CEDRUS.md`, `~/Downloads/CEDRUS_MASTER_CONTEXT.md` (§2, §10).

Added: `docs/SINGLETON_AUDIT_2026-08-30.md`, `docs/MIGRATION_PATH.md`,
`supabase/migrations/20260830120000_multiuser_foundation.sql`,
`test/multiuser-isolation.test.mjs`, `test/mutate-bundle-41.sh`.

Also committed at the start of the session, from 2026-08-28's uncommitted work:
the vendored V9 interface under `web/` (55 files) and its three-PNG allowlist in
`test/no-nul-bytes.sh`, verified with a control.

`web/` was not otherwise touched. No `railway` command was run. No credential
appears in any file or transcript. No database write of any kind.
