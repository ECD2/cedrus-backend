# Cedrus Web Onboarding Contract — v1 (BE-WEB-ONBOARD)

The public "get started from the website" flow: a visitor on cedrus.life enters
their phone (and optional email) and **Cedrus texts them first** with the
approved opt-in message, so they just reply to begin. The landing-page form
builds against THIS document.

Base path: `https://<backend-host>/api/onboard`
Content type: `application/json` both ways. Bodies over 100 KB → `400`.

This surface is **public and unauthenticated** — the visitor has no account and
no session yet. There is NO `Authorization` header (unlike the `/api` product
routes in `docs/WEB_API_CONTRACT.md`). Its defenses are input validation, rate
limiting, and never revealing whether a number already has an account.

---

## 1. POST /api/onboard/start

Request:

```json
{ "phone": "+17869727469", "email": "you@example.com" }
```

- `phone` — **required**. E.164 preferred (`+1…`); common US formats are
  accepted and normalized (`+1 (786) 972-7469`, `786-972-7469`, `7869727469`
  all resolve to the same account). **NANP / US (+1) only in v1** — non-US
  numbers are rejected (internationalization is a tracked follow-up).
- `email` — **optional**. If present it is stored for the future brief /
  marketing list in an **unverified** state and is never emailed until it is
  separately verified. If present but malformed, the whole request is rejected
  (so the user is not misled into thinking they joined) — omit it or send a
  valid address.

### Success `200` — always the same body

```json
{ "ok": true, "message": "If that number can receive texts, Cedrus just sent you a message. Reply to it to get started." }
```

This exact response is returned for **every** well-formed submission — a brand
new number, a number that already has a Cedrus account, or a number we chose
not to re-text. **It never reveals which.** Do not build UI that infers account
existence from this endpoint; it cannot be inferred by design.

What happens behind that single response:

- **New number** → Cedrus sends the Twilio-approved opt-in message verbatim,
  records consent, and creates the account. When the user replies, the normal
  SMS onboarding continues (their reply is treated as their first answer, not a
  repeat of the opt-in script).
- **Idempotent** → submitting the same number again does **not** send a second
  text.
- **Existing SMS user** → no text is sent and nothing about their account
  changes.

### Errors

Non-2xx bodies are always `{ "error": "<machine_code>", "message": "<human copy>" }`.
Branch on `error`, never on `message`. Product voice: warm, brief, no em
dashes, no exclamation marks.

| Status | `error` | When | `message` |
|--------|---------|------|-----------|
| `422` | `invalid_phone` | phone missing / malformed / non-US / reserved / obviously fake | "That does not look like a mobile number we can text. Check it and try again." |
| `422` | `invalid_email` | email provided but malformed or disposable | "That email address does not look right. Fix it or leave it blank." |
| `429` | `rate_limited` | too many submissions from this IP or for this phone | "That is a lot of tries in a short time. Give it a minute and try again." |
| `500` | `internal` | unexpected backend error | "Something went wrong on my end. Try that again in a moment." |

There is no `401`/`403` here — the endpoint is public. `invalid_phone`,
`invalid_email`, and `rate_limited` describe the **input or the traffic**, not
account existence, so they leak nothing about who is or isn't a Cedrus user.

---

## 2. Consent — REQUIRED form copy (compliance, not optional)

The website form is the **opt-in channel** for a toll-free/A2P-registered
sender. For the first text to be compliant, the form MUST capture express
written consent **at submit time** and display, adjacent to the submit control:

> By entering your number and continuing, you agree to receive recurring
> automated text messages from Cedrus Life at the number provided. Consent is
> not a condition of any purchase. Message frequency varies. Msg & data rates
> may apply. Reply STOP to opt out, HELP for help. See our
> [Terms](…) and [Privacy Policy](…).

Requirements:

- The consent language must be visible **before** submission (a pre-checked box
  is not valid consent; either an explicit unchecked opt-in checkbox the user
  ticks, or clear at-submit disclosure per your legal review).
- The links to Terms and Privacy must resolve.
- Keep this copy in sync with the sender's registered opt-in language. The
  backend then sends the registered opt-in **confirmation** message verbatim;
  do not restate or replace that message on the site.

The backend does not and cannot enforce that the form showed this — it is the
frontend's responsibility, and it is what makes the whole flow lawful. Ship the
form copy and the backend together.

## 3. Bot mitigation — recommended

This is a public endpoint that triggers an outbound SMS, so it is a spam/toll
target. In addition to the backend's per-IP and per-phone rate limits, put a
CAPTCHA / challenge on the form (hCaptcha, Cloudflare Turnstile, or reCAPTCHA)
and/or a WAF rule. The backend will never solve or bypass a CAPTCHA.

## 4. Invariants the frontend can rely on

1. **The opt-in text is sent verbatim.** It is byte-identical to the Twilio-
   approved confirmation used by inbound SMS onboarding (drift-guarded in
   tests). The site should not reproduce or paraphrase it.
2. **One response, no oracle.** `200` with the generic message for every valid
   submission; account existence is never observable.
3. **Never double-texts.** Re-submitting a number never sends a second opt-in.
4. **Email is unverified on capture.** Stored as "on file, pending"; it is not
   emailed until a separate verification step (not part of this endpoint).
5. **Same person, one account.** Web and SMS resolve to the same account by
   normalized phone, so a visitor who later texts in is not a second user.

## 5. Flags / decisions for Emil

- **`consent_events` type + source:** uses `event_type = 'consent_captured'`
  (already allowed by the baseline CHECK) with `source = 'web'`. No migration.
- **`app_users.consent_source`:** set to `'web_onboarding'` (free-text column).
  No migration.
- **Email storage:** reuses `brief_email` + `brief_email_status = 'pending'`.
  No migration. An existing account's email is **not** modified from this
  unauthenticated endpoint — email changes for known users should go through an
  authenticated settings path.
- **NANP-only (US +1)** in v1; international onboarding is a follow-up.
- **In-memory rate limiter** (single-instance); durable store needed before
  horizontal scale (see `docs/MOUNT_WEBONBOARD.md`).
- **`MSG_COMPLIANCE` is duplicated** (pipeline + this stream) and drift-guarded;
  recommend extracting to one shared module post-merge.
