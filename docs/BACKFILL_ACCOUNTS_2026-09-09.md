# Backfill through the provisioning path — normalize_account() and bind_cos_identity() (P1.3)

**2026-09-09 · branch `feat/backfill-accounts-2026-09-09` · BUILD_PLAN P1.3 · pattern: `docs/PROVISION_USER_2026-09-09.md`**

## The problem

`provision_user()` refuses a phone that already has an account, so it cannot run for the two rows that predate it: Emil's July row (`c6cf9fb9-…`) and the suspended ghost. Both have no `user_settings` row and no `user_capabilities` row (prod read 2026-09-09: `user_settings` had zero rows). They need the shape a fresh account gets, from the same code — a hand-written INSERT is exactly what CEDRUS.md II.5 forbids.

## What landed

| File | What it is |
|---|---|
| `supabase/migrations/20260909210000_normalize_account.sql` | **Not applied.** Two new functions and one redefinition, self-proving (four asserts, four controls, all unwound; any failure rolls the file back). `normalize_account(actor, user_id, capabilities)`: settings row created only if absent, grants brought to exactly the given set, one audit row per call — idempotent. `bind_cos_identity(actor, user_id, cos_user_id, usage_user_id)`: the audited hand-off of the two per-person ids from Railway env vars to the row. `provision_user` redefined: identity + account row + its own audit row, then `normalize_account()` for the shape. All three SECURITY DEFINER, `search_path` pinned, `service_role` only. |
| `scripts/apply-normalize-account-via-api.py` | The apply path (Management API + personal access token), same shape as P1.2's: pre-check → apply → history row → post-check. Backfills nothing. |
| `scripts/backfill-accounts-via-api.py` | **Dry run by default.** Pre-check reads every account back and identifies Emil (the one active admin whose id starts `c6cf9fb9`) and the ghost (the one suspended member); STOPS if either is not exactly one row or any other account is un-shaped. Prints the plan. With `--commit` and a typed `yes`: normalize Emil with every name in the vocabulary (read from the check constraint, no copy in the script), normalize the ghost with the EMPTY set, bind Emil's CoS identity from `--cos-user-id` / `--usage-user-id`. Post-check reads every row back and asserts. **Never reads Railway or the env variables** — Bundle 44 pins that and sets trap values in the environment to prove it. |
| `scripts/apply-multiuser-via-api.py` | One additive change: `SUPABASE_MGMT_API_BASE` overrides the endpoint host, so the suite can run the real script's real SQL against a real (PGlite) database. Unset, nothing changes. |
| `test/normalize-account.test.mjs` | **Bundle 44, 64 checks.** Applies all four migration files to PGlite and spawns the real Python script through an in-process fake of the Management API endpoint. |
| `test/mutate-bundle-44.sh` | Law 3 harness: **21 guards proven live, 0 missed**, tree byte-identical after. |
| `test/provision-user.test.mjs`, `test/mutate-bundle-42.sh` | Bundle 42 now applies the P1.3 file too, so it tests the LIVE `provision_user`; a fresh account carries two audit rows (provision_user + normalize_account) and the suite says so. Its harness's vocabulary mutation targets the live body. **41 checks, 8 guards live, 0 missed.** |
| `test/run-all.sh` | Bundle 44 registered after Bundle 43. |

## The design, and what "exactly the given set" means

`normalize_account` brings the granted set to **exactly** the names given: named ones are granted (a row already granted is left untouched, which is what makes a second identical call change nothing); previously granted names not in the set are revoked with `granted = false` and the row **kept** (never deleted — the migration asserts no DELETE against `user_capabilities`). The audit row records `capabilities`, `settings_created` and `revoked`. In production nothing revokes: Emil has no rows and gets all four; the ghost has no rows and gets none.

`bind_cos_identity` refuses: an account with no settings row (`P0002` — normalize first; there is deliberately no INSERT in it, so the settings row keeps one author), a CoS id already bound to another account (`23505` — two Cedrus people bound to one CoS person would be a cross-user read), a NULL id (`22023` — detaching is a different verb), a non-admin actor (`42501`), an unknown account (`23503`). The foundation's column grant already keeps `cos_user_id` / `usage_user_id` unreachable from `authenticated`; the migration now asserts that, alongside the control that `authenticated` may still update `brief_enabled` on its own row.

**A fresh account now has two audit rows**, one per verb that ran: `provision_user` (identity, phone last-4, display name, requested capabilities) and `normalize_account` (the shape). That is why the ledger's done-when says "≥1 audit row".

## Proof

**Bundle 44, `bun test/normalize-account.test.mjs` — 64 checks, exit 0.** Against a real Postgres with the four real migration files applied, starting from prod's state (two accounts, Emil admin/active with his real id, the ghost member/suspended, zero settings, zero capabilities):

