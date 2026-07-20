# Mounting the chat-memory import (`/api/import`) — merge-owner instructions

Branch `feat/chat-import` (worktree `nb-import`). NEW FILES ONLY, per the
night-fleet rules — `src/index.js` and `test/run-all.sh` are not touched by
this stream and need the two edits below at integration.

New files:

```
src/parsers/chatExport.js          file bytes → user-authored messages (zip reader included)
src/services/importScope.js        six-theme filter, secret scrub, relevance scorer
src/services/importJobs.js         in-memory job/proposal store (TTL 7d, single-confirm)
src/services/chatImport.js         orchestrator: quota → batches → understand() → proposals → confirm
src/routes/api/importRoutes.js     /api/import router (JWT, raw-body upload)
test/import-parsers.test.mjs       dependency-free parser + scope suite
test/import.test.mjs               end-to-end suite (bun mock.module, reuses test/web-fakes.mjs)
test/run-import-tests.sh           suite runner
docs/IMPORT_CONTRACT.md            frontend contract (review UI is a next-wave task)
docs/MOUNT_IMPORT.md               this file
```

## 1. The mount (src/index.js) — order matters

```js
import importRouter from './routes/api/importRoutes.js';
```

```js
app.use('/api/onboard', onboardRouter); // existing
app.use('/api/import', importRouter);   // NF2-IMPORT — MUST sit BEFORE app.use('/api', apiRouter)
app.use('/api', apiRouter);             // existing
```

Why before: the N3 `apiRouter` runs `requireUser` as router-level middleware
for anything under `/api/*` that reaches it. Mounted after, every import
request would be authenticated twice (two Supabase Auth round-trips per
call); mounted before, exactly once. Nothing breaks if you get it wrong —
it's just wasteful.

Note the upload route reads a RAW body (`application/octet-stream`), which
the app-level `express.json`/`urlencoded` parsers skip entirely, so the
100kb app-wide body caps don't apply to it; the router enforces its own
50MB cap while streaming.

## 2. The battery (test/run-all.sh)

Append the block:

```sh
echo ""
echo "=== NF2 — chat memory import (MOUNT_IMPORT) ==="
sh test/run-import-tests.sh
```

Both suites are green on this branch, and the full existing battery was run
green alongside them (nothing existing was modified).

## 3. Environment variables (all optional, defaults sane for beta)

| Var | Default | Purpose |
|-----|---------|---------|
| `IMPORT_MAX_BYTES` | 52428800 (50MB) | upload cap (compressed) |
| `IMPORT_MAX_JSON_BYTES` | 104857600 (100MB) | inflated conversations.json cap (zip-bomb guard) |
| `IMPORT_CHAR_BUDGET` | 120000 | total chars of high-signal messages fed to the model per import |
| `IMPORT_BATCH_CHARS` | 3500 | chars per model call |
| `IMPORT_MAX_MODEL_CALLS` | 25 | hard ceiling of extraction calls per import |
| `IMPORT_LIFETIME_MAX` | 3 | lifetime imports per user (the abuse valve; one number to change) |

No required vars and no `src/config.js` change: the service reads these from
`process.env` directly (same pattern as web onboarding). Worst-case model
spend per user ever: `IMPORT_LIFETIME_MAX × IMPORT_MAX_MODEL_CALLS` calls.

## 4. What it does (one paragraph)

JWT-gated raw upload of a ChatGPT/Claude export (zip or bare
conversations.json; magic-byte typed, executables rejected, dependency-free
zip reader with inflate cap). User-authored messages only. A pure-JS scorer
keeps the relationship/date/preference signal, each excerpt is neutralized
with the same sanitizer the web-search path uses, and batches run through the
EXISTING `understand()` entry point — unmodified, with a chat-only client so
`performWebSearch()` structurally cannot fire on imported content. Crisis
batches are quarantined by the existing Priority-0 gate (count only, no
content). Model output is disposed in code: six-theme allow-list, secret
scrub, tautology drop, foreign-person_id scrub, cross-batch dedup, fuzzy
match against existing people, `already_known` marking against current facts.
Result: proposals grouped by person, held in memory only. Confirm is the
first durable write: one deterministic anchor `messages` row
(`channel='web'`, `provider='import'`), accepted people created, accepted
facts inserted with `source='imported'` + `source_message_id`. Never any
supersession from imports; single-valued keys (relationship/job/city) are
skipped when a current value exists. Per-call `agent_runs` logging
(`run_type='chat_import'`), plus one `chat_import_job` row per import — the
lifetime quota is counted from those rows, never a mutable counter.

