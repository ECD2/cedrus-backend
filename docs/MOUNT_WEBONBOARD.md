# Mounting the web-onboarding endpoint (`/api/onboard`) — merge-owner instructions

This stream was forbidden from editing existing files, so `src/index.js` does
not yet mount the new router. The mount is two lines, but **order matters**.

## The edit (src/index.js)

Add the import next to the other routers:

```js
import onboardRouter from './routes/api/onboard.js';
```

Add the mount. It **MUST sit BEFORE** `app.use('/api', apiRouter)`:

```js
app.use('/api/onboard', onboardRouter); // PUBLIC website onboarding — BEFORE the /api router
app.use('/api', apiRouter);             // N3 (existing)
```

Why the order is load-bearing: the N3 `apiRouter` installs `requireUser`
(Supabase-JWT auth) as router-level middleware, so ANY request that reaches it
under `/api/*` is challenged for a bearer token. `/api/onboard/start` is a
**public** route for visitors who have no account and no session yet. Mounting
it first means Express matches and fully handles `/api/onboard/*` before the
authed `/api` router ever sees it. Mounted after, every onboarding request
would 401.

(If you would rather not depend on ordering, mount it on a non-`/api` path,
e.g. `app.use('/onboard', onboardRouter)`, and tell the frontend contract to
use `/onboard/start`. The `/api/onboard/start` path in
`docs/WEB_ONBOARD_CONTRACT.md` is the intended one; if you change it, change
the contract too.)

## Environment variables (all optional)

| Var | Default | Purpose |
|-----|---------|---------|
| `WEB_ONBOARD_DRY_RUN` | `false` | `true` = run the full flow (create user, record consent + a `dry_run` outbound row) but do NOT call Twilio. Use to verify wiring on staging before texting real people. |
| `WEB_ONBOARD_IP_MAX` | `8` | Max submissions per IP per window. |
| `WEB_ONBOARD_IP_WINDOW_MS` | `3600000` (1h) | IP window. |
| `WEB_ONBOARD_PHONE_MAX` | `3` | Max submissions per phone per window. |
| `WEB_ONBOARD_PHONE_WINDOW_MS` | `3600000` (1h) | Phone window. |

No new **required** vars, and `src/config.js` needed no changes: the service
sends through the existing `sendSms` (`TWILIO_*` already configured) and reads
the optional knobs above straight from `process.env`.

Recommended, one line, in `src/index.js` for correct client IPs behind
Railway's proxy (the limiter falls back to `X-Forwarded-For` without it, but
this makes `req.ip` correct app-wide):

```js
app.set('trust proxy', 1);
```

## No schema changes

Every DB surface used already exists on `origin/main`:

- `app_users` insert: `phone` (unique), `timezone`, `sms_consent_at`,
  `consent_source = 'web_onboarding'` (free-text column, no CHECK), and — when
  an email is supplied — `brief_email` + `brief_email_status = 'pending'`
  (existing weekly-brief columns; `pending` = on file, unverified, never sent
  to; satisfies the lowercase / coherence / subscribed-requires-verified
  CHECKs).
- `consent_events` insert: `event_type = 'consent_captured'` (already in the
  baseline CHECK `('opt_in','opt_out','help','consent_captured')`), `source =
  'web'`.
- `messages` outbound `onboarding` row via the existing `messages.logOutbound`
  — this is what makes the user's first SMS reply flow correctly through the
  inbound pipeline instead of re-triggering the opt-in script (see
  `webOnboarding.js` header).

The DB trigger that auto-creates a new user's `is_self` person fires on the
`app_users` insert, exactly as it does for inbound first-contact.

## Twilio / compliance

- The first message is `MSG_COMPLIANCE`, sent **verbatim** — byte-identical to
  the pipeline's Twilio-approved opt-in confirmation. A drift-guard test fails
  the build if the two ever diverge.
- The **website form is the opt-in channel**, so it MUST present the express
  written-consent disclosure in `docs/WEB_ONBOARD_CONTRACT.md §Consent`. That
  disclosure is what makes this a compliant opt-in for the toll-free/A2P
  registration. Ship the form copy and the backend together.
- Before going live, set `WEB_ONBOARD_DRY_RUN=true`, exercise the form, confirm
  the `web.onboard.dry_run` log line and the `dry_run` outbound row, then flip
  it off.

## Testing after the mount

```sh
bun test/webonboard.test.mjs   # this suite: verbatim script, idempotency, no-leak, rate limits, normalization, race, dry-run
sh test/run-all.sh             # existing battery (unchanged files, must stay green)
```

`test/run-all.sh` is an existing file, so this stream did not add its suite to
it. To include it in the battery, append:

```sh
echo ""
echo "=== web onboarding (public /api/onboard/start) ==="
bun test/webonboard.test.mjs
```

(`bun` explicitly, not `$RUNNER`: the suite uses bun's `mock.module`.)

## Smoke check (staging, DRY RUN first)

```sh
curl -sS -X POST https://<backend>/api/onboard/start \
  -H 'content-type: application/json' \
  -d '{"phone":"+1<your-number>","email":"you@example.com"}'
# -> {"ok":true,"message":"If that number can receive texts, ..."}
# With WEB_ONBOARD_DRY_RUN=true: no text arrives; check logs for web.onboard.dry_run.
```

## Follow-ups worth filing (not blockers)

1. **Single source of truth for `MSG_COMPLIANCE`.** It is currently duplicated
   in `src/pipeline/index.js` and `src/services/onboardingCopy.js` (drift-
   guarded by a test) only because this stream could not edit the pipeline.
   Extract it to one shared module both import.
2. **Durable rate limiter.** The limiter is process-local (resets on deploy,
   not shared across instances). Fine for a single Railway instance; move to a
   Postgres table or Redis before horizontal scale.
3. **Line-type / true disposable detection.** Structural NANP validation
   cannot tell a live mobile from a disconnected or VoIP/burner line. Add a
   Twilio Lookup call if abuse warrants the per-lookup cost.
4. **Bot mitigation.** This is a public endpoint; pair it with a CAPTCHA on the
   form (see the contract) and/or a WAF rule. The backend cannot and must not
   solve CAPTCHAs.
