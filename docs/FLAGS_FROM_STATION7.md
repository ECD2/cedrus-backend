# FLAGS from Station 7 — interests-table gap (discovery blocker)

Station 7 owns docs + a read-only audit + one small read-path fix. It does not
edit shared files. Two shared-file touches are needed by others; both are listed
here as exact one-line changes, not applied by this worktree.

## 1. Register the new regression test bundle (`test/run-tests.sh`)

A new, self-owned test file proves the read-path fix (discovery degrades when the
`interests` table is still absent). It follows the existing concat-rig bundle
shape (identical to Bundle 13's discovery line). Append after Bundle 16:

```sh
# ── Bundle 17: interests read-path — discovery gather degrades when interests table is absent
section "discovery interests degradation"
run_js "$(bundle test/reliability-core.js src/services/discovery.js test/discovery-interests-degradation.test.js)"
```

Validated standalone in this worktree (bundled the same way and run under node):
all 9 assertions PASS, and the existing Bundle 13 (`test/discovery.test.js`) still
PASSES against the edited `src/services/discovery.js`. In-session runs are
advisory under parallel load; the gate is the full-battery re-run on merged main.

## 2. Run the interests foundation migration at the Supabase ceremony

`docs/INTERESTS.proposed.sql` (new) reconstructs the missing N5
`20260719120002_interests_foundation` table. It is PROPOSED — NOT EXECUTED (house
rule: Emil runs migrations through the Supabase ceremony). This worktree ran no
SQL. Read the header notes before running — two items need a human confirm:

- **FK target** `app_users(id)` — confirm against the live schema.
- **RLS row-ownership predicate** — `interests.user_id = app_users.id`, mapped
  from the JWT via `app_users.auth_user_id`, NOT `auth.uid()` directly. The file
  writes the through-`app_users` form; confirm it matches the live
  facts/people/dunbar_tier browser-read policies.

## Not needed (verified, no action)

- **Route mount**: `/api/interests` is ALREADY mounted in `src/index.js:45`
  (`app.use('/api/interests', interestsRouter)`). No mount flag required.
- **No change to `src/services/interests.js`**: it already matches the proposed
  schema exactly. The only code change this cycle is the discovery gather's
  call-site catch.
