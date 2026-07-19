# Mounting the N3 web API (`/api`) — instructions for the merge owner

N3 was forbidden from editing existing files, so `src/index.js` does not yet
mount the new router. The mount is two lines.

## The edit (src/index.js)

Add the import next to the other routers:

```js
import apiRouter from './routes/api/index.js';
```

Add the mount next to the other `app.use` lines (order among the routers
does not matter, but it must sit BEFORE the error-handling middleware, like
the others):

```js
app.use('/api', apiRouter);   // N3: web capture, priority swap, restore
```

That's the whole change. Notes:

- The app-wide `express.json({ limit: '100kb' })` in index.js already
  covers `/api`; the router also carries its own JSON parser so it can be
  mounted standalone (tests do this). body-parser skips a body that has
  already been read, so the double mount is harmless.
- No new environment variables. Auth is delegated to Supabase Auth via the
  existing service-role client (`supabase.auth.getUser`), so there is no
  JWT secret to configure and `src/config.js` needed no changes.
- No schema changes. The only DB surfaces used are existing ones:
  `app_users.auth_user_id` (baseline), the `set_priority_people` RPC
  (2026-07-13 migration, service_role-only), the `people` archive columns,
  `messages` with the existing `channel='web'` enum value, and `agent_runs`
  (`run_type='web_capture'`).

## Testing after the mount

```sh
sh test/run-all.sh          # existing battery (unchanged files, must stay green)
bun test/web-api.test.mjs   # N3 suite: auth, isolation, propose/confirm, swap, restore
```

`test/run-all.sh` is an existing file, so N3 did not add its suite to it.
If the merge owner wants the N3 suite in the battery, append to
test/run-all.sh:

```sh
echo ""
echo "=== N3 — web API (capture / priority / restore) ==="
bun test/web-api.test.mjs
```

(`bun` explicitly, not `$RUNNER`: the suite uses bun's `mock.module` and
auto-install, so it does not run under node/jsc.)

## Smoke check (optional, staging only)

With a logged-in web session's access token:

```sh
curl -sS https://<backend>/api/people/archived \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Expect `{"people":[...]}` for a linked account, `401` without the header.
