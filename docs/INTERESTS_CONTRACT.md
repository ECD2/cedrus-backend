# Cedrus Interests API Contract — v1 (Night session NF2-SOURCES)

The user tells Cedrus their interests — teams, topics, things they like to
read and follow — and those feed (a) dashboard sections and (b) the weekly
brief. This document is the contract for that API. The NF2-DASHBOARD
"Your interests" section builds against THIS document (typed mock until the
API mounts); nothing outside it is promised. Served by the Express backend
(Railway), mounted at `/api/interests` (see `docs/MOUNT_SOURCES.md`).

Base path: `https://<backend-host>/api/interests`
Content type: `application/json` both ways. Bodies over 100 KB are rejected
by the app-wide body cap (400).

Storage is the N5 `interests` table (migration
`20260719120002_interests_foundation.sql`, already live). All writes go
through this API (service role); the browser's own Supabase client is
read-only on this table by design.

---

## 1. Authentication (every route)

Identical to the rest of the web API (`docs/WEB_API_CONTRACT.md` §1):

    Authorization: Bearer <supabase access_token>

- The acting user is ALWAYS derived from the token. No route reads a
  `user_id` from the body, path, or query (sending one is a 422, see §4).
- `401 { "error": "auth_required", ... }` — header missing/malformed, or
  the token is invalid/expired/forged.
- `403 { "error": "no_linked_account", ... }` — token valid but no linked
  `app_users` row.

## 2. Error shape, and the Interest object

Non-2xx responses are always:

```json
{ "error": "<machine_code>", "message": "<human copy>" }
```

`message` is user-displayable as-is (product voice). Branch on `error`,
never on `message` text. Codes used by this API: `auth_required` (401),
`no_linked_account` (403), `not_found` (404), `invalid_request` (422),
`duplicate_interest` (409), `internal` (500).

Every success body carries Interest objects of exactly this shape — for
the dashboard's typed mock:

```ts
type InterestCategory =
  | 'sports_team' | 'hobby' | 'media_show' | 'media_music'
  | 'food' | 'place' | 'other_freeform';

type Interest = {
  id: string;                       // uuid
  category: InterestCategory;
  label: string;                    // display string, 1..200 chars, trimmed
  provenance: 'user_stated' | 'inferred_confirmed';
  surfacing_state: 'active' | 'resting' | 'off';
  last_affirmed_at: string;         // ISO timestamptz
  created_at: string;               // ISO timestamptz
  updated_at: string;               // ISO timestamptz
};
```

Notes the UI should rely on:

- **The category vocabulary above is the live N5 CHECK constraint** —
  build the picker from exactly these seven values. There is no `topic`
  category; free-form "topics I follow" belong in `other_freeform`.
  Suggested picker labels: Team, Hobby, Show or podcast, Music, Food,
  Place, Something else.
- **There is no `confidence` field.** It exists internally and is never
  serialized; do not design UI around it.
- **`surfacing_state` is the per-interest opt-out.** `off` = the user
  silenced it (kept, not deleted — they can flip it back). `resting` is
  reserved for a future backend sweep: render it like `off` if you ever
  see it, but you cannot write it (§5).
- **provenance**: `user_stated` = they told Cedrus directly (including
  every add made through this API); `inferred_confirmed` = Cedrus guessed
  and the user confirmed via the capture flow. Fine to badge subtly;
  both are confirmed states.

## 3. GET /api/interests — list

Query parameters (both optional):

- `state` — `active` (DEFAULT) | `resting` | `off` | `all`
- `category` — one InterestCategory value

**The default is active-only, on purpose.** Anything that surfaces
interests as content — the dashboard sports module, future brief wiring —
calls with no `state` param and honors the per-interest opt-out by
construction. Only the management surface ("Your interests") should pass
`state=all`, so silenced rows stay visible and re-enableable there.

Ordering: `created_at` ascending (stable; group client-side as needed).
Repeating a query param is a 422; unknown values are a 422.

Success `200`:

```json
{ "interests": [ Interest, ... ] }
```

An empty list is `{ "interests": [] }` — the warm empty state ("tell
Cedrus your teams") is the UI's to render.

Consumer examples:

- Sports module: `GET /api/interests?category=sports_team`
- Management section: `GET /api/interests?state=all`

## 4. POST /api/interests — add (explicit, user-stated)

The user typing an interest into the management UI IS the confirmation, so
this writes immediately — the capture propose→confirm loop does not apply
here. The server sets `provenance: 'user_stated'`.

Request — exactly these two fields, nothing else:

```json
{ "category": "sports_team", "label": "New York Yankees" }
```

- `category` — required, one of the seven values.
- `label` — required string; trimmed server-side; 1..200 chars after trim.
- **Any other key is a 422** (`invalid_request`). In particular
  `provenance`, `confidence`, `surfacing_state`, and `user_id` are
  server-owned; inferred interests can only enter via the capture confirm
  flow, never through this endpoint.

Success `200`, two shapes:

New interest:

```json
{ "created": true, "reaffirmed": false, "interest": Interest }
```

Re-add (same category + label, case-insensitively — the user re-stating an
interest they already have):

```json
{ "created": false, "reaffirmed": true, "interest": Interest }
```

Re-affirm semantics (server-side, automatic): no duplicate row is created;
`last_affirmed_at` resets to now; the latest casing of `label` wins; a
silenced (`off`) interest flips back to `active` (they just told us they
like it); `inferred_confirmed` upgrades to `user_stated`. The UI can treat
both shapes identically — refresh the list, the row is present and active.

## 5. PATCH /api/interests/:id — update

v1 updatable surface, one or both of:

```json
{ "label": "Yankees", "surfacing_state": "off" }
```

- `label` — rename; same 1..200 trimmed rule; renaming onto another
  interest in the same category (case-insensitively) is a
  `409 duplicate_interest`.
- `surfacing_state` — `active` | `off` only. This is the opt-out toggle.
  Sending `resting` is a 422 (sweep-reserved). Turning a non-active
  interest back to `active` also resets `last_affirmed_at` (opting back
  in is an affirmation); a plain rename does not.
- Empty patch or any other key: 422.

Success `200`:

```json
{ "updated": true, "interest": Interest }
```

`404 not_found` for an id that is malformed, unknown, or another user's
(indistinguishable by design).

## 6. DELETE /api/interests/:id — remove

A real delete — distinct from the opt-out (`off` keeps the row; remove
forgets it). The management UI should offer both: "hide from my
dashboard" → PATCH `off`; "remove" → DELETE.

Success `200`:

```json
{ "removed": true, "id": "<uuid>" }
```

`404 not_found` for malformed/unknown/foreign ids — including a repeated
delete of the same id, so a double-tap may treat 404 as success-noop.

## 7. Ownership and isolation (what the backend guarantees)

- Every row returned belongs to the token's user; every write is scoped
  `user_id = <token user>`. A foreign interest id behaves exactly like an
  unknown id (404) on PATCH and DELETE, and never appears in GET.
- Labels are per-user: two users adding the same team hold independent
  rows; nothing about one user's interests is observable by another.

## 8. Later wiring (noted, deliberately not in v1)

- **Weekly brief**: the brief consuming interests is a later wiring task —
  the contract's `state`-default already gives it opt-out-honoring reads
  for free. Not built tonight.
- **Live sports data / provider ids**: post-beta; `sports_team` rows are
  label-only today.
- **`resting` sweep** (quiet retirement of long-unaffirmed interests):
  future backend job; the API already reads it, never writes it.
