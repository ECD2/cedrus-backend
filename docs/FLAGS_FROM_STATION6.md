# Station 6 (UI-09) — mount + test registration for the merge owner

Station 6 was forbidden from editing shared files, so `src/index.js` does not
yet mount the new router and `test/run-all.sh` does not yet run the new suite.
The mount is two lines; the battery add is three. Nothing else in those files
changes.

New files on this branch (`feat/reminders-endpoint-ui09`), nothing existing
touched:

- `src/routes/api/reminders.js` — read-only `GET /api/reminders` router
  (self-carries `express.json` + `requireUser`; reads `reminders` + `messages`)
- `test/reminders-api.test.mjs` — suite (bun, `mock.module`, reuses
  `test/web-fakes.mjs`)
- `docs/REMINDERS_READ_CONTRACT.md` — the contract the UI-09 frontend builds against
- `docs/FLAGS_FROM_STATION6.md` — this file

## The edit — `src/index.js`

Add the import next to the other `/api` routers:

```js
import remindersRouter from './routes/api/reminders.js';
```

Add the mount next to the other self-carried `/api/*` `app.use` lines (with
`onboard` / `import` / `interests`), before the general `app.use('/api', apiRouter)`:

```js
app.use('/api/reminders', remindersRouter); // UI-09: read-only upcoming reminders + delivery state (JWT, self-carries json+requireUser)
```

Notes:

- Ordering relative to `app.use('/api', apiRouter)` does not matter for
  correctness (the N3 router defines no `/reminders` route), but mounting it
  before — like `interests` — is marginally cleaner and deterministic.
- The router self-carries `express.json({ limit: '100kb' })` and `requireUser`
  (same harmless double-mount pattern as the N3 / interests routers), so it
  also works mounted standalone — the test does exactly this.
- **No new environment variables.** Auth is the same Supabase-JWT middleware
  (`routes/api/auth.js`) the rest of `/api` uses.
- **No schema changes, and no migration dependency to gate the mount on.** The
  endpoint reads only pre-existing columns:
  - `reminders`: `id, user_id, person_id, title, note, reminder_type, status,
    trigger_at, created_at, sent_message_id` — all present since the baseline
    (`20260711053439_cedrus_remote_baseline`).
  - `messages`: `id, user_id, provider_status, provider_payload, sent_at,
    message_type` — present, written by `services/messages.js` +
    `routes/deliveryStatus.js`.
  - It deliberately does **not** select the delivery-states migration's new
    columns (`attempts`/`claimed_at`/`failed_at`/`failure_reason`), so it runs
    correctly whether or not `20260719120001_reminder_delivery_states` is
    applied. That migration's new `status` values (`sending`, `failed`) are
    accepted as read filters regardless — a read filter never touches the write
    CHECK, and a status with no rows simply matches nothing.

## Battery add — `test/run-all.sh`

Append before the final `ALL BATTERY SUITES PASSED` echo:

```sh
echo ""
echo "=== UI-09 — reminders read API (upcoming + delivery state) ==="
bun test/reminders-api.test.mjs
```

(`bun` explicitly, not `$RUNNER`: the suite uses bun's `mock.module`, like the
other web suites.)

## Testing after the mount

```sh
sh test/run-all.sh                # existing battery, must stay green
bun test/reminders-api.test.mjs   # UI-09 suite: 68 checks — auth wall,
                                  # user-scoping, delivery join, status
                                  # filters, ordering, read-only guarantee
```

## Smoke check (optional, staging only)

With a logged-in web session's access token:

```sh
curl -sS "https://<backend>/api/reminders" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → {"count":N,"reminders":[...]}   (live set: everything but canceled)

curl -sS "https://<backend>/api/reminders?status=sent" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → the delivery log: each sent reminder carries its `delivery` state
```

Expect `401` without the header, `422` on an unknown `?status`. Full endpoint
semantics: `docs/REMINDERS_READ_CONTRACT.md`.