## 5. Deviations from the older technical design §3 — flagged, with reasons

1. **Previews live in process memory, not `ingested_items`.** No such table
   exists in the live schema and tonight is branch-only/no-hosted-DB. The
   store mirrors the capture-proposal store semantics (TTL, single-use
   take). Consequence (documented in the contract): a deploy loses
   unreviewed previews; the client re-uploads. When an `ingested_items`-
   style table lands in a future migration, `importJobs.js` is the only
   file to swap.
2. **Facts are written by `chatImport.js`, not `memory.addFact()`.**
   `addFact()` can't take a `source` and always applies supersession —
   wrong for historical imports, and editing it was out of bounds tonight.
   The import writer reuses `canonicalFactKey()` and deliberately does NOT
   supersede. Post-merge cleanup option: give `addFact()` optional
   `{ source, neverSupersede }` params and delete ~30 lines here.
3. **No `consent_events` audit row.** The table's CHECK constraint allows
   only `opt_in|opt_out|help|consent_captured`. Audit rides the structured
   log stream (`import.confirmed` / `import.discarded`), `agent_runs`, and
   the anchor message row. A future migration could widen the CHECK with
   `import_confirmed|import_discarded`; the write is one line to add in
   `confirmImport()`.
4. **`message_channel` has no `import` value**, so the anchor row uses
   `channel='web'` + `provider='import'` + `message_type='import'` —
   distinguishable for the future "delete this import" path.
5. **Fuzzy dedup is the existing exact/contains MVP** (`people.fuzzyFind`).
   It folds "June" → "Grandma June" and exact-name duplicates; it can NOT
   fold "Anna" → "Ana" (not a substring). The pg_trgm upgrade noted in
   `people.js` would improve both SMS and import at once.
6. **Suppression side effect:** a crisis signal in an OLD imported log opens
   the same 48h promo-suppression window a live SMS would (it runs inside
   `understand()`, which this stream uses read-only). Conservative in the
   safe direction — promos pause, nothing else changes. Flag for a later
   product decision if it bothers anyone.

## 6. Verifying after mount (5 minutes, no live keys needed)

```sh
sh test/run-import-tests.sh          # both import suites
sh test/run-all.sh                   # full battery incl. the new block
```

Then with the server running and a real session token:

```sh
# happy path with a tiny fixture (bare conversations.json, Claude shape)
printf '[{"chat_messages":[{"sender":"human","text":"My sister Ana loves jazz and her birthday is March 4"}]}]' > /tmp/conv.json
curl -s -X POST localhost:3000/api/import/chat-export \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @/tmp/conv.json | jq .
curl -s localhost:3000/api/import/<id> -H "Authorization: Bearer $TOKEN" | jq .import.proposals
curl -s -X POST localhost:3000/api/import/<id>/confirm \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"accept":{"all":true}}' | jq .
```

Expect: proposals grouped under Ana; after confirm, a `facts` row with
`source='imported'`, and one `messages` row with `provider='import'`.
(This spends 1 lifetime-quota row and ~1 model call for that account.)

## 7. Follow-ups this stream deliberately did NOT build

- The review UI (next wave; contract ready).
- Durable preview holds (migration; see §5.1).
- "Delete this import" (needs the deletion spec's `ingested_item`-style
  cascade; the anchor-message provenance is already in place for it).
- Live-API/OAuth import: never (S12).