- **The script, dry run:** exit 0, identifies both rows, prints the plan; every request it sent was a read (recorded by the fake endpoint); the database did not move. Missing or malformed ids are refused before anything is sent.
- **The script, `--commit`:** exactly three writes in order; Emil has the settings defaults, delivery not armed, all four granted, `cos_user_id` / `usage_user_id` equal to the **command-line** values while the environment carried trap values; the ghost has settings, nothing granted; audit trails as designed; settings 0 → 2, `app_users` unchanged.
- **The diff (the done-when):** Emil's shape (settings defaults, granted set, audited) vs a freshly provisioned account with the same four capabilities: **EMPTY**, with the bound CoS ids shown to be the only unmasked difference. **Control:** two fresh accounts diff EMPTY. **Discriminating control:** an un-shaped July row diffs NON-EMPTY on all three axes; after `normalize_account` it diffs EMPTY. **Guard:** the fresh account HAS a settings row with the defaults and both audit rows — so "both empty" cannot read as "equal". The ghost vs a fresh account with no capabilities: EMPTY; vs the four-capability account: NON-EMPTY.
- **Idempotency:** the second call reports `settings_created false`, `revoked []`; the settings row and every capability row are byte-identical (timestamps included, the bound ids survive); audit exactly +1.
- **The exact set:** a smaller set revokes with rows kept (4 rows, 1 granted); the empty set leaves zero granted, the settings row present; a re-grant restores.
- **Refusals write nothing:** both functions, every code above, plus the closed vocabulary unwinding the settings row it had written (one transaction).
- **The pre-check refuses a world it was not written for:** other un-shaped accounts → STOP, no write; two suspended members → refuses to guess. Control: once they are shaped, a **re-run** with `--commit` succeeds, announces itself as a re-run, changes no settings row.
- **Pins:** DEFINER, pinned `search_path`, VOLATILE, exact argument lists ×3; provision_user's live body calls `normalize_account(p_actor_user_id, v_user_id, v_caps)` and writes no settings/capability row itself; no vocabulary copy; no UPDATE/DELETE on `admin_audit`; execute anon NO / authenticated NO / service_role YES ×3; column grants.

**Mutation run, `sh test/mutate-bundle-44.sh` — 21 guards proven live, 0 missed.** The two the session prompt named, in layers:

| # | Mutation | Went red on |
|---|---|---|
| 1a | `normalize_account` skips the settings insert | the function's own post-condition `normalize_account ASSERT: 0 settings rows` |
| 1b | …and its post-condition is removed | the migration's diff guard `CONTROL 1: a fresh account lacks the expected shape` — "both sides empty" is refused as "equal" |
| 3a | `provision_user` keeps an inline tail with a DIFFERENCE (timezone) instead of calling `normalize_account` | `ASSERT: provision_user does not call normalize_account` |
| 3b | …and that assert is silenced | the migration's diff `CONTROL 1: a backfilled account differs from a fresh one` — **the two paths now diverge, and the diff sees it** |
| 3c | …and the migration's diff is silenced too | the suite's `FAIL backfill diff: Emil's shape …` |
| 4a | an inline tail that is IDENTICAL | `ASSERT: provision_user does not call normalize_account` |
| 4b | …and that assert is silenced | the suite's structural pin `ONE CODE PATH` — no diff can see an identical copy; that is why the pin exists |
| 5 | settings insert unconditional | `duplicate key value violates unique constraint` on the second call |
| 6a/6b | audit row written twice / and its post-condition gone | `normalize_account ASSERT: audit rows went` / `CONTROL 1 … found 1 and 2` |
| 7 | revocation removed | `normalize_account ASSERT: 2 capabilities granted, 0 requested` |
| 8–11 | admin check removed; DEFINER dropped; `search_path` pin dropped; execute granted to `authenticated` | the migration's own CONTROL 3 / ASSERT 1 / ASSERT 1 / ASSERT 2 |
| 12–13 | one-CoS-person check removed; `bind_cos_identity` inserts settings itself | CONTROL 4 / ASSERT 3 |
| 14 | the script's dry-run gate removed | `every request the dry run sent was a READ` |
| 15 | the script reads `COS_USER_ID` from the environment | `Emil: cos_user_id … are the two COMMAND-LINE values` — the trap value landed |
| 16 | the pre-check no longer refuses un-shaped accounts | `--commit STOPS before writing` |
| 17 | the ghost normalised with every capability | the script's **own** post-check: `the ghost has [...] granted, expected nothing` |

Seen while writing the harness: silencing 1b's guard does not reach the suite, because `bind_cos_identity`'s own `P0002` refusal in CONTROL 4 catches the missing settings row a third time. The suite's diff is shown live by 3c.

