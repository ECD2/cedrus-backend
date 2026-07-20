# Chat Memory Import — frontend contract (NF2-IMPORT)

The API surface for "extract your memories from ChatGPT and Claude into
Cedrus." The review UI is a next-wave frontend task; it builds against this
document the way the dashboard builds against `WEB_API_CONTRACT.md`.

Backend: `src/routes/api/importRoutes.js` + `src/services/chatImport.js`.
Mount instructions for Emil: `docs/MOUNT_IMPORT.md`.

## 0. The product moment

The user downloads their data export from ChatGPT (Settings → Data controls →
Export data → the emailed .zip) or Claude (Settings → Privacy → Export data),
drops the file on cedrus.life, and a minute later reviews "here's who and what
I found" grouped by person. They tick what's true, hit save, and Cedrus starts
life already knowing their people. **Upload-only, forever: Cedrus never asks
for ChatGPT or Claude credentials and never offers OAuth to an AI provider.**
If a design ever wants "connect your account", the answer is no (security rule
S12).

## 1. Auth

Same as every `/api` route: `Authorization: Bearer <supabase access_token>`.
Identity is token-derived; any user id in a body is ignored. 401 = sign in,
403 = signed in but no Cedrus account linked.

## 2. Endpoints

```
POST /api/import/chat-export          body: the raw file bytes
     Content-Type: application/octet-stream
GET  /api/import/:id                  poll while extracting
POST /api/import/:id/confirm          { accept: … }   (JSON)
POST /api/import/:id/discard
```

Upload from a file input is one line: `fetch(url, { method: 'POST', headers,
body: file })` — do NOT wrap it in FormData and do NOT send JSON. Accepted
files: the export .zip as downloaded, or a bare `conversations.json`. Cap:
50MB (413 past it). Executables and anything that isn't a zip/JSON export are
rejected by content (422), no matter the filename.

## 3. The job lifecycle

`POST /chat-export` responds `202` (or `200` when the same file is re-uploaded
and the existing job is returned — see §7) with:

```json
{ "import": {
    "id": "…", "status": "extracting", "format": "chatgpt",
    "created_at": "…", "expires_at": "…",
    "progress": { "batches_done": 0, "batches_total": null },
    "counts": { "conversations": 12, "user_messages": 840,
                "considered_messages": 0, "quarantined_batches": 0,
                "failed_batches": 0, "people_proposed": 0, "facts_proposed": 0 },
    "error": null } }
```

Poll `GET /api/import/:id` every 2–3s while `status` is `"extracting"`.
`progress.batches_done / batches_total` drives the progress bar once
`batches_total` is set. Statuses:

| status | meaning | UI |
|---|---|---|
| `extracting` | parsing done, model runs in progress | progress screen |
| `ready` | proposals waiting for review | review screen (§4) |
| `confirmed` | user saved; `results` has counts | done screen |
| `discarded` | user discarded | back to upload |
| `failed` | extraction failed; `error` has a code | plain retry copy |

## 4. The review screen (`status: "ready"`)

```json
"proposals": { "people": [
  { "key": "p:5f0c…", "person_id": "5f0c…", "name": "Ana",
    "relationship": null, "matched_existing": true, "mention_count": 4,
    "facts": [
      { "id": "…", "fact_type": "interest", "fact_key": "music",
        "fact_value": "loves jazz", "confidence": 0.9,
        "theme": "preferences", "evidence": "…my sister Ana loves jazz…",
        "already_known": true } ] },
  { "key": "n:mike", "person_id": null, "name": "Mike",
    "relationship": "buddy", "matched_existing": false, "mention_count": 2,
    "facts": [ … ] } ] }
```

Rendering rules (these came from the consent matrix C8 and the voice spec —
they are product law, not suggestions):

- **Discard-by-default.** Checked items only are saved. Default-check a fact
  only when `confidence >= 0.5` and `already_known` is false. Everything
  `already_known` renders as "already in Cedrus" and is not checkable (the
  backend skips them even if sent).
- `matched_existing: true` groups render as "adds to Ana", not as a new
  person. New groups show name + relationship, both visible before saving.
- `theme` is one of `relationships | dates | preferences | travel |
  health_fitness | commitments` — usable as section chips.
- `evidence` is a short sanitized quote for "why is this here". It may be
  null. Render as plain text ONLY — never as HTML or markdown (it derives
  from an untrusted file).
