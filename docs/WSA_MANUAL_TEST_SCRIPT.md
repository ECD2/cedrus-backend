# WS-A Manual Test Script — live verification of the stability/security hardening

Written on merge day (2026-07-17) from the code shipped on `main`
(`cd9f65f`, ported tree verified green). Every step cites the file that
implements the behavior — if a step and the code ever disagree, the code
moved and this doc needs updating.

Supports CYCLE1_TEST_PROTOCOL.md: **T1** uses M6's curl; **T4** uses M7.
Run after the Railway deploy. Record outcomes in
`cedrus-planning/cycle1-orchestration/CYCLE1_TEST_LOG.md`.

## Setup (placeholders — real values never leave the password manager)

```sh
export CEDRUS_URL="https://YOUR-APP.up.railway.app"   # Railway public URL = PUBLIC_BASE_URL
export ADMIN_KEY="…"    # from the password manager; header-only, never in a URL or repo
export MY_PHONE="…"     # your tester number, digits only; must be in TESTER_PHONES
```

`ADMIN_KEY` and `TESTER_PHONES` are Railway env vars (`src/config.js:33-40`).
The admin surface does not exist (404) if `ADMIN_KEY` is unset
(`src/routes/admin.js:46`).

## M1 — Boot refuses insecure production config (`src/config.js:50-74`, `src/index.js:12`)

1. In Railway, confirm the service is up and the deploy log shows a
   `server.started` event.
2. Assurance check (config only, no need to actually break prod): the boot
   asserts that `VALIDATE_TWILIO_SIGNATURE` is not `false` and that
   `PUBLIC_BASE_URL` is set. If either is violated in production the process
   exits with `FATAL(config)` before listening. Verify both vars are set
   correctly in Railway now.

## M2 — Unsigned inbound webhook is rejected (`src/routes/sms.js:13-16`)

```sh
curl -si -X POST "$CEDRUS_URL/sms/inbound" \
  -d "From=%2B15550100000&Body=hello&MessageSid=SMfake&NumSegments=1"
```

Expect: `403 Forbidden`. Log shows `sms.inbound.rejected` with
`error_category: auth` — and no message body in the log line.

## M3 — Unsigned delivery-status callback is rejected (`src/routes/deliveryStatus.js:29-32`)

```sh
curl -si -X POST "$CEDRUS_URL/sms/status" \
  -d "MessageSid=SMfake&MessageStatus=delivered"
```

Expect: `403 Forbidden` (a forged "delivered"/"failed" must not be
recordable). Log shows `sms.status.rejected`.

## M4 — Admin auth is header-based and fails closed (`src/routes/admin.js:36-53`)

```sh
curl -si -X POST "$CEDRUS_URL/admin/user" -H 'content-type: application/json' \
  -d '{"phone":"0000000000"}'                          # no key   → 403
curl -si -X POST "$CEDRUS_URL/admin/user" -H "x-admin-key: wrong" \
  -H 'content-type: application/json' -d '{"phone":"0000000000"}'   # bad key → 403
```

Expect: `403 Forbidden` both times (constant-time compare; log
`admin.auth.rejected`). The old key-in-URL panel and the destructive
`GET /admin/reset` no longer exist.

## M5 — Account snapshot, no raw phone echoed (`src/routes/admin.js:71-88`)

```sh
curl -sS -X POST "$CEDRUS_URL/admin/user" -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' -d "{\"phone\":\"$MY_PHONE\"}"
```

Expect: JSON with `user_ref: "u_…"` (never the phone), plan/onboarding
fields, and `counts` for people/facts/messages/reminders.

## M6 — Reset-user: allowlist-gated, audit-preserving (`src/routes/admin.js:110-181`) — this is the T1 curl

```sh
# The T1 alias — save as cedrus-reset-me:
curl -sS -X POST "$CEDRUS_URL/admin/reset-user" -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' -d "{\"phone\":\"$MY_PHONE\"}"
```

Expect on success: `{"reset":true, …}` listing `cleared` per-table counts and
`preserved: ["consent_events","subscriptions","agent_runs","integrations"]`.
The account row is kept and rewound to a fresh 14-day trial
(`src/routes/admin.js:148-162`); the self person-row is blanked, not deleted.

Gate check — a number NOT on `TESTER_PHONES` must refuse:

```sh
curl -sS -X POST "$CEDRUS_URL/admin/reset-user" -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' -d '{"phone":"2125550000"}'
```

Expect: `403` with `{"reset":false,"error":"phone is not on the TESTER_PHONES allowlist"}`.
Log shows an `admin.reset_user` audit event with deleted counts (PII-free) on
success, `admin.reset_user.denied` on the gate.

## M7 — Failed sends become visible (`src/routes/deliveryStatus.js:41-55`, `src/lib/twilio.js`) — supports T4

Every outbound send sets a per-message status callback to `/sms/status`.
To produce a failure: point a reminder/test send at an SMS-unreachable
number you control (e.g. a landline) that is on `TESTER_PHONES`.

Expect within ~1 min of the send: log event `sms.delivery.failed` with
`error_category: provider_error` and Twilio's `error_code`; the outbound
`messages` row carries the terminal provider status. Nothing retries
forever; nothing is silently lost.

## M8 — Log redaction spot-check (`src/utils/logger.js` scrub/buildLogRecord)

While running M2–M6, watch the Railway log stream:

- inbound events carry `body_len`, never the message text (`sms.inbound.received`)
- users appear as `u_<id>` / `ph_<last-4>` refs, never full phone numbers
- `error`/`fatal` events always carry an `error_category`

Any raw phone number or message body in any log line is a FAIL.

## M9 — Duplicate webhook replay is a no-op (`src/pipeline/index.js:31-36`) — observational

A replayed Twilio webhook (same `MessageSid`) — including replayed STOP or
first-message webhooks — logs `sms.inbound.duplicate`
(`error_category: idempotent_skip`) and sends nothing. You can't easily forge
this live (it requires a valid signature); confirm it opportunistically when
Twilio genuinely retries, e.g. during a slow deploy restart.
