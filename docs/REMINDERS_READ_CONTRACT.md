# Reminders read API (`GET /api/reminders`) — contract (UI-09)

A user-scoped, **read-only** view of a user's upcoming reminders and the
delivery outcome of the ones that have already gone out. The UI-09 reminders
surface builds against this document.

This endpoint never writes and never dispatches — it is a pure projection over
two tables (`reminders` + the `messages` delivery ledger). Reminder scheduling
and sending logic (`src/jobs/reminders.js`) is untouched.

## Auth

Same Supabase-JWT middleware as the rest of `/api` (`src/routes/api/auth.js`):

```
Authorization: Bearer <supabase access_token>
```

Identity is derived from the token, never from the request. Every read is
scoped to the caller (`user_id = <token user>`), so a foreign or forged id can
only ever behave as "not found".

Failure modes: `401 auth_required` (missing/invalid token), `403
no_linked_account` (valid token, no linked Cedrus account), `500 internal`
(Auth/DB unreachable).

## 1. Request

```
GET /api/reminders?status=<filter>&limit=<n>
```

Query params (both optional):

| Param    | Values | Default | Notes |
|----------|--------|---------|-------|
| `status` | `pending` \| `sent` \| `snoozed` \| `sending` \| `failed` \| `canceled` \| `all` | *(live set)* | Case-insensitive. Unknown value → `422 invalid_request`. |
| `limit`  | integer | `100` | Clamped to `[1, 200]`. Unparseable/`<1` → default (never errors). |

**Default `status` (omitted) = the "live" set:** every reminder except
`canceled` — i.e. `pending`, `snoozed`, `sending`, `sent`, `failed`. This is
the "upcoming reminders + their delivery states" view: what's coming up, what's
in flight, and how the recently-dispatched ones turned out. Pass:

- `?status=pending` — strictly not-yet-fired (a pure upcoming list).
- `?status=sent` or `?status=failed` — a delivery log / failures.
- `?status=all` — include `canceled` too.

The `sending` and `failed` statuses come from the delivery-states migration
(`cedrus-supabase 20260719120001_reminder_delivery_states`). If that migration
is not yet applied in an environment, no rows carry those statuses and they
simply never appear — the endpoint behaves correctly either way (see
`docs/FLAGS_FROM_STATION6.md`).

## 2. Response `200`

```json
{
  "count": 2,
  "reminders": [
    {
      "id": "3f…",
      "title": "Call Mom",
      "note": null,
      "person_id": "a1…",
      "reminder_type": "custom",
      "status": "pending",
      "trigger_at": "2026-08-10T15:00:00.000Z",
      "created_at": "2026-07-01T00:00:00.000Z",
      "delivery": null
    },
    {
      "id": "9c…",
      "title": "Wish Sam happy birthday",
      "note": null,
      "person_id": "b2…",
      "reminder_type": "birthday",
      "status": "sent",
      "trigger_at": "2026-07-15T15:00:00.000Z",
      "created_at": "2026-07-01T00:00:00.000Z",
      "delivery": {
        "status": "delivered",
        "error_code": null,
        "sent_at": "2026-07-15T15:00:03.000Z",
        "message_type": "reminder"
      }
    }
  ]
}
```

- `count` — number of reminders in this response (the returned page, after
  `limit`), not a full-account total.
- `reminders` — ordered by `trigger_at` **descending** (nearest-future and
  most-recent first), with an `id` tiebreak for determinism.

### The reminder object

| Field | Meaning |
|-------|---------|
| `id` | reminder id |
| `title`, `note` | reminder copy (either may be `null`) |
| `person_id` | the person this reminder is about, or `null` |
| `reminder_type` | e.g. `custom`, `birthday` |
| `status` | `pending` \| `sent` \| `snoozed` \| `sending` \| `failed` \| `canceled` |
| `trigger_at` | when it is/was scheduled to fire (ISO 8601) |
| `created_at` | when it was created (ISO 8601) |
| `delivery` | delivery state of the dispatched SMS, or `null` (see below) |

Internal columns (`user_id`, `sent_message_id`, `created_by`,
`source_message_id`, `updated_at`, and the dispatch-bookkeeping columns) are
**never** exposed.

### The `delivery` object

`delivery` reflects the linked outbound message
(`reminders.sent_message_id → messages.id`), whose `provider_status` is written
by the Twilio delivery-status callback (`src/routes/deliveryStatus.js`). It is
`null` when the reminder has not been dispatched (or has no linked message).

| Field | Meaning |
|-------|---------|
| `status` | `queued` \| `sent` \| `delivered` \| `undelivered` \| `failed` \| `dry_run` \| `null` — the carrier-level outcome |
| `error_code` | provider error code as a string, or `null` (only set on failure) |
| `sent_at` | when the SMS was handed to the provider (ISO 8601), or `null` |
| `message_type` | the message class, normally `reminder` |

**Two distinct failure surfaces** — read them together:

- `status: "failed"` (reminder-level) — dispatch itself never completed (a
  stuck claim was reaped); usually `delivery: null` (no SMS was ever accepted).
- `status: "sent"` + `delivery.status: "failed" | "undelivered"` — the SMS was
  accepted by the provider but the carrier failed to deliver it; `error_code`
  carries the reason.

## 3. Guarantees

- **Read-only.** The only DB verb used is `SELECT`. A `GET` never changes a
  reminder's status and never triggers a send.
- **User-scoped.** Both the reminders read and the delivery-message read are
  filtered to the token's user; a reminder mis-linked to another user's message
  reports `delivery: null` rather than leaking it.
- **No N+1.** One reminders query + one batched messages query.
- **Deterministic order:** `trigger_at` DESC, `id` ASC tiebreak.
