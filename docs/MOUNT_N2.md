# MOUNT_N2 — wiring the weekly-note email backend (WS-F)

N2 built the email layer as **new files only**. Nothing existing was edited;
everything below is the integration Emil (or a day session) applies on merge.
Each change is one small, reviewable edit.

New files tonight:

```
src/services/brief/template.js    brand tokens + HTML/plaintext skeletons
src/services/brief/composer.js    canonical record ensure/load + SMS preview
src/services/brief/renderer.js    deterministic email renderer (law enforced)
src/services/brief/tokens.js      D18 action tokens + scoped unsubscribe (HMAC)
src/services/brief/transport.js   mock .eml transport + gated Sendgrid stub
src/jobs/briefEmail.js            hourly email job (consent gate, ledger, retry)
test/brief-email-security.test.mjs
test/brief-email-content.test.mjs
test/brief-email-job.test.js
test/brief-email-stubs.js
test/run-n2-brief-email.sh
test/fixtures/weekly-note-golden.{html,txt}
scripts/render-n2-samples.mjs
docs/n2-samples/*                 rendered samples for inspection
```

## 1. Scheduler (src/jobs/scheduler.js) — 2 lines

```js
import { runBriefEmails } from './briefEmail.js';
// inside startScheduler(), after the weekly-briefs line:
cron.schedule('0 * * * *', () => guard('weekly-brief-emails', runBriefEmails));
```

Safe to merge before enabling: the job no-ops unless `BRIEF_EMAIL_ENABLED=true`.

## 2. Env / config.js

The job reads `process.env` directly tonight (config.js was frozen). On merge,
move these into `config.js` following its style, and add the fail-closed boot
check below.

| var | default | meaning |
|---|---|---|
| `BRIEF_EMAIL_ENABLED` | unset (off) | master switch for the email job |
| `BRIEF_EMAIL_TRANSPORT` | `mock` | `mock` writes .eml files; `sendgrid` is the live stub |
| `BRIEF_EMAIL_LIVE` | unset (off) | hard gate; the sendgrid transport refuses to construct or send without `true` |
| `BRIEF_EMAIL_SENDGRID_KEY` | unset | live API key (never set tonight) |
| `BRIEF_EMAIL_OUTPUT_DIR` | `var/brief-email-out` | mock output dir |
| `BRIEF_EMAIL_LINK_SECRET` | unset | HMAC secret for unsubscribe links; **without it the job refuses to send at all** |
| `BRIEF_EMAIL_LINK_SECRET_PREV` | unset | previous secret during rotation |
| `BRIEF_EMAIL_LINK_BASE` | `https://cedrus.life` | link host |

Suggested `assertSecureBoot()` addition: in production, if
`BRIEF_EMAIL_ENABLED=true` then `BRIEF_EMAIL_LINK_SECRET` must be set, and
`BRIEF_EMAIL_LIVE=true` additionally requires `BRIEF_EMAIL_TRANSPORT=sendgrid`
+ key present — otherwise fail the boot, mirroring the Twilio checks.

## 3. Test battery (test/run-all.sh) — 3 lines

```sh
echo ""
echo "=== WS-F — weekly-note email backend ==="
sh test/run-n2-brief-email.sh
```

## 4. Required change to the SMS job (DESCRIBED, not made)

`src/jobs/weeklyBrief.js` keeps working untouched, but once email ships the
paired-channel model wants three edits in `sendBriefTo`:

1. **Record the SMS delivery in the ledger.** After the confirmed send +
   `markSent`, insert/update the `brief_deliveries` row `(brief.id, 'sms')`
   with `recipient` = the phone, `provider` = 'twilio',
   `provider_message_id` = the SID, `status` = 'sent'. Retries reuse the row
   (`attempts`), same shape as the email job. Until this lands, SMS deliveries
   simply aren't in the ledger — nothing breaks.
2. **Send the preview, not the whole note.** Replace the LLM-composed
   full-text SMS with the canonical preview from the same record:
   `composer.smsPreview(record, { viewUrl })`, where `viewUrl` wraps a
   `view_full_brief` token from `tokens.issueActionToken`. Product spec §7.1:
   greeting + 1–3 items + secure link, ≤2 segments. (The LLM composer can stay
   for `briefs.summary`/web copy; the SMS body itself becomes deterministic.)
   This is a product-behavior change — Emil should flip it deliberately, e.g.
   behind `BRIEF_SMS_PREVIEW=true`, not as a silent side effect of the merge.
