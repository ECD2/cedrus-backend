# N3 completion report — web capture + priority swap + restore (WS-I)

Branch: `feat/web-endpoints` (worktree `nb-capture/`, cut from origin/main
@ 43622e4). Committed locally only — no push, no deploy, no hosted-DB
access at any point (all tests run against in-memory fakes).

## What shipped

New files only (verified: `git status` shows zero modified existing files):

| File | Role |
|---|---|
| `docs/WEB_API_CONTRACT.md` | The API contract, written FIRST — N4 builds against it blind |
| `docs/MOUNT_N3.md` | The two-line `src/index.js` mount for the merge owner |
| `src/routes/api/auth.js` | Supabase-JWT middleware (`auth.getUser` verify → `app_users.auth_user_id` → `req.appUser`) |
| `src/routes/api/index.js` | `/api` router: thin handlers, correlation-id logging, contract error shape |
| `src/services/capture.js` | Propose-then-confirm capture; in-memory single-use proposal store |
| `src/services/prioritySwap.js` | Wraps the service_role-only `set_priority_people` RPC; friendly cap copy |
| `src/services/restore.js` | Un-archive + archived list, people-service ownership-guard style |
| `test/web-api.test.mjs` | 77-check suite (details below) |
| `test/web-fakes.mjs` | In-memory Supabase client (incl. faithful RPC mirror) + canned-extraction OpenAI double |

## Contract summary (full text: docs/WEB_API_CONTRACT.md)

All routes JSON, all behind `Authorization: Bearer <supabase JWT>`; user_id
is ALWAYS token-derived, never read from the request. Errors are
`{ error: <machine_code>, message: <user-displayable copy> }`, copy voice-
spec compliant (warm, no em dashes, no exclamation marks).

1. **POST /api/capture** `{ text }` → `{ safety, reply, proposal }`.
   Runs the SAME extraction stages as SMS (`messages.buildContext` →
   `understand()` with its Priority-0 safety gate and voice guard),
   source = web. **Writes nothing durable** — the extraction is parked in
   an in-memory, TTL'd (10 min), single-use, per-user proposal store.
   Crisis turns return the fixed template with `proposal: null` (nothing to
   confirm). 429 when the rolling 24h quota is spent (same copy as SMS).
2. **POST /api/capture/confirm** `{ proposal_id }` → `{ confirmed,
   message_id }`. The FIRST durable write: message row
   (`channel='web'`, `provider='web'`), `agent_runs` cost row
   (`run_type='web_capture'`), then the same `resolveEntities()` +
   `persist()` as SMS (all enum whitelists re-applied at commit time).
   Unknown/expired/foreign/reused ids are all the same 404.
3. **POST /api/priority/swap** `{ person_ids }` (full set, 0..5) →
   `{ priority_count, added, removed, priority_people }`. Calls the
   `set_priority_people` RPC locked to service_role on 2026-07-13 —
   `target_user_id` is always the authenticated user; the RPC's atomic
   ownership/self/archived/limit validation stays live behind the route's
   own checks. The sixth person gets the friendly copy: *"I can only keep
   five people in close focus. Pick your five, and everyone else stays
   remembered. You can swap anytime."*
4. **POST /api/people/:id/restore** → `{ restored, person }`. Clears
   `is_archived`/`archived_at`/`archived_reason`, ownership-scoped
   (`.eq('user_id', …)` on the write — foreign ids read as 404). Idempotent.
5. **GET /api/people/archived** → `{ people: [{id, name, archived_at}] }`,
   newest first — powers N4's restore surface.

## Security decisions worth review

- **JWT verification is delegated to Supabase Auth** (`auth.getUser(token)`
  through the existing service-role client): no JWT secret in config, no
  new dependency, key rotation immune. A GoTrue transport failure is a 500
  ("try again"), never a 401 — an outage can't read as "bad login".
- **Foreign person_id scrub (new, beyond SMS parity):** `resolveEntities`
  trusts model-proposed `person_id`s (the hallucination hole flagged in
  docs/WSA_FLAGS_FOR_WSB.md, outside N3's file boundary). The web path
  closes it in `capture.js`: any proposed id the user doesn't own is
  dropped before the proposal is stored or echoed (existing/self downgrade
  to `new`, ambiguous candidates filtered), so web capture can never write
  rows pointing at another tenant's person.
- **Proposal store is process memory on purpose** — an unconfirmed capture
  must leave no durable trace. Consequences accepted + documented in the
  contract: proposals die on restart/deploy (client re-proposes), capped at
  10 pending per user (model-spend valve), model cost of unconfirmed
  proposes is audited via the structured log stream (the DB-independent
  audit sink), with the `agent_runs` row landing at confirm.

## Test evidence (all green, 2026-07-19)

- `sh test/run-all.sh` — full existing battery: fact pipeline, logger,
  reminders, people ownership, dedup, brief, Twilio signature, safety,
  voice, search. **ALL PASSED** (no existing file was modified).
- `bun test/web-api.test.mjs` — **77/77 PASSED**. Real express router with
  production wiring + real pipeline stages over in-memory fakes
  (`mock.module` on `lib/supabase.js` + `lib/openai.js` only). Covers the
  five mandated claims:
  1. *JWT required on every route* — absent + forged tokens → 401 on all
     five routes; non-Bearer scheme → 401; valid-but-unlinked → 403.
  2. *A cannot touch B's data* — hallucinated foreign person_id scrubbed
     (B's rows byte-identical after A's confirm); B confirming A's
     proposal → 404 with zero writes; B's person in A's swap list →
     `not_selectable` with neither tenant changed; B restoring/listing A's
     archived person → 404 / not shown.
  3. *Capture without confirm writes nothing durable* — row-count snapshot
     across all 11 product tables unchanged by propose (and by crisis
     turns); confirm then writes message + agent_runs + person + fact +
     link + contact event, single-use (second confirm 404), TTL expiry and
     pending-cap eviction proven at service level.
  4. *Sixth priority person* → 422 `priority_limit_reached` with the
     friendly message verbatim, and zero flag changes. Plus: full-set
     replace, dedupe (6 entries/3 unique passes), clear, archived/self
     rejection, malformed ids.
  5. *Restore round-trips* — archived list → restore (all three fields
     cleared) → list empty → idempotent re-restore → restored person
     pinnable via swap again ("bring them back anytime", end to end).
  Voice compliance is itself tested: no em dashes or exclamation marks in
  any API copy.

## Follow-ups for the orchestrator (not blockers)

- **Mount**: `src/index.js` needs the two lines in docs/MOUNT_N3.md, and
  optionally the run-all.sh battery line (both files N3 was not allowed to
  edit).
- **Entitlements**: the swap cap is a flat 5 (per the N3 brief). When the
  entitlements module lands (Pro = unlimited), the limit becomes
  plan-derived — one line in `prioritySwap.js`; shapes unchanged.
- **Multi-instance**: if the backend ever scales past one Railway
  instance, the proposal store needs a shared home (Redis or a table);
  contract behavior (`404 → re-propose`) already tolerates the change.
- **N4 note**: on `capture/confirm` 404, re-propose — proposals are
  10-minute, single-use, restart-mortal by design.
