

---

# Rung 1 — CoS reader armed, and the three fixes it forced

**Merged to local `main`. NOT pushed.** Battery green on merged main at every step.

Branches: `fix/cos-column-original-body-2026-08-20`,
`feat/cos-read-retry-2026-08-20`, `feat/cos-schema-check-2026-08-20`,
`docs/canon-rung1-2026-08-20`.

## What rung 1 found

Arming the reader against production immediately produced a failure the entire
green battery had been unable to see: the reader asked CoS for
`agent_runs.report_body`, a column CoS does not have. Its name is
`original_body`.

The first probe reported `PGRST303 JWT issued at future` on that same table,
which looked like clock skew. Running it three times two minutes apart
separated two independent faults:

| Fault | Signature | Verdict |
|---|---|---|
| `PGRST303` | different table each run, absent in between | clock skew, transient |
| `42703` on `agent_runs` | every run, identical | deterministic — my bug |

The skew had **masked** the column error on the first probe. Only repetition
separated them.

## Three fixes

1. **Column.** `report_body` to `original_body` in the reader, the composer, its
   comment and both fixtures.
2. **Bounded retry.** `PGRST303` retries 3× with increasing backoff; everything
   else fails on the first attempt. A one-entry opt-in allowlist, because
   wrongly retrying a permanent error buries the cause while wrongly
   not-retrying a transient one is visible and self-correcting.
3. **Structural.** `test/cos-schema-check.mjs` validates all 75 requested column
   names against PostgREST's own OpenAPI document. Skipped-and-announced without
   credentials. Proven against the real bug.

## Live result

All 8 tables read, 0 failures, stable across 3 consecutive runs:

    workstreams 5 · open_loops 2 · decisions 1 · captures 1
    agent_runs 0 · email_messages 0 · email_ai_analyses 1 · today_briefs 2

`email_messages` is **0** because CoS's email sync is manual-only and has not
been run. The brief has no email to include yet — worth knowing before rung 4.

## Mistakes I made in this session

- **Committed a `node_modules` symlink.** `.gitignore`'s `node_modules/` matches
  a directory, not a symlink of that name, so `git add -A` took it. Merging it
  pointed node_modules at itself and destroyed the real directory. Fixed, and
  the pattern hardened.
- **A textual regression pin.** Grepping reader.js source for the old column
  name broke as soon as a comment mentioned it. Now asserts on exported data.
- **An invented log field.** `attempts` is not in `STRUCTURAL_FIELDS`, so
  `buildLogRecord` silently dropped it while the test passed on message text.
  Switched to the allowlisted `retry_count`.
- **`cd` stickiness again**, and **backticks in a heredoc** being shell-expanded
  into a commit message. Both previously recorded; both repeated.

## Not verified

- The retry has **not** fired against real skew — no `PGRST303` occurred in the
  three post-fix runs. Both paths are unit-proven and mutation-checked, but the
  production recovery path is untested in production.
- The `sb_secret_`-as-Bearer question is settled only for reads that work; I
  never observed a valid new-format key being rejected for the Bearer header.