3. **Share the canonical composer.** `sendBriefTo` already creates the briefs
   row + items; switching its record-materialization to
   `composer.ensureCanonicalBrief(...)` makes SMS and email provably share one
   code path (today they share the row by convention; the email job reuses
   whatever the SMS job wrote, and vice versa).

Order-of-operations note: whichever job runs first this week materializes the
items; the other reuses them. Both are idempotent against the
`briefs (user_id, week_of, brief_type)` unique row.

## 5. Future route work (T24 — none of it shipped tonight)

The renderer links to paths that need handlers later:

- `GET /n/:token` — `view_full_brief`, render-only, never consumes
  (`tokens.redeemActionToken` already implements the storage truth).
- `GET /note/action/:token` — interstitial; `POST` (CSRF-protected) calls
  `redeemActionToken(..., { consume: true })`, atomic single-use.
- `GET /email/unsubscribe/:token` — confirm page;
  `POST` — `tokens.redeemUnsubscribe` (one-click per RFC 8058 hits this POST).
  Writes `brief_email_status='unsubscribed'` + `consent_events
  ('brief_unsubscribed')`, touches nothing else.
- Neutral failure page for every invalid/expired/used/superseded token:
  "This link has already done its job, or its moment passed. Everything's
  still in your note."
- A retry poller for pending deliveries (the schema's
  `idx_brief_deliveries_pending` anticipates it): today a failed send retries
  only when a tick lands in the user's brief hour; a small sweep
  `status='pending' ORDER BY created_at` would retry sooner. The SMS job has
  the same limitation.

## 6. Deliberate deviations + WS-C asks

1. **Unsubscribe is not a `brief_action_tokens` row.** The N2 brief asked for
   unsubscribe + snooze rows in `brief_action_tokens`; the live CHECK
   constraint has no `unsubscribe` action type (7 values, all note-actions),
   and session8 (WBT-G3, decision U-2) deliberately designs unsubscribe as a
   separate per-user mechanism scoped to `brief_email_*`. Tonight's
   implementation follows U-2: a stateless HMAC-SHA256 token (versioned,
   rotating secrets, timingSafeEqual verification, ~1-year acceptance for
   CAN-SPAM), redeemed by `tokens.redeemUnsubscribe`. **WS-C decision for
   Emil:** either bless the stateless design (nothing to migrate), or add a
   `brief_email_unsubscribe_token_hash` column / an `unsubscribe` action type
   and swap the implementation — it's isolated in `tokens.js`.
2. **Snooze = `remind_tomorrow`.** The schema/product term for "snooze" —
   used as-is.
3. **Crisis suppression flag is not queryable yet** (`crisis_suppressed_until`
   needs the WS-C migration flagged in docs/WSB_FLAGS_FOR_WSC.md). The job
   already calls `isInSuppressionWindow` (fails open=false today) and the
   muted register is implemented + tested; until the column lands, the
   renderer ALSO excludes anything with negative valence markers outright
   (voiceGuard loss-language escalation), so negative content cannot render
   cheerfully regardless. When the column ships, no email-side change is
   needed — the window starts working.
4. **`briefs.status` untouched by email.** 'sent' remains the SMS journey
   marker (eligibility depends on it); email's send-state lives entirely in
   `brief_deliveries`. If Emil later wants "email-only users", eligibility
   needs its own look at the ledger, not `briefs.status`.

## 7. Sending checklist (for a LATER session — none of this tonight)

SendGrid (or SES) account + domain auth for cedrus.life: SPF include, DKIM
CNAMEs, DMARC `p=none` ramp; `brief@cedrus.life` verified sender;
`help@cedrus.life` mailbox exists (D19); FBL/bounce webhook → suppression +
the quiet settings notice. Then `BRIEF_EMAIL_TRANSPORT=sendgrid`,
`BRIEF_EMAIL_LIVE=true`, key in Railway env — and only after the double-opt-in
confirm flow (T22/T24 routes) exists, since `subscribed` users can't exist
without it.
