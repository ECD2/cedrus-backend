# N1 completion report — Admin Panel backend

**Branch:** `feat/admin-panel-backend` (worktree `nb-admin/`, cut from
`origin/main` @ 43622e4). **Committed locally, not pushed, not mounted, not
deployed. No hosted-database access of any kind during this session** —
all verification ran against the in-memory test doubles.

## What shipped

New files only; zero existing files edited (boundary honored):

| File | What |
|---|---|
| `docs/ADMIN_API_CONTRACT.md` | The frozen v1 contract N4's mock builds against — written FIRST, endpoints below implement it verbatim. |
| `src/services/adminOps.js` | Panel token auth (constant-time), roster/health/billing read models, reset pass-through, tester allowlist view. |
| `src/routes/adminPanel.js` | Express routes; per-route auth; every route (reads included) audit-logged; nothing mutating is a GET. |
| `test/prelude-admin.js`, `test/adminPanel.test.js`, `test/run-admin-tests.sh` | House-style dependency-free proof bundle (68 checks). |
| `docs/MOUNT_N1.md` | The 2-line mount for Emil (`index.js` is outside N1's boundary). |
| `docs/N1_FLAGS_FOR_N5.md` | Schema flags — nothing blocking; v1 needs zero schema changes. |

## Endpoints (contract summary)

| Route | Purpose |
|---|---|
| `GET /admin/users` | Paginated roster: id, phone **last-4**, plan, billing_status, trial_ends_at, created_at, counts (people/facts/reminders). |
| `GET /admin/users/:id/health` | "Is it working for this tester": delivery outcomes from the delivery-callback data (`messages.provider_status`), last failure w/ error code, reminder queue state incl. overdue-pending, last inbound/outbound times. |
| `POST /admin/users/:id/reset` | Pass-through to the existing hardened reset (see below). |
| `GET /admin/testers` / `POST /admin/testers` | Masked env-allowlist view / 501 + operator procedure (allowlist is env-only; no invented table). |
| `GET /admin/users/:id/billing` | STUB: schema-only fields; Stripe ids reduced to presence booleans; clearly-marked placeholder block. No Stripe SDK/keys anywhere. |

Auth: `x-admin-key` header, `ADMIN_PANEL_TOKEN` env (falls back to
`ADMIN_KEY`), constant-time compare, **fail closed** — no token ⇒ every
panel route 404s. Wrong/missing ⇒ 403, audit-logged.

## Design decisions worth Emil's eyes

1. **The reset is not a copy.** The brief said "wrap the existing reset-user
   service; call it" — but that logic lives inline in the read-only
   `src/routes/admin.js` handler, not in an importable service. So
   `adminOps.resetUserById()` resolves id → phone and dispatches the actual
   founder-admin router in-process with a synthetic request (server-side
   `ADMIN_KEY` header, never round-tripped). Allowlist gate, consent
   preservation, rewind semantics and the inner audit entry all execute in
   the one existing implementation; the proof tests run against the REAL
   handler. *Suggested later cleanup (needs a WS-A-boundary edit): extract
   the reset body into `src/services/resetUser.js` and have both routes call
   it — then the dispatch shim can be deleted.*
2. **Testers stay env-managed.** Runtime mutation of env-derived state would
   silently revert on redeploy, so POST answers 501 with the Railway
   procedure (contract §7); no DB table invented (flagged to N5 as optional).
3. **`sub_status`** doesn't exist on `app_users` in the real schema; the
   billing endpoint derives it from the newest `subscriptions` row. No
   schema change requested.
4. **If ADMIN_KEY is unset** the reset pass-through reports 503 rather than
   bypassing the inner tool's own fail-closed gate.

## Test results

- `sh test/run-admin-tests.sh` — **ALL TESTS PASSED** (68 checks): auth
  missing/wrong/timing-safe + fail-closed 404 + `ADMIN_PANEL_TOKEN`
  override; reset allowlist respected, **consent rows preserved** (plus
  subscriptions/agent_runs/integrations), account rewound, both audit
  entries written; list/health/billing leak **no full phone, no message
  body, no raw Stripe id** (string-scan asserted); every mutating route
  audit-logged; founder-admin paths fall through un-intercepted.
- `sh test/run-all.sh` — full existing battery (fact pipeline, structured
  logger, reminder dispatch, people ownership, inbound dedup, brief
  ordering, Twilio signature, WS-B safety/voice/search) — **ALL PASSED**,
  unchanged, on this branch.
- `test/run-all.sh` itself is outside N1's boundary, so the panel suite has
  its own runner; battery = both commands (documented in MOUNT_N1.md).

## Flags / follow-ups

- **For N4 (UI):** build against `docs/ADMIN_API_CONTRACT.md` only; §9 has
  the full status-code matrix; the 501 body's `how_to` string is meant to be
  rendered verbatim next to a disabled add/remove control.
- **For N5 (schema):** `docs/N1_FLAGS_FOR_N5.md` — all optional.
- **For the orchestrator:** `STREAM_OWNERSHIP.md` has no N1 row yet, and its
  Cycle-1 WS-A row nominally owns `src/routes/**`. WS-A merged to main
  before this branch was cut and N1 creates only new files, so there is no
  live collision — but the registry should get a night-ops row when Emil
  next updates it.
- **Reset-service extraction** (decision 1 above) would be a nice Cycle-2
  hardening item.