**Bundle 42 harness: 8 guards, 0 missed.** Guards 2–6 mutate the P1.2 file, which still runs on apply and still refuses to commit a corrupted `provision_user`; the live function's posture is Bundle 44's. Guard 8 now mutates the live body.

**Battery on merged main (Law 4)** — `sh test/run-all.sh` at merge `133c6d9` (branch commit `3f49c34` merged `--no-ff` into local `main` at `39c6d22`): **exit 0, FAIL=0.** Suites run, counted as `^=== … ===$` stage banners: **37**, of which 30 print after the `ALL WS-B SUITES PASSED` banner (that banner is not the gate). Every registered stage ran, Bundle 44 among them, between Bundle 43 and the CoS schema check; `contracts` announced its toolchain mode. Strict `^  PASS` total 2732 = 2668 (the R6.2a report's figure for `39c6d22`) + 64 (Bundle 44), with Bundle 42 still at 41 — reported with its method, not as a baseline. The R6.2a report's "59 suites" used a counting method it did not record; none of `^=== `, `^===|^---` (41) or the PASSED-banner count (66) reproduce it, so the comparable number across sessions is the strict PASS delta, not the suite count.

## What is a fixture, and what is unverified from this machine

- `app_users`, `auth.users`, `auth.identities` and `supabase_migrations.schema_migrations` are fixtures, as in Bundles 42–43. Emil's row is given his real id because the script identifies him by it; the ghost is a suspended, unnamed member created 2026-07-10 (F0.2's result as recorded, not read from prod here).
- The Management API is faked by an in-process HTTP server that executes the script's SQL on PGlite and answers with the endpoint's status (201) and row shape. The real endpoint's transport (curl, Cloudflare) is exercised by the apply scripts that already reached production, not here.
- The ghost's id and its exact state are read by the script's pre-check at run time; the dry run prints them. If prod has anything other than exactly one active admin `c6cf9fb9…` and exactly one suspended member, the script stops and says what it found.
- `COS_BRIEF_USAGE_USER_ID` is the uuid all token spend is booked to (audit finding 8). The script binds it as given; it does not interpret it.

## Apply and backfill — Emil only (Law 5, Law 8)

Nothing here was applied or run against prod. Three steps, each stopping at the first failure, each printing its checks.

**1. Apply the migration** (creates no account, backfills nothing):

```bash
python3 scripts/apply-normalize-account-via-api.py
```

Expected post-check: `definer_pinned_functions 3`, anon `f` / authenticated `f` / service_role `t` for both new functions, `authenticated_can_provision f`, `provision_calls_normalize t`, `provision_writes_shape_itself f`, `authenticated_can_update_cos_user_id f`, zero control rows, `backfill_audit_rows 0`, and settings/capability/audit counts unchanged from the pre-check.

**2. Dry run the backfill** (the two placeholders come from `railway variables` — the script never reads Railway):

```bash
python3 scripts/backfill-accounts-via-api.py --cos-user-id <COS_USER_ID> --usage-user-id <COS_BRIEF_USAGE_USER_ID>
```

Read the rows and the plan. Expected: two accounts, Emil `c6cf9fb9…` admin/active with settings ABSENT, the ghost member/suspended with settings ABSENT, the three calls printed, `DRY RUN — nothing written`.

**3. Write it:**

```bash
python3 scripts/backfill-accounts-via-api.py --cos-user-id <COS_USER_ID> --usage-user-id <COS_BRIEF_USAGE_USER_ID> --commit
```

Expected post-check: Emil settings present, `brief_enabled false`, granted `[receive_brief, receive_sms, run_agents, write_workspace]`, `cos_user_id` / `usage_user_id` = the two arguments, audit `[normalize_account, bind_cos_identity]`; the ghost settings present, granted `[]`, audit `[normalize_account]`; totals settings 0 → 2, `app_users` unchanged.

**One live-behaviour consequence to know before step 3 (Law 6: a row change needs no deploy).** `src/services/programs/today.js` already resolves the today's-program owner rows-first from `user_settings.cos_user_id`. Once Emil's row carries his CoS id, that lookup succeeds for him instead of falling back to `COS_BRIEF_USAGE_USER_ID`. It resolves to the same person, so the brief's behaviour should not change — but it is the first time a row, not a variable, names him, and the next 11:00 UTC run is the check. P1.4 finishes the move for the rest of the brief.

## What this does NOT do, deliberately

- Does not apply, push, or run the backfill. Does not touch `web/`.
- Does not add JavaScript callers for the two new functions. The backfill goes through the script; the admin panel's wiring is later work.
- Does not record SMS consent for the ghost or Emil, promote anyone, or arm delivery.
- Does not remove `COS_USER_ID` / `COS_BRIEF_USAGE_USER_ID` from Railway or make the brief read the row — that is P1.4, after this backfill has run.
