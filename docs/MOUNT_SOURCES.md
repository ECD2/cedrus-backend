# Mounting the Interests API (`/api/interests`) — instructions for the merge owner

NF2-SOURCES was forbidden from editing existing files, so `src/index.js`
does not yet mount the new router and `test/run-all.sh` does not yet run
the new suite. The mount is two lines; the battery add is three.

New files in this branch (`feat/interests-api`), nothing else touched:

- `src/services/interests.js` — CRUD service on the N5 `interests` table
- `src/routes/api/interests.js` — router (self-carries JSON parsing + requireUser)
- `test/interests.test.mjs` — suite (bun, mock.module, reuses `test/web-fakes.mjs`)
- `docs/INTERESTS_CONTRACT.md` — the contract NF2-DASHBOARD builds against
- `docs/MOUNT_SOURCES.md` — this file

## The edit (src/index.js)

Add the import next to the other routers:

```js
import interestsRouter from './routes/api/interests.js';
```

Add the mount next to the other `app.use` lines (before the error-handling
middleware, like the others):

```js
app.use('/api/interests', interestsRouter);   // NF2-SOURCES: user interests CRUD
```

Notes:

- Ordering relative to the N3 `app.use('/api', apiRouter)` mount does not
  matter: the N3 router defines no `/interests` route, and express only
  404s a mounted router's misses after trying the later mounts. Putting
  `/api/interests` first is marginally cleaner if you want determinism.
- The router self-carries `express.json({ limit: '100kb' })` and
  `requireUser` (same double-mount-harmless pattern as the N3 router), so
  it also works mounted standalone — the tests do this.
- No new environment variables. Auth is the same Supabase-JWT middleware
  (`routes/api/auth.js`) the rest of `/api` uses.
- No schema changes. The only DB surface used is the N5 `interests` table
  (migration `20260719120002_interests_foundation.sql`, already pushed),
  written via the existing service-role client — which matches that
  migration's "backend-written only" grant design.

## Battery add (test/run-all.sh)

Append before the final `ALL BATTERY SUITES PASSED` echo:

```sh
echo ""
echo "=== NF2 — interests API (CRUD / auth / opt-out) ==="
bun test/interests.test.mjs
```

(`bun` explicitly, not `$RUNNER`: the suite uses bun's `mock.module`, like
the other web suites.)

## Testing after the mount

```sh
sh test/run-all.sh            # existing battery, must stay green
bun test/interests.test.mjs   # NF2 suite: 79 checks — CRUD, auth,
                              # cross-tenant denial, opt-out honored
```

## Smoke check (optional, staging only)

With a logged-in web session's access token:

```sh
curl -sS https://<backend>/api/interests \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → {"interests":[...]} (active-only default)

curl -sS -X POST https://<backend>/api/interests \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"category":"sports_team","label":"New York Yankees"}'
# → {"created":true,"reaffirmed":false,"interest":{...}}   (repeat → reaffirmed)
```

Expect `401` without the header. Full endpoint semantics:
`docs/INTERESTS_CONTRACT.md`.
