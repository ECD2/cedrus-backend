# Scope audit — every read, every write, every person the environment names

**2026-09-09 · branch `docs/scope-audit-2026-09-09` · against `main` at `39c6d22` (programs foundation and the provisioning RPC merged) · one file written, nothing else touched**

Parts of CEDRUS.md read: II.0–II.7 in full, III.1. Also `docs/SINGLETON_AUDIT_2026-08-30.md` (the method), `docs/BUILD_PLAN.md`, `docs/PROGRAMS_2026-09-09.md`, `docs/PROVISION_USER_2026-09-09.md`, the three migrations, `SESSION_NOTES_2026-08-18.md` §2–3 (the dead-guard audit and its corollary), and the 2026-08-18 list of guards that were checked and left alone.

**What this is.** Four passes over the source at `39c6d22`, each produced by grepping and then reading every hit, never from memory. Every row carries a `file:line` that was read. Severities are argued in the row, not assumed. **No fix is applied; every "fix" column is a recommendation.** Section 5 says what could not be settled from source alone.

**The charter proofs A1–A10.** The prompt names them as reading. They are cited in `docs/BUILD_PLAN.md` (P1.5, T7.1, A3.2, C4.2, F0.5, F0.7) but **defined nowhere in this repository at `39c6d22`**, nor in `~/Downloads/CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md` or `CEDRUS_ROADMAP_AND_SESSION_A_2026-08-30.md` (grepped read-only). Where a finding below maps to a proof, the mapping uses BUILD_PLAN's one-line glosses (A2 cross-user writes refused, A5 anon reads nothing, A9 owner resolution refuses rather than guessing, A10 no identifier crosses into another person's log trace) and is marked as inferred.

---

## Method — the commands, so the counts are reproducible

```sh
# every builder call site (reads and writes), comment lines and Buffer/Array.from excluded → 180
grep -rn "\.from(\|\.rpc(" src --include='*.js' | grep -v "Buffer\.from\|Array\.from" | grep -vE '^[^:]+:[0-9]+:\s*//' | wc -l
# the II.5 denominator / numerator / bound, re-run at 39c6d22 → 114 / 68 / 46 (unchanged since 2026-08-26)
grep -rn 'supabase\.from(' src --include='*.js' | wc -l
grep -rn 'supabase\.from(' src --include='*.js' | grep -vE '\{[^}]*\berror\b' | wc -l
grep -rn 'supabase\.from(' src --include='*.js' | grep -cE '\{[^}]*\berror\b'
# every scoping wrapper and cross-user verb
grep -rn "forUser\|cosSelectAcrossAllUsers\|cosInsertTodayBrief\|\.rpc(" src --include='*.js'
# every environment read, direct and through an injected env
grep -rn "process\.env" src --include='*.js'
grep -rn -E "\benv\.[A-Z][A-Z0-9_]+|\benv\[['\"][A-Z]" src --include='*.js' | grep -v "process\.env\."
grep -rn -E "envInt\(|envVar\(|fromEnv\(" src --include='*.js'
# who reads the per-person table
grep -rn "user_settings" src --include='*.js'
# nothing-happened assertions in test/
grep -rn -E "length === 0|=== 0,|nothing (was )?(sent|written|inserted|happened)|not (called|sent|written)" test/*.js test/*.mjs
# does any battery stage execute the real CoS filter line?
grep -rn "mock.module\|@supabase/supabase-js\|forUser(\|gatherCosInput" test/
```

Two facts the method turned up before the audit proper: **the three II.5 counts reproduce exactly (114 / 68 / 46)**, so flag 14 has not moved since 2026-08-26; and **`user_settings` has exactly one reader in `src/`**, `src/services/programs/today.js:35`, which reads `cos_user_id` for the program block and nothing else. Every other hit for that table name is inside a message string or a comment.

---

## 0. Summary

| Severity | Count | Where they cluster |
|---|---|---|
| **High** | 5 | Four per-person values still live in the environment (`COS_USER_ID`, `COS_BRIEF_TO`, `COS_BRIEF_USAGE_USER_ID`, `ALLOWED_PHONES`), and the one line that scopes every CoS read is executed by no battery stage. |
| **Medium** | 14 | Unscoped writes on `facts`; a `limit(1)` owner lookup with no uniqueness behind it; suspension and capabilities not consulted on any outbound job; canon and source disagree on which cross-user read is "the one"; five more env-named per-person values; two isolation-suite controls that cannot discriminate; the programs horizon gap. |
| **Low** | 11 | Id-only writes after scoped reads; two unscoped lookups; one dry-run-masked assertion; a tracker with no positive control; harness details. |
| **Info** | 9 | By-design fan-outs, identity lookups, global tables, and things recorded so nobody re-derives them. |
| **Total** | **39** | |

The headline, in one sentence each:

1. **Isolation on the Cedrus database is a convention, and a well-kept one:** 109 of 180 call sites carry the scope on the query itself; 33 more are id-keyed follow-ups to a scoped read in the same function; 33 are identity lookups, job fan-outs, global tables and the admin list, all unscoped by design. That leaves three unscoped reads of a per-person table with no design reason (`memory.js:81`, `cards.js:122`, `briefEmail.js:72`), one optional scope (`cards.js:149`), and one ambiguous lookup (`today.js:35`).
2. **Isolation on the CoS database is structural (`forUser`) but unfalsified:** no stage of the battery executes `src/services/cos/client.js:262`, the line that applies `.eq('user_id', …)`. Bundle 41's "cross-user read returns nothing" drives a hand-built query, not the real one.
3. **The environment still names the person.** The brief's owner, recipient and spend account, and the SMS allowlist in both directions, are env values. `user_settings` has a column for each and none of those columns has a reader.
4. **The programs foundation is scoped correctly and has no notion of "after".** Nothing notices a day past a training plan's end or a routine's 28-day horizon, and a routine cannot be re-materialised without changing its source bytes.

---

## 1. Every Supabase read and write

### 1.1 How each call site was classified