- The proposal wording must PROPOSE, never announce: "I found — nothing is
  saved until you choose", never "Saved" or "Got it". Suggested header copy:
  "Here's what I found. Check what you want Cedrus to remember, everything
  else is thrown away."
- If `counts.quarantined_batches > 0`, show one plain, non-cheerful line,
  nothing more specific: "Some parts of your conversations covered heavy
  moments. Cedrus leaves those out of imports, and it never saved them."
  No count, no detail, no link.
- `counts.user_messages` vs `considered_messages` may differ a lot: Cedrus
  reads only messages that look like they're about people, dates, and
  preferences (six themes). Everything else is discarded unread. Copy if you
  want it: "Cedrus only looks for people, dates, and favorites. The rest of
  your conversations is ignored and deleted."

## 5. Confirm

```
POST /api/import/:id/confirm
{ "accept": { "people": ["p:5f0c…", "n:mike"], "facts": ["<fact id>", …] } }
— or —
{ "accept": { "all": true } }
```

- A key in `people` accepts that person AND all their listed facts (except
  `already_known`). A fact id in `facts` accepts that fact and implicitly its
  person. Send exactly what's checked; the two arrays may overlap safely.
- Single-use: the first successful confirm consumes the proposals. A second
  confirm (or a confirm after discard/expiry) is `404 not_found` — treat as
  "this import is done or gone", route by refetching status.
- `200` response:

```json
{ "confirmed": true, "message_id": "…",
  "results": { "people_created": 1, "people_matched": 2,
               "facts_saved": 7, "facts_skipped": 1 } }
```

`facts_skipped` counts idempotency skips (already present) plus facts held
back because the person already has a current value for a single-valued key
(relationship/job/city). Historical imports never overwrite what the user
told Cedrus directly — no need to explain this in the UI beyond the count.

Done-screen copy suggestion (positive band is earned here): "Saved. Cedrus
now knows 3 people and 7 things worth remembering. Text Cedrus anytime to
add more."

## 6. Discard

`POST /api/import/:id/discard` → `{ "discarded": true }`. Proposals are
dropped; nothing was ever written. Copy: "Thrown away. Nothing was saved."

## 7. Durability, expiry, idempotency, quotas — client rules

- **Proposals are held in process memory on the backend** (like capture
  proposals). A deploy/restart loses unreviewed imports: `GET` returns
  `404`. Handle by returning to the upload screen with: "That import
  expired before it was saved. Upload the file again and I'll take another
  look." Re-parsing is free and takes about a minute.
- Unreviewed imports also expire after **7 days** (`expires_at`).
- **Re-uploading the same file** while its job is alive returns the SAME job
  (`200` instead of `202`) — safe to make the upload button idempotent.
- **One import at a time** per account: `429 import_in_flight`.
- **Lifetime cap 3 imports** (that actually ran extraction): `429
  import_quota_exhausted`. Copy comes in `message`; don't invent harder
  wording. This is a beta abuse valve, one env var to change.

## 8. Errors

Always `{ "error": code, "message": "user-ready copy" }`. Show `message`
verbatim (it follows the voice rules — no em dashes, no exclamation points).

| status | error | when |
|---|---|---|
| 401/403 | `auth_required` / `no_linked_account` | §1 |
| 413 | `file_too_large` | upload or inflated JSON past caps |
| 422 | `unsupported_type` `invalid_file` `unsupported_format` `empty_export` | not a real export / no user messages |
| 422 | `invalid_request` | empty accept, malformed body |
| 429 | `import_in_flight` `import_quota_exhausted` | §7 |
| 409 | `not_ready` | confirm while still extracting |
| 404 | `not_found` | unknown/expired/foreign/consumed import id |
| 500 | `internal` | retry copy |

## 9. What the backend guarantees (so the UI doesn't have to)

- Only USER-authored messages are read; assistant turns never.
- Imported text is data, never instructions; it is sanitized before any
  model sees it, and only six themes of facts can come out the other side
  (medical, financial, legal, work content, passwords, dating logistics are
  dropped unread).
- Crisis-adjacent content is quarantined server-side and never proposed.
- Nothing is durable before confirm; unchecked items are never written.
- The raw file is parsed in memory and released immediately — it is never
  stored, so "re-parse later" is impossible by design (that's the privacy
  promise, not a bug).
- Confirmed facts carry `source: 'imported'` and trace to one anchor
  message row (`provider: 'import'`) for future "delete this import".
