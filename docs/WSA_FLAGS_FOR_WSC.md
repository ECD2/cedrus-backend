# WS-A → WS-C flags (schema / migrations)

WS-A made **no schema or migration changes** (prohibited for this workstream).
Several fixes bumped into schema limits and were implemented against the current
schema with a documented residual gap. Each item below is a migration WS-C
should consider, with the constraint WS-A worked around.

---

## C-1 (the important one): reminders need a real `sending` + `failed` state

**Constraint hit.** `reminders.status` CHECK allows only
`pending | sent | snoozed | canceled` (baseline
`20260711053439_cedrus_remote_baseline.sql`). There is no in-flight or failed
state, and no `attempts` / `claimed_at` column.

**What WS-A did.** The double-send fix (`jobs/reminders.js`, item 1) uses an
**atomic compare-and-swap claim** that moves a due row `pending → snoozed`
*before* the Twilio call, then `snoozed → sent` only on success (or
`snoozed → pending` on a pre-SID Twilio throw, which is safely retryable).
`snoozed` is reused as the transient “in-flight” lane because nothing in the
product uses it today and the schema forbids a new value. This fully prevents
double-sends and keeps failed sends retryable.

**Residual gap for WS-C to close.** A crash in the ~1s window *between* the claim
and Twilio-accept leaves a row stuck at `snoozed`. WS-A deliberately does **not**
auto-recover it (we can’t distinguish “crashed before send” from “crashed after
Twilio accepted”, so recovery could double-send). Recommended migration:

- Add a dedicated dispatch state — either extend the status CHECK with
  `sending` and `failed`, or add a `dispatch_state` column
  (`queued | sending | sent | failed`) separate from the user-facing status.
- Add `attempts int not null default 0` and `claimed_at timestamptz`.
- This lets a lease-based reaper safely reclaim rows stuck in `sending` past a
  timeout, and gives failed reminders an explicit, queryable terminal state.

Once those exist, `jobs/reminders.js` should switch the transient marker from
`snoozed` to the real `sending` state and add the reaper.

## C-2: no `admin_audit` table — admin actions audit to logs only

**Constraint hit.** There is no generic audit/event table (audit §C6), and
`consent_events.event_type` CHECK is `opt_in | opt_out | help |
consent_captured` — no room for an admin/reset event.

**What WS-A did.** The hardened admin (`routes/admin.js`, items 5 & 9) writes a
structured **`admin.reset_user`** audit log line (actor action, target
`user_ref`, per-table deleted counts, preserved tables) to the JSON log stream,
which `STRUCTURED_LOGGING_SPEC §8` designates as the durable,
DB-independent audit sink. `consent_events` and `subscriptions` are preserved
across a reset; the reset is no longer self-erasing.

**Recommended migration.** An append-only `admin_audit` table
(`id, actor, action, target_user_id, details jsonb, created_at`,
service-role-only, no client policies) so admin/reset actions have a durable
**DB-side** record too, not only in Railway/log-drain retention.

## C-3: outbound delivery status has no enum/index (works today as free text)

**What WS-A did.** The delivery-status callback (`routes/deliveryStatus.js`,
item 8) and the reminder/brief senders write Twilio delivery state into the
existing free-text `messages.provider_status` (+ `messages.provider_payload`
jsonb for the last error code). No schema change was needed.

**Optional migration.** If you want queryable delivery SLIs: a CHECK/enum on
`provider_status` (`queued|sent|delivered|undelivered|failed|dry_run`) and a
partial index on `messages(provider_status)` for failed-send dashboards
(METRICS_CATALOG). Not required for correctness.

## C-4: no pre-SID outbound idempotency key (audit §A10)

**Constraint hit.** The unique index `idx_messages_provider_id` on
`(provider, provider_message_id)` only dedups once a Twilio SID exists. An
outbound send that fails *before* returning a SID has no dedup key.

**What WS-A did.** For **reminders** this is fully covered without a schema
change — the atomic claim (C-1) is the idempotency guard, so a reminder can’t be
re-sent regardless of SID timing. Briefs are guarded by the `briefs` row status.

**Optional migration.** If a general outbound idempotency guarantee is wanted
(e.g. for future nudge/notification senders), add an `idempotency_key` column to
`messages` with a unique index, set at enqueue time before the Twilio call.

---

### Not changed (confirming scope)
No migrations were applied or written. No enum, table, column, index, RLS, grant,
trigger, or function was modified. Every workaround above lives entirely in
application code on `fix/stability-security`.