| Class | Meaning |
|---|---|
| **S** | Scoped: `.eq('user_id', …)` on the query, an insert/upsert whose row carries `user_id`, a per-user key (`ledgerKey`), a `forUser()` read, or an RPC whose owner argument comes from the caller's token/argument. |
| **ID** | Keyed by a row id that was itself obtained from a scoped read in the same function (transitively scoped; the write predicate does not repeat `user_id`). |
| **IDENT** | Identity resolution by a global unique key (phone, `auth_user_id` from the token, Twilio `provider_message_id`, token hash). Unscoped by design: the query *is* the lookup that produces the user. |
| **FAN** | A scheduled job's fan-out over all users; each returned row is then processed under its own `user_id`. Unscoped by design. |
| **GLOBAL** | A table or view with no per-person rows (`system_flags` kill switch, budget views, `broadcasts`). |
| **ADMIN** | An admin-only read across accounts (the panel's user list). |
| **CU** | The named cross-user verb, `cosSelectAcrossAllUsers`. |
| **X** | Unscoped on a per-person table with no design justification. **A finding.** |

Per the brief, every non-**S** read is listed as a finding below with a severity; **IDENT / FAN / GLOBAL / ADMIN** rows are Info, because refusing them would refuse the job.

### 1.2 The ledger — 180 call sites, by file

Line numbers are the line carrying `.from(` / `.rpc(`. "S" rows are grouped; every other class is on its own line.

| File | Lines | Table(s) | Verb | Class |
|---|---|---|---|---|
| `src/jobs/reminders.js` | 47 | reminders | select (`status=pending`, due) | FAN |
| | 66, 75 | reminders | update by `id` (66 is a CAS on `status`) | ID |
| | 86 | app_users | select by `id` (`reminder.user_id`) | ID |
| `src/jobs/cardSender.js` | 43 | opportunity_cards | select (`status=queued`) | FAN |
| | 68 | app_users | select by `id` | ID |
| `src/jobs/cardFollowup.js` | 24 | opportunity_cards | select (`status=accepted`, due) | FAN |
| | 44 | app_users | select by `id` | ID |
| | 71 | people | select `id` + `user_id` | S |
| `src/jobs/trialDowngrade.js` | 24 | app_users | select (`plan=trialing`, expired) | FAN |
| | 40 | app_users | update by `id` | ID |
| `src/jobs/sweeps/clarificationExpiry.js` | 14 | app_users | select by `id` | ID |
| `src/jobs/briefEmail.js` | 63, 83, 120 | briefs, brief_action_tokens, brief_deliveries | select/update/insert with `user_id` | S |
| | 78 | brief_action_tokens | insert (row built by `tokens.js` from a `userId` argument) | S |
| | 68, 114 | brief_items, brief_deliveries | select by `brief_id` | ID |
| | 72 | people | select `.in('id', ids)` — **no `user_id`** | **X** → F1-07 |
| | 92 | brief_action_tokens | select by `token_hash` | IDENT |
| | 97, 203, 249, 263, 275 | brief_action_tokens, brief_deliveries | update by `id` | ID |
| | 158 | app_users | select (`brief_email_status=subscribed`) | FAN |
| | 181 | app_users | select by `id` (fresh consent re-read) | ID |
| `src/routes/api/reminders.js` | 133, 149 | reminders, messages | select with `user_id` | S |
| `src/routes/admin.js` | 58 | app_users | select by `phone` | IDENT |
| | 64, 144, 150, 151 | (table), people | count/delete/update with `user_id` | S |
| | 157 | app_users | update by `id` | ID |
| `src/routes/api/auth.js` | 100 | app_users | select by `auth_user_id` (from the token) | IDENT |
| | 169 | user_capabilities | select with `user_id` | S |
| `src/services/budget.js` | 55, 64 | v_daily_token_usage, v_daily_sms_usage | select (whole UTC day) | GLOBAL |
| | 90, 118 | system_flags | upsert/select by `key` (kill switch) | GLOBAL |
| `src/services/clarifications.js` | 183, 199, 208, 215, 223, 231 | pending_clarifications | all with `user_id` | S |
| | 309 | pending_clarifications | select expired (`sweepExpired`) | FAN |
| `src/services/safetyFlags.js` | 50, 83 | app_users | update/select by `id` | ID |
| `src/services/briefs.js` | 5, 18, 27 | briefs, brief_items | upsert/insert/select with `user_id` | S |
| | 14, 33 | brief_items, briefs | delete/update by `brief_id` / `id` only | ID → F1-08 |
| `src/services/onboardingAnswers.js` | 57 | people | select with `user_id` | S |
| `src/services/cards.js` | 79, 89, 131, 162, 177, 220, 224 | suppressed_pairings, opportunity_cards, people | with `user_id` | S |
| | 115 | app_users | select by `id` | ID |
| | 122 | people | select by `id`, ownership checked in JS at :124 | **X** → F1-06 |
| | 149 | opportunity_cards | select; `user_id` filter **only if `userId` was passed** | optional → F1-09 |
| | 206 | opportunity_cards | update by `id` + `status` (CAS) | ID |
| `src/services/users.js` | 24 | app_users | select by `phone` | IDENT |
| | 31 | app_users | insert (creates the user) | IDENT |
| | 40, 44, 50, 55, 56, 69, 70 | app_users | update/select by `id` | ID |
| | 62, 78 | app_users | select all `opted_out=false` (`listActiveForBrief`, `listNudgeable`) | FAN → F1-03/F1-04 |
| `src/services/prioritySwap.js` | 67 | rpc `set_priority_people` | `target_user_id` from the token | S |
| | 91 | people | select with `user_id` | S |
| `src/services/goals.js` | 181, 201, 221, 290, 331, 350, 372, 377 | people, user_goals | all with `user_id` | S |
| `src/services/consent.js` | 16 | consent_events | insert with `user_id` | S |
| `src/services/chatImport.js` | 355, 437, 553, 558, 601, 628 | facts, agent_runs, messages | all with `user_id` | S |
| `src/services/memory.js` | 102, 141, 157, 168, 205, 215 | facts, saved_items, reminders, user_goals | with `user_id` | S |
| | 81 | facts | update by `person_id` + `fact_key` + `is_current` — **no `user_id`** | **X** → F1-01 |
| `src/services/capture.js` | 231 | messages | insert with `user_id` | S |
| `src/services/relationships.js` | 33, 42, 50, 61, 81, 91, 107 | message_people, contact_events, pending_prompts, user_goals, nudges | with `user_id` | S |
| | 66, 75, 100 | pending_prompts, nudges | update by `id` only | ID → F1-08 |
| `src/services/interests.js` | 117, 144, 186, 206, 260, 288, 314, 319 | interests | all with `user_id` | S |
| `src/services/usage.js` | 40, 46, 55 | v_message_quota, v_weekly_nudge_usage, agent_runs | with `user_id` | S |
| `src/services/people.js` | 34, 47, 53, 59, 89, 100, 136, 143, 152, 162, 178, 186, 201, 209, 215 | people, v_agent_person_context | all with `user_id` (`requireUser` guard on writes) | S |
| `src/services/messages.js` | 8, 20, 30, 74, 83 | messages, pending_prompts | with `user_id` | S |
| | 16, 52 | messages | select/update by Twilio `provider_message_id` | IDENT |
| `src/services/insights.js` | 341, 351 | reminders, pending_prompts | with `user_id` | S |
| `src/services/provisioning.js` | 66 | rpc `provision_user` | `p_actor_user_id` from the caller — **no caller exists in `src/` or `scripts/`** | S → F1-13 |
| `src/services/broadcasts.js` | 71, 80, 99, 109, 127, 157, 185, 199 | broadcasts | admin draft/approve/list/feed | GLOBAL |
| | 90 | app_users | select all `opted_out=false` (+`member_status`) — recipients | FAN → F1-03/F1-04 |
| `src/services/webOnboarding.js` | 82 | app_users | select by `phone` | IDENT |
| | 102 | app_users | insert (creates the user) | IDENT |
| `src/services/restore.js` | 36, 65 | people | with `user_id` | S |
| `src/services/cos/ledger.js` | 164, 213, 261, 314, 349 | system_flags | by `key` = `cos_brief_send:<user_id>:<date>` | S (per-user key) |
| `src/services/adminOps.js` | 59 | app_users | select by `id` | ID |
| | 65, 125, 152, 162, 195 | (table), messages, reminders, subscriptions | with `user_id` | S |
| | 80, 82 | app_users | count all / list page (the admin panel's user list) | ADMIN → F1-05 |
| `src/services/cos/reader.js` | 186, 195, 204, 213, 222, 257, 300, 315 | 8 CoS tables via `forUser(userId).select` | select | S (CoS) |
| `src/services/cos/client.js` | 259–262 | any of `READABLE_TABLES` | `.eq('user_id', scope.userId)` unless the scope is the `ALL_USERS` sentinel | S / CU |
| | 350 | today_briefs | insert; `row.user_id` required at :340 | S (CoS) |
| `src/services/cos/writer.js` | 134 | today_briefs via `cosSelectAcrossAllUsers` | newest row, any user (owner derivation) | CU → F1-05 |
| `src/services/programs/publish.js` | 59 | rpc `publish_program_revision` | `p_user_id` from the caller (`--user-id` today) | S |
| `src/services/programs/today.js` | 35 | user_settings | select `user_id` by `cos_user_id`, `.limit(1)` | lookup → F1-02 |
| | 63 | rpc `todays_program_items` | `p_user_id` required at :60 | S |

**Tally, counting every line once (the 180 is the grep's):** S 109 · ID 33 · IDENT 9 · FAN 9 · GLOBAL 12 · ADMIN 2 · CU 1 · optional scope 1 · lookup 1 · X 3 = 180. Of the 71 non-S rows, 66 are by design or transitively scoped (ID, IDENT, FAN, GLOBAL, ADMIN, CU) and five are findings in their own right (F1-01, F1-02, F1-06, F1-07, F1-09).

### 1.3 The two databases and the cross-user verbs

- **Cedrus (`qjwbtlnwnjjuvrwblkzx`)** is reached with the service role from `src/lib/supabase.js:5`. RLS is not the boundary here; the `.eq('user_id')` convention is, and the ledger above is the audit of that convention.
- **CoS (`kpzyzjhfvjfvxowhusir`)** is reached only through `src/services/cos/client.js`. The boundary is `forUser()` (`client.js:289–301`), the filter is applied at `client.js:262` before the caller's builder, and the export surface is pinned by Bundle 41.
- **Canon says one legitimate cross-user read; the source says two, and names a third.** CEDRUS.md II.5 (the "Service role bypasses RLS" bullet) says *"The one legitimate cross-user read goes through `cosSelectAcrossAllUsers`."* `client.js:55–57` says that one read is *"the admin panel's user list"*. The admin panel's user list is `adminOps.js:80–82`, on the **Cedrus** database, through the plain service-role client — it cannot go through the CoS verb and does not. The **only** caller of `cosSelectAcrossAllUsers` in `src/` is `writer.js:134`, the bootstrap owner derivation, which `writer.js:107–111` itself calls *"the second legitimate cross-user read in the system."* So: the verb has one caller, the canon counts one, the client header names a caller that does not exist, and the writer counts two. Recorded as F1-05 (Law 12).

### 1.4 Findings

| # | file:line | What | Severity, and why | Recommended fix (not applied) |
|---|---|---|---|---|
| **F1-01** | `src/services/memory.js:81–83` | The supersession `UPDATE facts SET is_current=false … WHERE person_id = … AND fact_key IN … AND is_current` carries no `user_id`. The insert that follows at :102 does. | **Medium.** `person_id` normally comes from entity resolution scoped to the user, so today it is transitively safe. But it is the one write in the codebase that would retire *another person's* current facts if a `person_id` were ever mis-resolved (chat import, a future write API), and it would do so silently — the branch already fails open by design (flag 20). Inferred proof A2 (cross-user writes refused) is not met by this line. | Add `.eq('user_id', userId)` to the retirement predicate; a test that seeds two users' facts for the same `fact_key` and proves only the caller's are retired. |
| **F1-02** | `src/services/programs/today.js:35` | `user_settings` is read by `cos_user_id` with `.limit(1)`. The migration (`20260830120000_multiuser_foundation.sql`, the `user_settings` block) declares **no UNIQUE on `cos_user_id`**. | **Medium.** Two accounts carrying the same CoS id (a copy-paste at provisioning, a shared CoS project) resolve to whichever row PostgREST returns first, and the program block for one person is composed from the other's items. `limit(1)` turns an ambiguity into a confident answer — the shape of singleton finding 6. Inferred proof A9 (refuse rather than guess). Latent today: the table has 0 rows. | A partial unique index `user_settings(cos_user_id) WHERE cos_user_id IS NOT NULL` in the next migration; in code, drop `.limit(1)` and treat `data.length > 1` as unresolved, announced. Bundle 43's `settingsDb` fake should carry the two-row case (see T-08). |
| **F1-03** | `src/jobs/reminders.js:86–91`, `src/jobs/cardSender.js:68–75`, `src/jobs/cardFollowup.js:44–51`, `src/jobs/briefEmail.js:181–184`, `src/services/users.js:62–65, 78–81`, `src/services/broadcasts.js:90–94` | Every outbound job reads the person's `app_users` row and checks `opted_out` only. **None reads `account_status`.** | **Medium.** `account_status='suspended'` is enforced in exactly one place, `routes/api/auth.js` (`isAccountActive`), so suspension removes the API and nothing else: a suspended person still receives reminders, cards, nudges, the weekly email and broadcasts. BUILD_PLAN O5.1's done-when ("revoking access removes it from interface, brief and SMS at once") is not true at this commit. | One helper (`isDeliverable(user)` = `!opted_out && account_status === 'active'`) consulted at each of the six sites, with a suite that suspends a user and proves each job skips them alongside an active control that is sent. |
| **F1-04** | `src/services/broadcasts.js:90`, `src/services/users.js:62, 78` | Recipient scans select every `opted_out=false` account. They do not consult `user_capabilities` (`receive_sms`, `receive_brief`) or `sms_consent_at`. The only per-person gate after the scan is `config.allowedPhones` (`users.js:16`, `broadcasts.js:141`). | **Medium.** The capability table exists so that "may this person be texted" is a row; at this commit it is read only by `requireCapability` on the API. On the outbound path the answer still comes from the env allowlist (E-04). A provisioned account with `receive_sms` ungranted is texted the moment its number is in `ALLOWED_PHONES`. | Filter the scans by a granted `receive_sms` / `receive_brief` row (a join or a second query per user), keep the env allowlist as an *additional* arming switch until P1.4 retires it. |
| **F1-05** | `src/services/cos/client.js:55–57`, `src/services/cos/writer.js:107–111, 134`, `src/services/adminOps.js:80–82`, CEDRUS.md II.5 | Canon, the client header and the writer disagree about which cross-user reads exist (§1.3). | **Medium.** Not a leak: the derive path is unreachable once a caller names a user (`writer.js:116–122`) or `COS_USER_ID` is set (:123–124), and II.5 records the variable as set on Railway. It is a canon fault: a session obeying II.5's "one" would treat the writer's read as unauthorised, and a session obeying `client.js:55` would go looking for an admin-list caller that is on the other database. Law 12. | Correct II.5 and `client.js:55` to name the one real caller (`writer.js:134`, bootstrap derivation) and to state that the admin user list is a Cedrus-side read with its own name. Consider giving `adminOps.listUsers` an announcing verb of the same shape (`selectAllAccounts({ reason })`). |
| **F1-06** | `src/services/cards.js:122–124` | `people` read by `id` alone; ownership checked afterwards in JS. | **Low.** Admin-only path (`queueCard`), and the JS check refuses correctly. But the response distinguishes "no such person" from "not their person" (`:124` → 422 `not_their_person`), which reveals the existence of another user's `person_id` to the admin caller, and it is the one `people` read in the file without `.eq('user_id')` — the shape `restore.js:43–45` explicitly avoids. | Put `.eq('user_id', userId)` on the query and answer one 422 for both cases. |
| **F1-07** | `src/jobs/briefEmail.js:72` | `people` names read by `.in('id', ids)` with no `user_id`; the ids come from the user's own `brief_items`. | **Low.** Transitively scoped; a mis-linked `brief_items.person_id` would render another user's person's name into an email. | Thread `userId` into `listPeopleNames` and add `.eq('user_id', userId)`. |
| **F1-08** | `src/services/briefs.js:14, 33`; `src/services/relationships.js:66, 75, 100`; `src/jobs/briefEmail.js:68, 97, 114, 203, 249, 263, 275`; `src/jobs/reminders.js:75` | Writes and reads keyed by a row id obtained from a scoped read in the same function, with the scope not repeated on the write. | **Low.** Correct today by construction. Listed because the convention "the write repeats `user_id`" is what `people.js` and `goals.js` do everywhere, and the exceptions are where a refactor that passes an id across a function boundary would lose the scope without a test noticing. | Repeat `.eq('user_id', …)` on each write where the id is in hand; no behaviour change. |
| **F1-09** | `src/services/cards.js:148–151` | `listCards({ userId })` filters by user **only if `userId` is passed**; omitted, it returns every account's cards. | **Low.** Admin queue view, intentionally all-accounts. It is the `cosSelect(table, build)` shape singleton finding 4 removed from the CoS client: a scope that a caller can forget. | Require `userId`, and add a separately-named `listAllCards()` for the admin view so the all-accounts read is an explicit verb. |
| **F1-10** | `reminders.js:47`, `cardSender.js:43`, `cardFollowup.js:24`, `trialDowngrade.js:24`, `clarifications.js:309`, `briefEmail.js:158`, `users.js:62, 78`, `broadcasts.js:90` | Job fan-outs over all users. | **Info.** By design; each row is then processed under its own `user_id`. Recorded so they are not re-flagged; F1-03/F1-04 are the real gaps on these paths. | — |
| **F1-11** | `users.js:24, 31`, `webOnboarding.js:82, 102`, `routes/admin.js:58`, `routes/api/auth.js:100`, `messages.js:16, 52`, `briefEmail.js:92` | Identity lookups by phone, token, provider id, token hash. | **Info.** By design; each *produces* the user. `auth.js:100` is the proof that identity comes from the token (Bundle 41 §8). | — |
| **F1-12** | `budget.js:55, 64, 90, 118`, `broadcasts.js:71–199`, `ledger.js:164–349` | Global tables and views; the send ledger's rows are per-user by key. | **Info.** | — |
| **F1-13** | `src/services/provisioning.js:66` | `provisionUser()` has **no caller** in `src/` or `scripts/` at this commit. | **Info.** The RPC is applied in prod (II.5, corrected 2026-09-09) and the JS wrapper is proven by Bundle 42, but nothing in the running service can reach it; the admin route is O5.1. Recorded so nobody reads "provisioning path exists and is pushed" as "provisioning is reachable". | — |
| **F1-14** | II.5, "Supabase client behaviour" | The 114 / 68 / 46 counts re-run identically at `39c6d22`. | **Info.** Flag 14's remainder is unchanged by the two September merges; the programs and provisioning code bind `error` at every site (`publish.js:59`, `today.js:35, 63`, `provisioning.js:66`). | — |

---

## 2. Every `process.env` read that names a person, an address, or a per-person setting

**The independent check, stated first.** `user_settings` was created on 2026-08-30 with a column for each of the four env values the singleton audit named (`brief_email` ← `COS_BRIEF_TO`, `usage_user_id` ← `COS_BRIEF_USAGE_USER_ID`, `cos_user_id` ← `COS_USER_ID`, `brief_hour_utc` ← the cron hour) plus `brief_enabled` and `timezone`. At `39c6d22`:

| Column | Readers in `src/` | Env value still read instead |
|---|---|---|
| `brief_email` | **none** | `COS_BRIEF_TO` (`resendTransport.js:60`) |
| `brief_enabled` | **none** | — (no per-person arming exists; `COS_BRIEF_LIVE` is global) |
| `brief_hour_utc` | **none** | the constant `'0 11 * * *'` (`scheduler.js:52`) |
| `cos_user_id` | one: `programs/today.js:35`, **for the program block only** — the brief's own owner never consults it | `COS_USER_ID` (`writer.js:123`, via `cosDailyBrief.js:200`) |
| `usage_user_id` | **none** | `COS_BRIEF_USAGE_USER_ID` (`cosDailyBrief.js:543`; second meaning at `today.js:51`) |
| `timezone` | **none** | `DEFAULT_TIMEZONE` for new rows (`config.js:37`); the jobs read `app_users.timezone` |

So the table is live, the schema is right, and the code that reads it is the still-unwritten B2.1 / P1.4. The bullet in II.5 that says *"an environment variable is currently the thing that names the person receiving the brief"* is exact at this commit.

### 2.1 The ledger

Every read was found by the commands in the Method section, including reads through an injected `env` object (which a `process.env` grep alone misses — nine of the rows below are that shape).

| # | file:line | Variable | Names… | Consumers | Column that exists for it | Severity, and why | Recommended fix |
|---|---|---|---|---|---|---|---|
| **E-01** | `src/services/cos/writer.js:123` (read), `src/jobs/cosDailyBrief.js:200` (the only call, `resolveOwner({ env })` — no `cosUserId` is ever passed) | `COS_USER_ID` | **a person** (their CoS `auth.users` id) | The owner of every CoS read (`:265`), the ledger slot (`:239, :455`), the writeback row (`:415, :498`), and the program-owner lookup (`:302`) | `user_settings.cos_user_id` — **unread for this purpose** | **High.** It is the root of scope for the whole brief: with the variable set, one person's records are gathered and one person is written to, whatever `user_settings` says. With it unset the derive path (`writer.js:126–163`) picks whoever wrote the newest `today_briefs` row. II.5 records it set on Railway (2026-09-04). This is P1.4 by name. | B2.1/B2.2: iterate `user_settings WHERE brief_enabled`, pass `cosUserId`/`cosUserSource:'settings'` per row; then P1.4 deletes the env read and the derive path. |
| **E-02** | `src/services/cos/resendTransport.js:60, 66, 97–100, 116–118`; presence only at `src/config.js:114, 172` | `COS_BRIEF_TO` | **an address** (the one recipient) | `ResendTransport.send()` — the job at `cosDailyBrief.js:467` never passes `to`, so `cfg.to` is always used | `user_settings.brief_email` — **unread** (`app_users.brief_email` also exists; B2.4 collision) | **High.** One deploy, one inbox. A second person's brief goes to the first person's address or needs a redeploy (singleton finding 7, still open). | B2.1: `transport.send({ to: settings.brief_email })` per person; keep the env value only as the *absence* check that refuses to construct (its safety role), never as a recipient. |
| **E-03** | `src/jobs/cosDailyBrief.js:543–552` | `COS_BRIEF_USAGE_USER_ID` | **a person** (their `app_users` id) | Every model call's spend row (`usage.logAgentRun`) | `user_settings.usage_user_id` — **unread** | **High.** Every person's tokens are booked to one account (singleton finding 8). II.5 from 2026-09-04 shows `agent_runs` rows for the brief, so the variable is now set and the attribution is live. Not validated at boot (`config.js` never mentions it). | B2.1: read `usage_user_id` from the settings row being iterated; announce `cos.usage.unrecorded` per person when null. |
| **E-04** | `src/config.js:65` (parsed at boot); read via `config.allowedPhones` at `src/routes/sms.js:16, 57`, `src/lib/twilio.js:64–67`, `src/services/users.js:16`, `src/services/broadcasts.js:141`; named in logs at `cardSender.js:138`, `cardFollowup.js:95` | `ALLOWED_PHONES` | **people** (every phone the system will talk to, both directions) | The inbound gate (STAGE A2), the outbound choke point, both brief/nudge loaders, broadcast recipients | `user_capabilities.receive_sms` + `app_users.sms_consent_at` — **unread by any allowlist** | **High.** The rule in II.5 is that env holds secrets and global arming switches; this is a list of people, parsed once at boot, and the fifth person is a deploy. It also conflates the technical step with the compliance step (singleton finding 13; II.5's "SMS path records consent only when it creates the row"). | The allowlist becomes a row predicate: `account_status='active' AND receive_sms granted AND sms_consent_at IS NOT NULL`, read at each of the two choke points; `ALLOWED_PHONES` stays as an *extra* global gate (unset = disarmed, announced) until T7.3. |
| **E-05** | `src/services/programs/today.js:51–52` | `COS_BRIEF_USAGE_USER_ID` (second meaning) | **a person** — reused here as "the program owner" | The today's-program block when `user_settings.cos_user_id` finds nothing | `user_settings.cos_user_id` → `user_id` (the rows-first path at :35 is correct) | **Medium.** One variable now carries two meanings: the spend account and the program owner. They are the same person only while there is one person. The fallback is documented as temporary (until P1.3), but it is a second consumer of an env-named identity added on 2026-09-09, i.e. after the rule. | After P1.3 backfills the settings row, delete the fallback and make `source:'unresolved'` the only alternative (already announced at `cosDailyBrief.js:304–310`). |
| **E-06** | `src/jobs/scheduler.js:52` (`spec: '0 11 * * *'`) | the brief hour | **a per-person setting**, as a code constant | The one CoS brief tick | `user_settings.brief_hour_utc` — **unread** | **Medium.** Singleton finding 10, still open. The comment at :48–51 accepts DST drift "for a single-owner job". `briefEmail.js:135–170` already shows the correct shape (hourly tick, per-user hour and timezone selection). | B2.5: make the CoS brief hourly and select `WHERE brief_hour_utc = <this hour>`; copy `getUsersDueForEmail`. |
| **E-07** | `src/config.js:57` (parsed at boot); `src/routes/admin.js:126`, `src/services/adminOps.js:291–297`, `src/routes/adminPanel.js:141–150` (the 501 that tells the operator to edit the variable and redeploy) | `TESTER_PHONES` | **people** (who may be reset) | The reset-user tool's allowlist and the panel's read-only view | none for "tester"; `app_users.role` (`admin`) is the nearest, and the panel does not read it | **Medium.** Singleton finding 12, still open, and the panel's own copy says the fifth tester is a deploy. | Replace with a capability or an admin-role check on the *target* (or on the actor via `is_app_admin()`), and delete the 501 route. |
| **E-08** | `src/routes/adminAuth.js:201–211` (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `ADMIN_SESSION_SECRET`, `ADMIN_TOTP_LABEL`, `ADMIN_TOTP_ISSUER`, `ADMIN_SESSION_TTL_HOURS`) | `ADMIN_EMAIL` and the per-admin secrets | **a person** (the one admin, by email) with their credentials in the environment | The panel login | `app_users.role='admin'` exists and has one row (the 2026-08-31 bootstrap); the panel login does not consult it | **Medium.** Two admin systems: the database says who is an admin, the environment says who may log in to the panel, and only the second one is enforced on `/admin`. A second admin is a deploy, and suspending the env-named admin in `app_users` does not log them out. Singleton finding 12's other half. | O5.1: panel auth = Supabase Auth session + `is_app_admin()`; retire `ADMIN_EMAIL` and the password hash. The TOTP secret can remain a per-account column or a secret, but not a per-person env. |
| **E-09** | `src/services/cos/resendTransport.js:51` (`DEFAULT_REPLY_TO = 'emil@cedrus.life'`) and `:62` (`COS_BRIEF_REPLY_TO` overrides it, globally) | reply-to | **a named person's address, hard-coded in source** | Every brief's `reply_to` header (`:130`) | none (`user_settings.brief_email` is the recipient, not the reply-to) | **Medium.** Not an env read; found by the hard-coded-address grep. With a second recipient, replies to their brief go to Emil's inbox. The sibling transport (`brief/transport.js:27`) uses a system address (`help@cedrus.life`) for the same field. | Reply-to = a system address, or the recipient's own `brief_email`; never a person's. Move the constant out of source. |
| **E-10** | `src/config.js:37`; consumers `src/services/users.js:29`, `src/services/webOnboarding.js:92` | `DEFAULT_TIMEZONE` | a per-person setting's **default** for new rows | Only when a phone's area code gives no zone | `app_users.timezone` (row, read by every job) and `user_settings.timezone` (column default `'America/New_York'`) | **Low.** Not a person; a default. But it is a *second* default for the same fact — the env's and the column's can disagree — and `provision_user()` takes `p_timezone` and ignores both. | Delete the env; let the column default (or `provision_user`'s argument) be the only default. |
| **E-11** | `config.js:35–115`, `briefEmail.js:53–55`, `brief/transport.js:34–37, 119–137`, `cosDailyBrief.js:77, 81, 112`, `client.js:101–102`, `resendTransport.js:58–59, 61`, `cors.js:76–79`, `adminOps.js:34`, `contractGuard.js:65`, `logger.js:142`, `webOnboarding.js:54–57`, `chatImport.js:71–76` | `SUPABASE_*`, `OPENAI_*`, `TWILIO_*` (incl. `TWILIO_FROM_NUMBER`, the system's number), `BRIEF_DRY_RUN`, `DAILY_*_BUDGET`, `BRIEF_EMAIL_*`, `COS_SUPABASE_URL`, `COS_SERVICE_ROLE_KEY`, `COS_BRIEF_LIVE`, `COS_BRIEF_DRY_RUN`, `COS_BRIEF_WRITEBACK_ONLY`, `COS_BRIEF_MODEL`, `COS_BRIEF_FROM`, `RESEND_API_KEY`, `CORS_ALLOWED_ORIGINS`, `PUBLIC_BASE_URL`, `ADMIN_KEY`, `ADMIN_PANEL_TOKEN`, `CONTRACTS_VALIDATE`, `NODE_ENV`, `ENABLE_JOBS`, `VALIDATE_TWILIO_SIGNATURE`, `WEB_ONBOARD_*`, `IMPORT_*` | secrets, global arming switches, global knobs, the system's own sending identities | — | — | **Info.** These are the two jobs the rule allows env to keep. `BRIEF_EMAIL_*` is worth one sentence: the weekly email's *recipient* is already a row (`app_users.brief_email`, `briefEmail.js:184, 257`), which is the shape the CoS brief needs. | — |

---

## 3. Dead-guard pass over `test/`

**What was not re-flagged.** The 2026-08-18 audit checked five duplicated guards and left them alone — the outbound SMS allowlist, the CoS send ledger, `ResendTransport`'s double gate, the budget guard's three readers, and `opted_out` — and its corollary ("a test asserting nothing was sent must prove sending was possible") was then applied to the card CAS block. All five were re-read here and each still has a discriminating control (`outbound-allowlist.test.mjs:83/100`, `cos-daily-brief.test.mjs:1074/1091`, `:1539/1568`, `:1366–1376`, `reminders.test.js:18/46`). They are not below. Nor are the 234 zero-count assertions that were traced to a sibling positive control in the same suite; the ones below are the ones where no control could be found or the control cannot discriminate.

| # | file:line | Why it can pass vacuously | Severity, and why | The control that would fix it |
|---|---|---|---|---|
| **T-01** | `src/services/cos/client.js:262` (the filter), `src/services/cos/reader.js:335–372` (`gatherCosInput`) — **no test executes either** | The battery never constructs a CoS client and never drives `runSelect`. Bundle 41 §1 (`multiuser-isolation.test.mjs:112–119, 134–140`) builds the query *by hand* ("exactly what forUser() applies") against its own fake, then asserts that its own filter is first. Bundle 38 injects `gather` everywhere (`cos-daily-brief.test.mjs:182`). The one real `forUser().select()` in the battery (`:1677`) names a non-allowlisted table and is refused at `client.js:249`, before the client. `cos-schema-check.mjs` reads OpenAPI, not rows, and skips without credentials. `mutate-bundle-41.sh` has no mutation on :262. Consequence: deleting `if (scope !== ALL_USERS) query = query.eq('user_id', scope.userId);` leaves every stage green. | **High.** This is the isolation boundary on the service-role path — II.5 calls it *"an unscoped read is not discouraged, it is unexpressible"* — and it is the one line the doctrine's Law 3 has never been applied to. Lesson 19's second meaning (live but unfalsified) and Lesson 20 (the test agrees with itself) in one place. **Not verified by running the mutation** (this session may not modify source); the claim rests on the greps in the Method section. | Fake `@supabase/supabase-js` with `mock.module` (the pattern `outbound-allowlist.test.mjs:46` uses for `twilio`), seed two users' rows, and drive `forUser(ALICE).select('workstreams', …)` and `gatherCosInput({ userId })` through the real `runSelect` under `ARMED_ENV`; assert B's rows are absent alongside A's present. Add the :262 deletion to `mutate-bundle-41.sh` as guard 10 and watch it go red. |
| **T-02** | `test/multiuser-isolation.test.mjs:184–186` | The "CONTROL: the identical call WITH a user id does not throw" runs with `env: {}`. `cosEnv({})` is disarmed, so `runSelect` returns at `client.js:255` before touching a query. The control passes for a reader that is disarmed, not for one that is scoped. | **Medium.** It is the control for §2's eight refusals, and it cannot tell "scoped read works" from "reader short-circuits". Same root as T-01. | Run the control under `ARMED_ENV` with the fake client from T-01. |
| **T-03** | `src/services/cos/writer.js:126–163` (the derive path) — untested | `resolveCosUserId` is tested only with a caller-supplied id or `COS_USER_ID` set (`cos-daily-brief.test.mjs:996–1005`); the four owner-source mutations in `mutate-bundle-38.sh` (the 2026-09-04 block) touch the caller branch only. `cos.owner.derived`, the `reason` string, the per-project cache and the `unresolved` refusal have no assertion. | **Medium.** This is the system's only actual cross-user read (§1.3). Its guard — "unreachable once a caller names a user" — is exactly the kind of early return a refactor removes. Inferred proof A9. | Drive it with the T-01 fake (two `today_briefs` rows, two users), assert `cos.read.cross_user` carries the reason, that a named user never reaches it (mutation: delete `writer.js:116–122`, expect red), and that an empty table resolves `unresolved`. |
| **T-04** | `test/cards-state.test.js:335–339` | "a card already in flight is never selected" asserts `__sentSms.length === 0` after `seedBase()`, and `seedBase → __resetCards` sets `config.briefDryRun = true` (`prelude-cards.js:47`). Under dry-run the sender never pushes to `__sentSms` for *any* card (`:89` proves it: dry-run → zero Twilio calls, one outbound-log row). So the assertion is true whether or not the in-flight card was selected. | **Low.** Same suite, twelve lines above the block that documents this exact trap (`:352–357`) and fixes it for the CAS assertions. The selection filter (`cardSender.js:43 .eq('status','queued')`) is real; the test just cannot see it. | Either `config.briefDryRun = false` before the run, or assert `__outboundLog.length === 0` (dry-run still logs outbound, so an in-flight card that *was* selected would show there), with a control: the same setup with `status:'queued'` produces one row. |
| **T-05** | `test/brief-email-job.test.js:184–185` | "zero app_users writes across every scenario" reads a persistent tracker (`brief-email-stubs.js:19, 36`). No scenario in the file makes the fake record an `app_users` write, so a broken recorder (a renamed table, a changed `st.op`) and a job that never writes produce the same empty array. | **Low.** The strongest guarantee in the file, per its own comment, rests on a recorder that has never been observed to record. | One direct `supabase.from('app_users').update({})…` through the fake inside the suite, assert the tracker grew by one, then splice it out before the final assertion. |
| **T-06** | `test/mutate-bundle-38.sh:683–696`, `mutate-bundle-40.sh:189–199`, `mutate-bundle-41.sh:173–185`, `mutate-bundle-42.sh:191–201`, `mutate-bundle-43.sh:248–256` | The byte-identical restore check runs only after `MISSED == 0`; a run with any missed guard `exit 1`s first. On that path the tree is restored by `mv` and by the EXIT trap, but never checksummed. | **Low.** The restore is almost certainly correct (`mv` of a byte copy), and the trap covers interrupts. But the harness's own header says the checksum is *"the only control that distinguishes restored correctly from restored to something else"*, and it is skipped on exactly the runs a human is most likely to be staring at. | Move the snapshot comparison into the trap (or ahead of the `MISSED` exit) so every exit path byte-checks. |
| **T-07** | `test/mutate-bundle-43.sh:102–115` (`mutate2`) | Only the first edit is verified to have applied (`cmp -s "$f1" "$f1.bak"`); the second edit's pattern can silently miss. Guards 2, 4, 6 and 8 depend on both. | **Low.** In practice the `judge` marker catches it indirectly (a half-applied pair goes red on the *wrong* assertion or stays green, both reported as missed). Listed because the header claims the pair "proves the suite would also catch it", and a missing second edit makes that a different proof. | Snapshot after the first edit and `cmp` again after the second; report "second edit did not apply" by name. |
| **T-08** | `test/programs-foundation.test.mjs:445–451` | `settingsDb` ignores `.limit()` and is only ever seeded with zero or one row per `cos_user_id`, so `today.js:35`'s `limit(1)` behaviour on two matching rows is unexercised (see F1-02). | **Low.** The fake honours `.eq()`, which is the right half; it cannot express the ambiguity the real table permits. | Seed two rows with the same `cos_user_id`; after F1-02's fix assert `source:'unresolved'` and an announcement. |
| **T-09** | `test/cos-schema-check.mjs`, registered in `run-all.sh:158–164` | Without `COS_` credentials the stage announces a skip and exits 0. On this machine (no credentials, II.5) the only stage that can catch a reader/schema mismatch never runs, and the gate's exit code cannot tell. | **Info.** Deliberate and documented (II.5, "announces a skip"). Recorded because the battery summary counts "59 suites, FAIL=0" and this suite is one of the 59 whether it ran or not. | Print a one-line SKIPPED tally at the end of `run-all.sh` beside the exit code, so a report can say "59 suites, 1 skipped". |
| **T-10** | (the 2026-08-18 no-change list) | — | **Info.** Re-checked, not re-flagged; see the paragraph above the table. | — |

---

## 4. The three program tables

### 4.1 Every code path that reads or writes `programs`, `program_revisions`, `program_items`

| Path | file:line | Reads | Writes | Owner scoping |
|---|---|---|---|---|
| The migration's DDL and self-proof | `supabase/migrations/20260909180000_programs_foundation.sql` (CONTROL 1–3 write and unwind inside the transaction) | all three | all three, unwound | n/a (runs as `postgres`) |
| `publish_program_revision()` | migration :293–431 (`:356` creates the program `active`; `:412` sets `end_date = p_end_date`) | programs, program_revisions | programs (insert/update), program_revisions (insert), program_items (insert) | `p_user_id` required (:323); composite owner FKs |
| `todays_program_items()` | migration :459–496 | programs ⋈ program_items | — | `WHERE p.user_id = p_user_id AND p_user_id IS NOT NULL` (:490–491), `status='active'` (:492), local-date match (:494) |
| `publishProgramRevision()` | `src/services/programs/publish.js:59` | — | via the RPC | `userId` required (:27) — the caller supplies it |
| `readTodaysProgram()` | `src/services/programs/today.js:63` | via the RPC | — | `appUserId` required (:60) |
| `resolveProgramOwner()` | `src/services/programs/today.js:35, 51` | `user_settings` (not a program table) | — | see F1-02, E-05 |
| The brief job | `src/jobs/cosDailyBrief.js:302–331, 387` | via `readProgram` | — | owner from `programOwner` |
| The renderer | `src/services/cos/renderer.js:67–73, 136–139` | `brief.todays_program` (lines, not rows) | — | — |
| The load script | `scripts/load-program.mjs` (`--commit` path only; `:64` compiles, publishes via `publish.js`) | — | via the RPC | `--user-id` (a person named on the command line) |
| The apply script | `scripts/apply-programs-via-api.py` | — | DDL | — |
| Bundle 43 | `test/programs-foundation.test.mjs` | all three on PGlite | all three on PGlite | proven with controls |
| The publishable key | *none* — no route reads these tables; the three `SELECT`-own policies have no consumer yet | | | |

There is **no** other reader or writer: `grep -rn -i program src/ scripts/` outside `src/services/programs/` hits only the job, the renderer, the two scripts, and one comment in `routes/api/auth.js:159` ("Programming error"). No code path writes `programs.status` after creation; the vocabulary's `completed`, `paused`, `archived` have no writer.

### 4.2 Does anything notice when today is past the horizon?

**Confirmed: nothing does, and the gap is in five places that each look correct alone.**

| Where | file:line | What it does | What it does not do |
|---|---|---|---|
| The compiler materialises a routine over a horizon | `src/services/programs/compile.js:214–224` (`h` = header `horizon_days`, else `--horizon-days`, else 28) | Produces `h` days of dated items from `start_date` | Records the horizon nowhere durable: `:217` sets `end_date = null`, and `stats.horizon_days` (`:247`) goes only to the dry-run report. The program row has no last-item date. |
| The publish function stores the dates it was given | migration `:412–414` | `end_date = p_end_date` (NULL for a routine) | Never derives `max(scheduled_date)`; never compares anything to `now()`. |
| The today function selects today's items | migration `:490–494` | Filters `status='active'` and `scheduled_date = local today` | Has no branch for "today is after the last scheduled item" or "today is after `end_date`". An active training plan past `2026-11-15` and a routine past `start + 28` both return zero rows, forever. |
| The reader turns zero rows into no block | `src/services/programs/today.js:80–82` | Returns `[]` | Cannot tell why. |
| The job announces "none" | `src/jobs/cosDailyBrief.js:323–330` | Logs `programs.today.read` with `outcome:'none'` and *"no items scheduled today for this owner — no block"* | The same line for five different states: no program, a paused program, a program past its end, a routine past its horizon, and a genuine empty day (which the compiler makes impossible for a training plan, `compile.js:188–194`). The renderer then omits the section (`renderer.js:71, 137`). |

Two consequences worth stating plainly:

- **P-01.** For the two programs decided for day one, the block goes silent 28 days after the routine's `--start` (**2026-10-07** for the documented 2026-09-09 dry run) and after **2026-11-15** (training), and the only signal is the absence of a section in an email. II.2's "absence in a log window" trap, built into the product.
- **P-02.** A routine cannot be re-materialised for the next 28 days without changing the file. `publish_program_revision` hashes `p_source_text` only (migration `:362`), `--start` and `--horizon-days` are not part of the text (`compile.js:208–216`), so the same file with a later `--start` produces the same `source_sha256` and is refused as *already published* (`publish.js:67`, `load-program.mjs` prints `ALREADY PUBLISHED`). The horizon is a property of one publish, not of the program.

| # | file:line | Severity, and why | Recommended fix |
|---|---|---|---|
| **P-01** | migration `:490–494`; `today.js:80–82`; `cosDailyBrief.js:323–330` | **Medium.** Not a leak and not yet live (no program is loaded; the migration is recorded as unapplied). It is the confident-silence shape (Lesson 1, Lesson 7) at the exact point the product's day-one value depends on: the brief's first section. | Have `todays_program_items` (or a sibling function) also return, per active program, `last_scheduled_date` from the current revision; in the job, when `local today > last_scheduled_date`, announce `programs.today.past_horizon` per program (and, for a training plan past `end_date`, `programs.today.ended`), distinct from `none`. Later, a sweep that flips training plans to `completed` after `end_date`. |
| **P-02** | migration `:362` (the hash), `compile.js:208–217`, `publish.js:67` | **Medium.** The idempotency rule is correct and proven; it just makes "extend the routine" require a text edit whose only purpose is to change the hash. The load-script docs (`docs/PROGRAMS_2026-09-09.md`, "Running the same file twice prints ALREADY PUBLISHED") describe this as a feature without naming the routine case. | Either fold `start_date` and `horizon_days` into the routine's stored source (the compiler can write a `start:` / `horizon_days:` header into `source.text` before hashing), or hash `(source_text, start_date, horizon_days)`; then a re-materialisation is a new revision by design. Document which. |
| **P-03** | migration `:356` (the only `status` write) | **Low.** `programs.status` has a five-value vocabulary and one writer, which writes `active`. A training plan is `active` after its race. Cosmetic today; it becomes the "which programs are live" question the moment the interface renders programs (R6.2). | Part of P-01's sweep. |
| **P-04** | (the RLS policies) | **Info.** The three `SELECT`-own policies and the `authenticated` grants have no consumer at this commit; every read is service-role through the two RPCs. Bundle 43 proves them anyway (`:354–375`), which is the right order. Inferred proof A5 (anon reads nothing) is met by the migration's ASSERT 2 and Bundle 43 `:166`. | — |

---

## 5. What could not be determined from source alone

- **Whether any of this is what production is running.** `39c6d22` is local `main`; II.5's last push fact is `6fecb69`. Nothing here was checked against Railway or the database.
- **Which env variables are set on Railway today.** II.5 records `COS_USER_ID`, `COS_BRIEF_LIVE`, `ALLOWED_PHONES` and the budgets as set (2026-08-16 / 2026-09-04), and `COS_BRIEF_USAGE_USER_ID` as *unset* on 2026-08-26 — but the 2026-09-04 observations show `agent_runs` rows for the brief, which the code writes only when that variable is set (`cosDailyBrief.js:543–552`). Present value unknown from here; E-03's severity assumes it is set.
- **Whether the programs migration has been applied since `docs/PROGRAMS_2026-09-09.md` said "not applied"**, and whether `user_settings` still has 0 rows. F1-02 and T-08 are latent while it does.
- **Whether `email_ai_analyses` carries `user_id`** (II.5 marks it unverified; F0.7's scoped run passing suggests yes).
- **The body of `link_or_create_app_user_from_auth`** (II.5; emulated in Bundles 42 and 43).
- **The charter proofs A1–A10** — see the header. Every "inferred proof" tag above is a guess at the gloss, not a reading of the charter.
- **T-01's central claim was not proven by a mutation run.** A mutation edits source, and this session writes one documentation file. The reasoning is the four greps in the Method section; the one-minute check is the mutation itself, in a worktree that may do it.
- **The battery was not run** (no source or test changed; Law 4 is not triggered by a docs commit).

---

## Counts by severity

| Severity | Section 1 | Section 2 | Section 3 | Section 4 | Total |
|---|---|---|---|---|---|
| High | 0 | 4 (E-01–E-04) | 1 (T-01) | 0 | **5** |
| Medium | 5 (F1-01–F1-05) | 5 (E-05–E-09) | 2 (T-02, T-03) | 2 (P-01, P-02) | **14** |
| Low | 4 (F1-06–F1-09) | 1 (E-10) | 5 (T-04–T-08) | 1 (P-03) | **11** |
| Info | 5 (F1-10–F1-14) | 1 (E-11) | 2 (T-09, T-10) | 1 (P-04) | **9** |
| **Total** | 14 | 11 | 10 | 4 | **39** |

Nothing was applied, pushed, or run against a database. The worktree holds this file and nothing else.
