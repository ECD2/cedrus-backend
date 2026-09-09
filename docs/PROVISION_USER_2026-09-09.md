# provisionUser() — one account, one transaction (P1.2)

**2026-09-09 · branch `feat/provision-user-2026-09-09` · BUILD_PLAN P1.2 · audit findings 12 and 13**

## What landed

| File | What it is |
|---|---|
| `supabase/migrations/20260909120000_provision_user.sql` | The Postgres function `provision_user(actor, phone, display_name, capabilities, timezone)`, SECURITY DEFINER with `search_path = public, pg_temp`, EXECUTE for `service_role` only. Self-proving: three assertions and three controls run inside the migration's transaction, and any failure rolls the whole file back. **Not applied.** |
| `src/services/provisioning.js` | `provisionUser()` — the thin typed caller. One `rpc('provision_user', …)` call. It decides nothing. |
| `test/provision-user.test.mjs` | Bundle 42. Applies both real migration files to a real Postgres (PGlite, in-process) and forces every failure inside the database. 41 checks. |
| `test/mutate-bundle-42.sh` | Law 3 harness. 8 mutations, each expected to go red on a NAMED assertion or migration control. |
| `scripts/apply-provision-user-via-api.py` | The apply path that mirrors how the 2026-08-30 migration actually reached production (Management API + personal access token). |
| `package.json` | `@electric-sql/pglite` as a devDependency — the embedded Postgres the suite runs on. |

## The five things, and where each one happens

All inside `provision_user()`, in this order, in one transaction:

1. **The account row** — `app_users`: `role = 'member'`, `account_status = 'active'`, `invited_by = actor`, `invited_at = now()`, phone in THE ONE TRUE FORMAT (digits with country code). Written FIRST, on purpose — see the trigger note below.
2. **The sign-in identity** — `auth.users` (phone-OTP user, phone confirmed, no password, the four GoTrue token columns set to `''` rather than NULL) and its `auth.identities` row (`provider = 'phone'`). Then `app_users.auth_user_id` is set and the link is asserted: exactly one account carries the phone, exactly one carries the identity.
3. **The settings defaults** — `user_settings (user_id)`, every value from the column defaults. `brief_enabled = false`; no parameter of the function can arm delivery.
4. **The capability grants** — `user_capabilities`, one row per distinct requested name, `granted = true`, `granted_by = actor`. The function carries **no copy** of the vocabulary; the check constraint is the only authority, and a typo unwinds the whole account.
5. **Exactly one audit entry** — `admin_audit`: actor, `action = 'provision_user'`, target, detail with `phone_last4`, `display_name`, `capabilities`, `auth_user_id`. An INSERT and nothing else.

The function's own post-conditions then count settings (1), granted capabilities (= requested) and audit rows (exactly 1) before returning `{ user_id, auth_user_id, audit_id, phone, capabilities }`.

**Refusals, all with nothing written:** an actor who is not an active admin (`42501`, a suspended admin included), an existing account or identity for the phone (`23505`, by name), a phone that is not 10–15 digits (`22023`), an unknown capability (`23514`, from the constraint).

**No table parameter. No caller-chosen ids.** The argument list is pinned by the migration's own assertion and by Bundle 42. The only id the caller passes is the actor's, which the backend must take from `req.appUser.id` — never from a request body.

## Proof

**Bundle 42, `bun test/provision-user.test.mjs` — 41 checks, exit 0.** Against a real Postgres with the real migration files applied:

- **Control:** the successful path creates all five — checked row by row, including the link both ways, `brief_enabled = false`, the duplicate capability collapsed, and the audit detail carrying last-4 and never the full number. Audit count goes **0 → exactly 1**.
- **Fault 1, the one the prompt asked for:** fail it after the account row, at the capability grant, forced by the closed vocabulary's check constraint (`'run_agent'`, no s). Rejected with `23514`; zero `app_users`, `auth.users`, `auth.identities`, `admin_audit` rows for that phone; settings, capability and audit totals unchanged.
- **Fault 2:** a trigger installed on `user_capabilities` raising on insert, with VALID names — proves the unwind is the transaction's, not the vocabulary's. Nothing survives. Then the trigger is dropped and the identical call succeeds (the control that the zero was an unwind, not a broken call).
- **Fault 3:** a trigger on `admin_audit` — the LAST step. Nothing survives, so an account that could not be audited is not created.
- **The actor guard:** member, suspended admin, unknown id → `42501`; missing actor refused by the caller before any rpc.
- **The production auth-link trigger, both ways:** its body is not in this repo. Emulated as link-by-phone, the call succeeds with one linked account. Swapped for a hostile "always create a second account" variant, the call raises `23000` and nothing survives, including the trigger's own row.
- **Pins:** SECURITY DEFINER, pinned search_path, VOLATILE, exact argument list, no UPDATE/DELETE against `admin_audit` in the function body, no vocabulary copy, execute anon NO / authenticated NO / service_role YES.

