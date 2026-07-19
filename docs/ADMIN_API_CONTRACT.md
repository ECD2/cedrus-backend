# Cedrus Admin Panel — API Contract (N1)

**Status:** v1, frozen for Cycle "night ops". N4's mock UI builds against THIS
document; the backend in `src/routes/adminPanel.js` implements it verbatim.
Changes are field-ADDITIVE only — nothing here gets renamed or removed without
a version bump agreed between N1 and N4.

Written by N1 (admin backend). The code is NOT mounted yet — see
`docs/MOUNT_N1.md` for the one-line mount Emil applies.

---

## 1. Base path & mounting

All endpoints live under the existing admin prefix:

```
/admin/users                      GET
/admin/users/:id/health           GET
/admin/users/:id/billing          GET
/admin/users/:id/reset            POST
/admin/testers                    GET
/admin/testers                    POST   (501 — see §7)
```

`:id` is the `app_users.id` uuid. The panel router must be mounted **before**
the existing founder-admin router (`src/routes/admin.js`) so that
`POST /admin/user` and `POST /admin/reset-user` keep working unchanged; the
panel router carries **no** router-level middleware, so unknown `/admin/*`
paths fall straight through to the existing router.

## 2. Auth

* Header: **`x-admin-key`** — same header the existing founder admin uses, so
  N4 needs exactly one credential story.
