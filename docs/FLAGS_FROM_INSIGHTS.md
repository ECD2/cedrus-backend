# Mounting the Insights API (`/api/insights`) — instructions for the merge owner

INFRA-10 (Station 4) was forbidden from editing existing files, so
`src/index.js` does not yet mount the new router and `test/run-all.sh` does
not yet run the new suite. Both changes are additive and listed verbatim
below. **No shared file was touched by this branch.**

New files in this branch (`feat/infra-10-insights-endpoint`), nothing else
changed:

- `src/routes/api/insights.js` — the router (self-carries JSON parsing +
  `requireUser`; read-only surface over the existing insight engine)
- `test/insights-route.test.mjs` — the suite (bun, `mock.module`, reuses
  `test/web-fakes.mjs`)
- `docs/FLAGS_FROM_INSIGHTS.md` — this file

`src/services/insights.js` was **not** modified. The router only calls its
existing exports (`getInsightsForUser`, `getInsightsForPerson`).

## The edit (`src/index.js`) — 2 lines

Add the import next to the other `/api` routers (by the `interestsRouter`
import, ~line 13):

```js
import insightsRouter from './routes/api/insights.js';
```

Add the mount next to the other `app.use('/api/...')` lines, **before** the
catch-all N3 `app.use('/api', apiRouter)` (~line 45–46):

```js
app.use('/api/insights', insightsRouter); // INFRA-10: read-only insight engine feed (JWT, self-carries json+requireUser) (FLAGS_FROM_INSIGHTS)
```

### Endpoints it adds

| Method & path | Engine call | Returns |
|---|---|---|
| `GET /api/insights` | `getInsightsForUser(req.appUser, { limit?, perPerson? })` | `{ generatedAt, viewerTier, insights: Insight[] }` — the ranked feed, top `perPerson` (default 1) per person, optionally capped to `limit` |
| `GET /api/insights/person/:id` | `getInsightsForPerson(req.appUser, :id)` | `{ generatedAt, personId, viewerTier, insights: Insight[] }` — every ranked insight for one person |

Optional query params on the feed: `limit` (int 1–100) and `perPerson`
(int 1–10). Bad values (non-integer, out of range, or a repeated param)
→ `422 invalid_request`. `now` is **not** accepted from the client — the
engine owns the clock.

### Notes

- **Ordering** relative to the N3 `app.use('/api', apiRouter)` mount: put
  `/api/insights` **before** it, like `/api/interests` / `/api/import` /
  `/api/onboard`. The N3 router defines no `/insights` route, so the practical
  risk is nil, but keeping the specific mounts ahead of the catch-all is the
  house convention and is deterministic.
- The router **self-carries** `express.json({ limit: '100kb' })` and
  `requireUser` (same harmless double-mount pattern as the N3/interests
  routers), so it also runs mounted standalone — the test does this.
- **Entitlement is tagged, not enforced here.** Every insight keeps the
  engine's `entitlement` (`free` for Core 5, `pro` otherwise) and `gated`
  flags, and the feed returns `viewerTier`. A free viewer still *receives*
  gated (Pro) insights; billing enforcement stays the surface's job, exactly
  as `docs/INSIGHTS.md` §"Entitlement" specifies. This is a read surface only.
- **No new environment variables.** Auth is the same Supabase-JWT middleware
  (`routes/api/auth.js`) the rest of `/api` uses.
- **No schema changes and nothing to run.** The engine reads existing
  tables/views only; the two partial indexes in `docs/INSIGHTS.proposed.sql`
  remain optional and **unrun** (a perf nicety, not a dependency).

## Battery add (`test/run-all.sh`) — 3 lines

The route suite is a bun + `mock.module` integration test (real express
router + real auth middleware + real engine, only the Supabase seam faked),
so it belongs in **`test/run-all.sh`** alongside the other web suites
(`interests` / `web-api` / `webonboard` / `import`). It does **not** go in
`test/run-tests.sh`: that runner is the dependency-free *concat rig* for
pure-logic bundles (it strips imports and cannot mount express), so
**`test/run-tests.sh` needs no change.** (The engine's own pure-core proof,
`test/insights.test.js`, already lives there as bundle 10 and is untouched.)

Append to `test/run-all.sh` before the final `ALL BATTERY SUITES PASSED`
echo:

```sh
echo ""
echo "=== INFRA-10 — insights API (feed / auth / entitlement tags) ==="
bun test/insights-route.test.mjs
```

(`bun` explicitly, not `$RUNNER`: the suite uses bun's `mock.module`, like the
other web suites.)

## Testing after the mount

```sh
bun test/insights-route.test.mjs   # INFRA-10 suite: 24 checks — auth wall,
                                   # feed shape, entitlement tags passed
                                   # through, query validation, per-person
                                   # read, cross-tenant isolation
sh test/run-all.sh                 # full battery, must stay green
```

## Smoke check (optional, staging only)

With a logged-in web session's access token:

```sh
curl -sS https://<backend>/api/insights \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → {"generatedAt":"…","viewerTier":"free","insights":[ … ]}

curl -sS "https://<backend>/api/insights?limit=5&perPerson=2" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → same shape, ≤5 items, up to 2 reasons per person

curl -sS https://<backend>/api/insights/person/<person-uuid> \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
# → {"generatedAt":"…","personId":"…","viewerTier":"…","insights":[ … ]}
```

Expect `401` without the header, `403` for a valid-but-unlinked token, and
`422` for a bad `limit`/`perPerson`. Engine semantics + the `Insight` shape:
`docs/INSIGHTS.md`.