**Mutation run, `sh test/mutate-bundle-42.sh` — 8 guards proven live, 0 missed, tree byte-identical afterwards.**

| # | Mutation | Went red on |
|---|---|---|
| 1 | **capabilities commit separately** — rpc without them, then a second PostgREST insert (the JS-sequence shape) | `FAIL fault at the capability step (closed vocabulary): no partial account survives` |
| 2 | the admin check removed from the function | the migration's own `CONTROL 3: a MEMBER was allowed to provision an account` |
| 3 | the audit row written twice | the migration's own `CONTROL 1: the successful path did not create all five` |
| 4 | SECURITY DEFINER dropped | `ASSERT: provision_user is not SECURITY DEFINER` |
| 5 | search_path pin dropped | `ASSERT: provision_user search_path is not pinned` |
| 6 | execute granted to `authenticated` | `ASSERT: authenticated can execute provision_user` |
| 7 | the caller ignores the rpc error (Lesson 1) | `FAIL … the call is rejected with 23514` |
| 8 | the function grows its own vocabulary copy | `FAIL the function body contains no copy of the capability vocabulary` |

Mutations 2–6 are caught by the migration file itself before the suite's assertions get a turn: the migration refuses to commit a function with those defects. That is the property that matters on the day it is applied to production.

## What is a fixture, and what is unverified from this machine

Stated plainly (Lesson 20, II.5):

- **`app_users`, `auth.users`, `auth.identities` are fixtures** in Bundle 42, built from what this repo's code writes and reads and from GoTrue's published schema. No prod dump of `app_users` exists in this repo. The three multi-user tables are NOT fixtures — the real 2026-08-30 migration creates them in the suite.
- **The `auth.users` column list is GoTrue's current schema as this session knows it.** If production's GoTrue schema differs (a renamed or newly NOT NULL column), the INSERT raises, the migration's CONTROL 1 fails, and the whole file rolls back — loudly, with the column named. Nothing half-applies.
- **`link_or_create_app_user_from_auth` could not be read from here.** The function is written to be safe under either behaviour (link or create) and Bundle 42 proves both. If production's trigger does something else again, the link assertions raise and the migration rolls back.
- **Phone-OTP sign-in for a SQL-created identity is unverified.** The identity is shaped the way GoTrue shapes its own (aud/role `authenticated`, phone confirmed, `''` in the token columns, a `phone` identity). The first provisioned person's first sign-in is the real check, and it belongs to the session that provisions the first person (P1.3).

## Apply — Emil only (Law 5, Law 8)

The migration is a committed file. Nothing here was applied.

**Either** the Law 8 path, from a terminal with the Supabase CLI linked to `qjwbtlnwnjjuvrwblkzx` and the database password:

```bash
supabase migration up --linked
```

(`supabase migration list --linked` first must show `20260830120000` applied on both sides and `20260909120000` local-only. If `20260830120000` shows as local-only because it was applied through the Management API on 2026-08-31 without its history row, run `supabase migration repair --status applied 20260830120000` first — re-running the foundation file would fail its own "every existing row is (member, active)" assertion now that one account is admin, and roll back, so the history must be right before `up`.)

**Or** the path that applied the last migration, needing only a personal access token:

```bash
python3 scripts/apply-provision-user-via-api.py
```

Both run the file's PRE-CHECK and POST-CHECK. Expected post-check: `security_definer t`, `search_path {search_path=public, pg_temp}`, anon `f`, authenticated `f`, service_role `t`, zero control accounts, zero control identities, zero `provision_user` audit rows, and settings/capability counts unchanged from the pre-check. **The migration creates no account.**

## What this does NOT do, deliberately

- Does not create an admin, ever. Role changes are a separate audited verb.
- Does not record SMS consent. An admin cannot consent for someone; `sms_consent_at` is the person's own act (finding 13). **Flag for P1.x:** `findOrCreateByPhone` only writes `sms_consent_at` when it CREATES the row, so a provisioned person's first text will find the row and record no consent. The SMS gate needs its own consent step for provisioned accounts.
- Does not touch the admin panel, the invite flow or any route. The verb exists; wiring it is Session D's panel work.
- Does not backfill Emil's July row. That is P1.3, through this same function.
