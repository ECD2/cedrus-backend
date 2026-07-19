# N1 → N5 flags (schema owner)

Nothing here blocks the panel — v1 ships with **zero schema changes**.
These are needs N1 deliberately did not solve because schema is N5's.

## 1. Tester allowlist stays env-only — table only if self-serve is wanted

`TESTER_PHONES` is parsed at boot (`src/config.js`); the panel exposes a
masked read-only view and refuses mutation with a 501 + operator procedure
(contract §7). A runtime mutation of env-derived state would silently
revert on redeploy, so N1 did NOT build add/remove.

**If** Emil wants add/remove from the panel UI (rather than Railway env
edits), that genuinely requires a table. Sketch, for whenever you take it:

- `testers(phone text primary key /* digits-only, normalizePhone format */,
  added_by text not null default 'admin_panel', added_at timestamptz not
  null default now(), removed_at timestamptz)` — soft-remove so the audit
  trail survives.
- Backend change (belongs to a future admin stream, not N5): config falls
  back to the union of env + table; reset gate reads the same source.

## 2. Durable admin audit table (reiterating WS-A's flag)

Every panel route writes a structured JSONL audit event (the
STRUCTURED_LOGGING_SPEC §8 sink of record). WS-A already flagged a DB-side
`admin_audit` table to WS-C; the panel doubles the reasons to want it
(reads are now audit-logged too, and log retention on Railway is finite).
Not required for launch.

## 3. Index consideration at scale (not needed for beta)

`GET /admin/users/:id/health` reads recent outbound messages per user:
`messages(user_id, direction, sent_at desc)` has no covering index in the
baseline schema. At beta scale (hundreds of rows) this is irrelevant; if
the roster grows past a few thousand messages/user, consider
`create index … on messages (user_id, direction, sent_at desc)`.

## 4. No app_users.sub_status column — none needed

The night-ops brief mentioned a `sub_status` field; in the real schema
subscription status lives on `subscriptions.status`. The billing endpoint
derives `sub_status` from the newest `subscriptions` row, so **no** column
addition is requested.
