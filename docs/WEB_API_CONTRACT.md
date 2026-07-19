# Cedrus Web API Contract — v1 (Night session N3)

The user-facing web API: capture ("Tell Cedrus"), priority swap, archive
restore. N4 (the web frontend) builds against THIS document; nothing outside
it is promised. Everything here is served by the Express backend (Railway),
mounted at `/api` (see `docs/MOUNT_N3.md`).

Base path: `https://<backend-host>/api`
Content type: `application/json` both ways. Bodies over 100 KB are rejected
by the app-wide body cap (400).

---

## 1. Authentication (every route)

Every route requires the Supabase session JWT of the logged-in user:

    Authorization: Bearer <supabase access_token>

- The backend verifies the token against Supabase Auth (server-side
  `auth.getUser`), then resolves the Cedrus account via
  `app_users.auth_user_id`. The acting user is ALWAYS derived from the
  token. No route reads a `user_id` from the body, path, or query, and any
  such field in a request body is ignored.
- `401 { "error": "auth_required", ... }` — header missing/malformed, or the
  token is invalid/expired/forged.
- `403 { "error": "no_linked_account", ... }` — token is valid but no
  `app_users` row is linked to this auth user (sign-up trigger hasn't
  linked a phone yet).
- SMS opt-out does NOT block the web API: `STOP` withdraws SMS-channel
  consent, not product access from an authenticated web session.

## 2. Error shape (every route)

Non-2xx responses are always:

```json
{ "error": "<machine_code>", "message": "<human copy>" }
```

`message` is user-displayable as-is (product voice: warm, brief, no em
dashes, no exclamation marks). `error` is a stable machine code — branch on
it, never on `message` text.

Common codes: `auth_required` (401), `no_linked_account` (403),
`not_found` (404), `invalid_request` (422), `quota_exceeded` (429),
`internal` (500). Route-specific codes are listed per route.

---

## 3. POST /api/capture — propose (“Tell Cedrus”, step 1 of 2)

Free-text capture from the web, routed through the SAME extraction pipeline
as SMS (context build → safety gate → model extraction → voice guard), with
`source = web`. **Propose-then-confirm invariant: this call writes nothing
durable.** The extraction result is held server-side as a short-lived
proposal; it becomes real only when `/api/capture/confirm` is called.

Request:

```json
{ "text": "ana got the job at the hospital, she starts monday" }
```

- `text` — required string, 1..2000 chars after trimming.

Success `200`:

```json
{
  "safety": false,
  "reply": "Noted. Ana starts at the hospital Monday.",
  "proposal": {
    "id": "d0a7…",
    "expires_at": "2026-07-19T09:12:00.000Z",
    "people":      [ { "mention_text": "ana", "resolution": "existing|new|self|ambiguous",
                       "person_id": "…|null", "proposed_name": "Ana|null",
                       "proposed_relationship": "sister|null" } ],
    "facts":       [ { "person_ref": "ana", "fact_type": "life_event", "fact_key": "job",
                       "fact_value": "starts at the hospital monday", "supersedes_prior": true } ],
    "saved_items": [ { "person_ref": "ana", "item_type": "gift_idea", "title": "…" } ],
    "reminders":   [ { "person_ref": "ana", "title": "…", "trigger_at": "iso",
                       "reminder_type": "checkin" } ],
    "goals":       [ { "person_ref": "ana", "goal_text": "…", "due_at": "iso|null" } ]
  }
}
```

- `reply` — display string for the confirmation screen (already
  safety/voice-guarded; never raw model output on a crisis turn).
- The five arrays echo the model's proposed extraction (enum values are
  re-validated server-side again at persist time — treat them as display
  data, not as a schema you can write back).
- `people[].resolution` semantics: `existing`/`self` carry a `person_id`;
  `new` carries `proposed_name` (+ optional `proposed_relationship`);
  `ambiguous` may carry `candidate_ids`.

Safety turns (`200`, crisis/boundary detected):

```json
{ "safety": true, "reply": "<fixed, reviewed safety template>", "proposal": null }
```

No proposal is created and nothing from the message is extracted or stored
(safety spec §7). Show `reply` verbatim; there is nothing to confirm.

Errors:
- `422 invalid_request` — `text` missing, empty, not a string, or > 2000 chars.
- `429 quota_exceeded` — the user's rolling 24h message quota is spent.
  `message`: "You've reached today's limit - I'll be right here tomorrow."