* Token source (server side): **`ADMIN_PANEL_TOKEN`** env var if set, else
  falls back to **`ADMIN_KEY`**. Rationale: the panel token will live in a
  browser (N4's UI); a separate var lets Emil rotate it without breaking his
  curl scripts. Same value in both is fine.
* Comparison is constant-time (`crypto.timingSafeEqual`), the same hardened
  pattern as `src/routes/admin.js`.
* **Fail closed:** if neither env var is set, every panel route returns
  **404** (`Not found`) — the panel does not exist. This is the production
  requirement: no token ⇒ no panel. There is no dev bypass.
* Wrong/missing header ⇒ **403** (`Forbidden`). Every rejection is
  audit-logged (`admin_panel.auth.rejected`).

## 3. Conventions (N4: rely on these)

* JSON in, JSON out. Mutations are POST with a JSON body; **no mutating GET
  exists** anywhere on the panel.
* **Full phone numbers never appear in any response.** Phones are always
  `phone_last4` (4 chars). Message **bodies never appear** in any response.
  Stripe IDs never appear — only booleans of their presence.
* `user_ref` is the log-correlation form `"u_<uuid>"`; `id` is the raw uuid
  you feed back into `/admin/users/:id/...` paths.
* Timestamps are ISO-8601 strings (UTC) or `null`.
* Error shape everywhere: `{ "error": "<human message>" }` with a 4xx/5xx
  status. 404 on an unknown user id: `{ "found": false }`.
* Every route (reads included) writes one structured audit event; names in
  each section below.

## 4. `GET /admin/users` — tester roster

Query params: `limit` (default 25, max 100), `offset` (default 0).
Sorted `created_at` **desc** (newest account first).

```json
{
  "users": [
    {
      "id": "e0b7…uuid",
      "user_ref": "u_e0b7…uuid",
      "phone_last4": "7469",
      "name": "Emil",
      "plan": "trialing",
      "billing_status": "trialing",
      "trial_ends_at": "2026-08-01T04:00:00.000Z",
      "created_at": "2026-07-18T04:00:00.000Z",
      "onboarding_complete": true,
      "opted_out": false,
      "last_active_at": "2026-07-19T01:22:00.000Z",
      "counts": { "people": 12, "facts": 84, "reminders": 3 }
    }
  ],
  "page": { "limit": 25, "offset": 0, "total": 6 }
}
```

Notes: `counts` are exact head-counts per user (3 queries/user — fine at
beta scale, revisit past ~200 users). No search param in v1; add `?q=` as an
additive change if the roster outgrows one page.
Audit event: `admin_panel.users.listed` (`count`, `outcome`).

## 5. `GET /admin/users/:id/health` — "is it working for this tester"

`?days=N` (default 7, max 30) bounds the delivery window. Delivery numbers
are computed over the most recent ≤200 outbound messages inside that window
(cap noted here so the UI can label it honestly).

```json
{
  "found": true,
  "user": {
    "id": "e0b7…uuid",
    "user_ref": "u_e0b7…uuid",
    "name": "Emil",
    "plan": "trialing",
    "opted_out": false,
    "onboarding_complete": true,
    "last_active_at": "2026-07-19T01:22:00.000Z"
  },
  "window_days": 7,
  "delivery": {
    "counts": { "delivered": 41, "sent": 2, "queued": 0, "failed": 1, "undelivered": 0, "unknown": 3 },
    "last_failure": {
      "at": "2026-07-17T15:04:05.000Z",
      "status": "failed",
      "error_code": "30003",
      "message_type": "reminder"
    }
  },
  "reminders": {
    "counts": { "pending": 3, "sent": 11, "snoozed": 1, "canceled": 0 },
    "next_due_at": "2026-07-19T14:00:00.000Z",
    "overdue_pending": 0
  },
  "last_inbound_at": "2026-07-19T01:22:00.000Z",
  "last_outbound_at": "2026-07-19T01:23:10.000Z"
}
```

* `delivery.counts` keys are fixed; `unknown` = outbound rows with no
  provider status yet (sent before the status callback shipped, or callback
  not yet arrived). `last_failure` is `null` when there is none in-window.
* `reminders.counts` keys mirror the schema's allowed statuses
  (`pending|sent|snoozed|canceled`). `overdue_pending` = pending with
  `trigger_at` in the past (the "reminder engine is stuck" tell).
* `last_inbound_at` `null` ⇒ the tester has never texted in (or was reset).

Audit event: `admin_panel.user_health.viewed` (`user_ref`, `outcome`).

## 6. `POST /admin/users/:id/reset` — wrap of the existing reset tool

Body: none required (`{}` fine). This is a **pass-through** to the hardened
`POST /admin/reset-user` in `src/routes/admin.js` — the panel resolves
`:id → phone` server-side and dispatches the existing route handler
in-process. Nothing is reimplemented, so the panel inherits, verbatim:

* the **TESTER_PHONES allowlist** hard gate (non-tester ⇒ 403, nothing
  deleted),
* the **consent-preservation guarantees** (`consent_events`,
  `subscriptions`, `agent_runs`, `integrations` are never touched),
* the account-rewind semantics (fresh 14-day trial, onboarding restarts),
* the existing `admin.reset_user` audit entry.

Responses (status passes through from the inner tool):

* `200` `{ "reset": true, "user_ref": "u_…", "cleared": { … }, "preserved": [ … ], "note": "…" }`
* `403` `{ "reset": false, "error": "phone is not on the TESTER_PHONES allowlist" }`
* `404` `{ "found": false }` — unknown user id.
* `503` `{ "reset": false, "error": "reset backend disabled: ADMIN_KEY is unset" }`
  — the inner tool fails closed without its own key; the panel reports
  rather than bypasses it.

Audit events: `admin_panel.reset.requested` (panel layer: who asked, outcome)
**plus** the inner `admin.reset_user` / `admin.reset_user.denied` (what
happened). Two entries per reset is intentional.

## 7. Tester allowlist — `GET /admin/testers`, `POST /admin/testers`

The allowlist is **env-only** (`TESTER_PHONES`, comma-separated, parsed at
boot in `src/config.js`). There is deliberately **no DB table** (N5 owns
schema; see `docs/N1_FLAGS_FOR_N5.md`), so the panel cannot mutate it at
runtime — a runtime mutation would silently revert on the next deploy.

`GET /admin/testers` (read-only view):

```json
{ "source": "env:TESTER_PHONES", "count": 3, "phones_last4": ["7469", "0001", "0002"] }
```

Audit event: `admin_panel.testers.viewed`.

`POST /admin/testers` returns **501**:

```json
{
  "error": "tester allowlist is env-managed; there is nothing to mutate at runtime",
  "how_to": "Edit the TESTER_PHONES env var (comma-separated, any format) in Railway → service → Variables, then redeploy. Parsed at boot by src/config.js.",
  "see": "docs/ADMIN_API_CONTRACT.md §7"
}
```

Audit event: `admin_panel.testers.mutation_refused`. N4: render the `how_to`
string verbatim next to a disabled add/remove control.

**Operator procedure (the "documented instructions" of record):**
1. Railway → cedrus-backend service → Variables → `TESTER_PHONES`.
2. Comma-separated, any format (`+1 (786) 972-7469` fine); normalization to
   digits-only happens at boot.
3. Save ⇒ Railway redeploys ⇒ new allowlist live. Verify via
   `GET /admin/testers`.

## 8. `GET /admin/users/:id/billing` — Stripe section, STUB

Only fields that exist in the schema today, plus a clearly-marked
placeholder for the future Stripe detail. **No Stripe SDK, no keys, no
Stripe API calls** exist in the backend.

```json
{
  "found": true,
  "user_ref": "u_e0b7…uuid",
  "plan": "trialing",
  "billing_status": "trialing",
  "trial": {
    "started_at": "2026-07-18T04:00:00.000Z",
    "ends_at": "2026-08-01T04:00:00.000Z",
    "downgraded_at": null
  },
  "has_stripe_customer": false,
  "sub_status": null,
  "subscription": null,
  "stripe": {
    "integrated": false,
    "placeholder": true,
    "note": "Shape reserved for the future Stripe integration; every field below is null until then.",
    "planned": {
      "customer_portal_url": null,
      "payment_method_summary": null,
      "next_invoice_at": null,
      "mrr_cents": null
    }
  }
}
```

* `has_stripe_customer` = presence of `app_users.stripe_customer_id` as a
  **boolean** (the raw id never leaves the server).
* `sub_status` = `status` of the newest `subscriptions` row for the user
  (`null` when no row exists — the normal beta state).
* `subscription`, when present:
  `{ "plan", "status", "current_period_end", "canceled_at", "has_stripe_subscription" }`
  (again: boolean presence, never the raw Stripe subscription id).

Audit event: `admin_panel.user_billing.viewed` (`user_ref`, `outcome`).

## 9. Status-code summary (N4 mock matrix)

| Case | Status |
|---|---|
| No token configured server-side (either env var) | 404 on every panel route |
| Missing / wrong `x-admin-key` | 403 |
| Unknown `:id` (well-formed uuid, no row) | 404 `{ "found": false }` |
| Malformed `:id` (not a uuid shape) | 400 |
| Reset target not on TESTER_PHONES | 403 (inner tool's own response) |
| Reset while `ADMIN_KEY` unset | 503 |
| `POST /admin/testers` | 501 |
| Unhandled server error | 500 `{ "error": "internal" }` |
