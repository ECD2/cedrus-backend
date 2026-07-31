READ `CEDRUS.md` BEFORE STARTING ANY WORK.

`CEDRUS.md` (repo root) is the single source of truth for Cedrus. It replaced
`CEDRUS_OPERATING_DOCTRINE.md`, `CEDRUS_V1_MASTER.md` and `CEDRUS_V1_SPEC.md` on 2026-07-31; all
three are deleted, and any copy you find elsewhere is stale.

It is in three parts. **Do not read all of it every time — read the parts your prompt names.**

1. **Part I — The company.** What we are building, for whom, and in what words. Product, strategy,
   copy. Nothing in it is a requirement unless it says LOCKED.
2. **Part II — Operating law.** How Emil works, the laws that don't bend, what counts as proof, the
   lessons, the verified environment facts, and the open flags register. Read before writing,
   reviewing, merging, or pushing code.
3. **Part III — Systems inventory.** What each repo is, where it deploys, and what is broken in it.
   Read first when touching a repo for the first time; section III.1 is this repo.

## The two things most likely to bite you in THIS repo

- **A push to `main` here is a live deploy.** The Railway service is repo-linked to
  `ECD2/cedrus-backend` and was live in production ~50 seconds after a push (Part II, Law 6).
  **STOP before push. Only Emil pushes** — overnight and autonomous sessions without exception.
- **The battery is the gate, and only on merged `main`.** `sh test/run-all.sh`, and gate on
  `echo $?` — never on the "ALL WS-B SUITES PASSED" banner, which prints 46% of the way through
  with thirteen suites still to run (Part II, Law 4 and II.5).

Overnight sessions append their report to `SESSION_NOTES_<date>.md` in the repo root.