- Unconfirmed proposals are additionally capped at 10 per user in memory;
  the oldest is evicted first (no error — the evicted proposal just expires
  early). Proposals also die on backend restart: treat `not_found` from
  confirm as "propose again", not as a fatal error.

## 4. POST /api/capture/confirm — commit (step 2 of 2)

Commits a held proposal. This is the FIRST moment anything durable is
written: the inbound message row (`channel = 'web'`, `provider = 'web'`),
the `agent_runs` cost-audit row, person creation/matching, facts, saved
items, reminders, goals, contact events.

Request:

```json
{ "proposal_id": "d0a7…" }
```

Success `200`:

```json
{ "confirmed": true, "message_id": "…" }
```

Rules:
- Proposals are single-use: a second confirm of the same id → `404`.
- Owner-scoped: confirming another user's proposal id → `404` (same code
  as unknown — existence is never revealed).
- Proposals expire 10 minutes after propose → `404`.
- `404 not_found` `message`: "That one timed out on my end. Send it again
  and I'll take another look."
- To discard a proposal, simply don't confirm it; it evaporates on expiry.
  There is no cancel endpoint in v1.

## 5. POST /api/priority/swap — set the priority five

Sets the user's COMPLETE priority-people selection (full-set semantics —
the backend calls the atomic `set_priority_people` RPC, which is the only
supported write path for priority flags). Covers add, remove, and swap in
one shape: send the whole desired set each time.

Request:

```json
{ "person_ids": ["uuid-1", "uuid-2"] }
```

- `person_ids` — required array of 0..5 person UUIDs (duplicates are
  deduplicated server-side). An empty array clears the selection.
- Every id must be a person the authenticated user owns, not the self
  person, and not archived.

Success `200`:

```json
{
  "priority_count": 2,
  "added": 1,
  "removed": 0,
  "priority_people": [ { "id": "uuid-1", "name": "Ana" }, { "id": "uuid-2", "name": "Mike" } ]
}
```

Errors:
- `422 priority_limit_reached` — more than five ids sent (the sixth
  person). `message`: "I can only keep five people in close focus. Pick
  your five, and everyone else stays remembered. You can swap anytime."
- `422 not_selectable` — an id that isn't yours, is the self person, or is
  archived. `message`: "Some of those people aren't available to pin right
  now. If someone is archived, bring them back first."
- `422 invalid_request` — `person_ids` missing, not an array, or containing
  non-string entries.

Note for later cycles: the five-person cap is the current product rule for
this route. When the entitlements module lands (unlimited priority people
for Pro), the cap becomes plan-derived — the request/response shapes here
will not change.

## 6. POST /api/people/:id/restore — un-archive

Backend for "you can bring them back anytime": clears `is_archived`,
`archived_at`, `archived_reason` on a person the authenticated user owns.

Request: no body required.

Success `200` (idempotent — restoring a non-archived person is also a 200):

```json
{ "restored": true, "person": { "id": "…", "name": "Ana", "is_archived": false } }
```

Errors:
- `404 not_found` — no such person in YOUR circle (unknown id and another
  user's person are the same 404; existence is never revealed).
  `message`: "I couldn't find that person in your circle."

## 7. GET /api/people/archived — the archived list

Powers the restore surface. Returns the authenticated user's archived
people, most recently archived first.

Success `200`:

```json
{ "people": [ { "id": "…", "name": "Grandpa Joe", "archived_at": "2026-07-18T…" } ] }
```

Empty list ⇒ `{ "people": [] }`.

---

## 8. Invariants N4 can rely on

1. **Nothing durable before confirm.** `/api/capture` alone never changes
   what Cedrus remembers — no message, person, fact, reminder, goal, saved
   item, or contact event exists until `/api/capture/confirm` succeeds.
2. **The token is the identity.** There is no way to act on another user's
   data by editing request bodies; ids that aren't yours behave as absent
   (404 / not_selectable), not as forbidden-but-present.
3. **Web text is data, never instructions.** Capture text runs the same
   parser discipline as SMS: deterministic safety gate first, extraction
   enums re-validated in code at persist time, voice guard on the reply.
   Additionally, any `person_id` the model proposes that the user does not
   own is scrubbed before the proposal is stored or echoed (existing/self
   downgrade to `new`), so a hallucinated id can never point extraction at
   another tenant's person.
4. **Priority swap is atomic.** Concurrent swaps serialize server-side; the
   cap cannot be exceeded by racing requests.
5. **Restore is idempotent** and archives are never deleted by any route
   here — restore only clears flags.
