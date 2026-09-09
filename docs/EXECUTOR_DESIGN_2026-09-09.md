# The pinned-verb executor — design for decision

**2026-09-09 · branch `docs/executor-design-2026-09-09` · for the Mac Studio arriving around 15 October · BUILD_PLAN M8.3, M8.4, M8.5, M8.6 · charter proofs E1–E5, D5**

**Status: DESIGN, not code.** This session wrote this file and `docs/INSTALL_RUNBOOK_DRAFT.md` and nothing else. No source, no migration, no test, no CEDRUS.md change. Every table and function named below as "proposed" does not exist yet; every path under `src/executor/` is a proposal. The decisions Emil has to make are numbered in §10, each with a recommendation.

Parts of CEDRUS.md read: Part I §7 (trust law) and §18 (connector doctrine); Part II in full (II.0–II.7); Part III.1. Also read in full: `docs/cedrus-consulting.md`, `docs/BUILD_PLAN.md`, `docs/MIGRATION_PATH.md`, `docs/PROVISION_USER_2026-09-09.md`, `docs/SINGLETON_AUDIT_2026-08-30.md`, the two applied migrations and the unapplied programs migration, the charter (the "Cedrus Multi-User Charter" artifact, v1, 31 August 2026, proof manifest §7) and the build ledger artifact, `~/Downloads/CEDRUS_MULTIUSER_AMENDMENT_2026-08-30.md` §5–7, and `web/V10_PROPOSAL.md` on branch `interface/v10` (KEEP list and the "Workspace and runs" shapes). Source read: `src/services/usage.js`, `src/services/cos/{client,reader,ledger}.js`, `src/services/capture.js`, `src/services/provisioning.js`, `src/routes/api/auth.js`, `src/jobs/{scheduler,cosDailyBrief}.js`, `src/config.js`, `src/lib/{openai,supabase,smsAllowlist,cors}.js`.

---

## 0. The design in one paragraph

A person writes a brief in the Runs surface. The Mac Studio, which only ever connects outward, picks it up, builds a context from that person's own files and that person's own workspace rows, and asks the local 70B model for **one verb and its arguments** as JSON constrained by a schema. The executor checks the verb against a frozen list of eight, checks the arguments against that verb's schema, checks the person's `user_capabilities` rows, and resolves every path inside that person's root on disk. Anything that fails is refused and the refusal is recorded. What passes is **rehearsed** (nothing written, no cursor moved), then turned into a **receipt** naming exactly what will be touched, hashed. The person **approves that hash** from their own session. Only then does the executor perform the one write, record the evidence, and post a digest into the table the morning brief already reads. There is no shell anywhere in the path and no verb that could become one, and the battery proves that by driving a refused verb, not only a permitted one.

This is the charter's rule made concrete: *the model proposes; deterministic code executes; a person approves at the write boundary; the receipt is the evidence.* It is the Runs grammar the interface already has, brief → prerequisites → execution state → approval boundary → evidence → finish condition, with a real provider behind each field.

---

## 1. What exists today that this builds on

Nothing about the executor is new in kind. Every piece has a working precedent in this repo, and the design copies the precedent rather than inventing a second shape (Lesson 20).

| Executor piece | Precedent in the repo | What is copied |
|---|---|---|
| A closed verb list the caller cannot widen | `src/services/cos/client.js` exports exactly two verbs; `WRITABLE_TABLE` is a constant, not a parameter; Bundle 38/41 pin the export surface | The table or verb is not an argument. Widening requires editing the file, and the battery notices. |
| The person is not an argument the model can set | `forUser(userId).select(...)` applies `.eq('user_id', …)` before the caller's builder; `ledgerKey()` throws without a user id | The root and the owner come from the execution row, never from the proposal. |
| Propose in memory, first durable write on confirm | `src/services/capture.js`: `proposeCapture` parks the model output; `confirmCapture` is "the first durable write" and anchors the `agent_runs` cost row to it | Rehearsal writes nothing durable; the receipt is the anchor. |
| Claim before act, decided by the database | `src/services/cos/ledger.js`: a plain INSERT is the claim, `23505` loses the race, a stuck claim fails closed | Execution status transitions are compare-and-set; two Mac Studios (or two ticks) cannot both execute one run. |
| A dry-run ladder with named rungs, each safe to sit on | `COS_BRIEF_DRY_RUN` → `COS_BRIEF_WRITEBACK_ONLY` → `COS_BRIEF_LIVE`, `briefMode()` in `src/jobs/cosDailyBrief.js` | Rehearse → receipt → approve → write. Each rung names itself in the record. |
| Capability gate from the closed vocabulary | `requireCapability()` in `src/routes/api/auth.js`: absent row and `granted=false` are the same refusal; a read error refuses | The executor's capability check is the same query, same three outcomes. |
| One atomic write behind a `service_role`-only function | `provision_user()`, `publish_program_revision()`: SECURITY DEFINER, pinned `search_path`, controls inside the migration | The approval write is a Postgres function taking the actor from `auth.uid()`; the execution tables get RLS enabled and forced in the same migration. |
| Every model call logs a cost row | `usage.logAgentRun()`; II.5: "any new model-calling job must log its run or the guard silently undercounts" | The local model's calls are logged too (decision 13). |
| The brief's reader of machine work | `readAgentRuns()` reads CoS `agent_runs` columns `id, agent, model, objective, verification_state, unresolved_findings, recommended_next_action, original_body, created_at` for one `user_id` | The digest is written into exactly those columns, so the brief's reader does not change. |

**Two tables are both called `agent_runs`, and they are not the same table.** This matters for M8.6 and is easy to get wrong:

- **Cedrus `agent_runs`** (project `qjwbtlnwnjjuvrwblkzx`): the cost ledger. Written by `usage.logAgentRun()` with `user_id, run_type, trigger_message_id, response_message_id, model, prompt_tokens, completion_tokens, latency_ms, success, error_message`. It feeds `v_daily_token_usage`, which the budget guard reads. Its DDL is one of the six file-less migrations and is not in version control; the column list above is what the write path sends, not a schema read.
- **CoS `agent_runs`** (project `kpzyzjhfvjfvxowhusir`): the report. Read by the brief through `forUser(cosUserId)`. Never written by this repo today: the CoS client's single permitted write is `today_briefs`. Its 9 read columns are validated against PostgREST's own OpenAPI document by `test/cos-schema-check.mjs`.

The brief says "no agent run appears" because nothing has ever written a row into the second table for the owner's CoS user id. M8.6 is the act of writing one.

---

## 2. Topology: where each piece runs and which way it talks

```
  Person's phone / laptop, anywhere
        │  HTTPS, per-person session (Phase 3)
        ▼
  Railway  ─────────────── never connects INTO the house
   node src/index.js       writes: executions (requested, approved)
   /api/executions/*       reads:  executions, execution_events
        │
        ▼ service role (outbound from Railway)
  Supabase — Cedrus project           Supabase — CoS project
   executions, execution_events        agent_runs  (the digest the brief reads)
   agent_runs (cost), user_capabilities, user_settings
        ▲                                     ▲
        │ service role, OUTBOUND ONLY          │ service role, OUTBOUND ONLY
        │ (poll every 30 s)                    │ (one pinned insert)
  Mac Studio, tailnet only, no public port
   launchd daemon: node src/executor/daemon.js   (this repo, same checkout)
   llama-server on 127.0.0.1:8080                (local model, HTTP, localhost only)
   /Users/cedrus/roots/<app_users.id>/           (one root per person)
```

Three properties follow from the arrows and each one maps to a proof:

1. **The Mac Studio has no listener that Railway or the internet can reach.** It polls Supabase and calls `127.0.0.1`. That is the charter's tier rule ("it pushes results outward rather than accepting inbound connections") and it is what makes D5 a property of the design rather than a firewall setting. The firewall is still set (runbook §4), as belt and braces.
2. **The model server is bound to loopback.** Nothing on the tailnet, let alone the internet, can talk to the model directly; only the executor process on the same machine can. A person on the tailnet reaches the executor's results through Supabase and the interface, not through the model.
3. **The person's approval never transits the Mac Studio.** It is written by the Railway API from the person's own session token into `executions.approved_by`, and the executor reads it back. The executor therefore cannot forge an approval: it has no path that writes that column (enforced in SQL, §6.4).

---

## 3. The closed verb list

Eight verbs. Seven can be proposed by the model. One is executor-issued and is refused if the model proposes it. The list is a frozen object, `VERBS`, exported from `src/executor/verbs.js`, and a battery pin asserts its exact key set, so adding a ninth verb means editing that file and updating the pin on purpose.

Every verb takes `{ execution, args }`. `execution` carries `user_id` and the resolved root; `args` is the model's JSON, already validated against the verb's schema with `additionalProperties: false`. **No verb reads an environment variable, no verb accepts a user id, a root, or a table name in `args`, and no verb imports `child_process`, `vm`, or `worker_threads`.** Those are global rules, pinned in the battery (§8).

### 3.1 Read tier — rehearsal-safe, requires `run_agents`

| Verb | Arguments | May touch | May never touch | Implemented without a shell by |
|---|---|---|---|---|
| **`read_file`** | `path` (relative, ≤ 1024 chars, no NUL) · `max_bytes?` (≤ 524 288) | One regular file under the caller's root, read-only | Anything outside the root; a symlink whose target leaves the root; devices, sockets, FIFOs; `/Users/cedrus/executor`, `models`, `logs` | `node:fs/promises`: `confine(root, path)` (§4.2) → `fs.open(resolved, O_RDONLY \| O_NOFOLLOW)` → `fstat` must be a regular file → bounded read |
| **`list_files`** | `path?` · `max_entries?` (≤ 2000) · `include_hidden?` (default false) | Directory entries under the root, recursively, names and sizes only | Following symlinks out of the root; listing any other root | `fs.opendir` recursion in-process, each entry `lstat`ed; symlinks reported as `symlink` and never descended |
| **`search_text`** | `pattern` (≤ 200 chars, no backreferences, no lookbehind) · `path?` · `max_matches?` (≤ 500) | Text files under the root | Binary files (NUL byte in the first 8 KB is refused, same test as `test/no-nul-bytes.sh`); anything outside the root | `list_files` internally, then `read_file` per candidate, `RegExp` with a per-file 200 ms deadline; no `grep`, no `rg` |
| **`read_workspace`** | `table` ∈ `{workstreams, open_loops, decisions, captures, agent_runs}` · `limit?` (≤ 50) | The caller's own rows in those five CoS tables | `email_messages`, `email_ai_analyses`, `today_briefs` (decision 9); any other person's rows; any Cedrus-project table | `forUser(cosUserId).select(table, q => q.limit(n))` from `src/services/cos/client.js`; the user id comes from `user_settings.cos_user_id`, never from `args` |
| **`compile_program`** | `source_path` · `kind` · `title` · `start_date?` · `horizon_days?` · `time_zone?` | Reads one file under the root; computes | Writes nothing; touches no table | The pure compiler in `src/services/programs/compile.js`, in-process, returning the item table or the refusal reason |

### 3.2 Write tier — needs rehearsal, receipt and approval; requires `run_agents` **and** `write_workspace`

| Verb | Arguments | May touch | May never touch | Implemented without a shell by |
|---|---|---|---|---|
| **`write_file`** | `path` · `content` (≤ 1 MiB, UTF-8) · `expected_sha256?` (sha of the file as it was when rehearsed; `null` means "must not exist") | One regular file under the caller's root; creates missing parent directories **inside** the root | Anything outside the root; setting an executable bit; creating a symlink; overwriting a file whose sha no longer matches the receipt | `confine()` → write to `<root>/.tmp/<execution_id>` → `fsync` → `fs.rename` onto the target (atomic on APFS) → `fstat` and sha the result → record `bytes` and `sha256_after` as evidence |
| **`publish_program_revision`** | `source_path` · `kind` · `title` · `start_date` · `end_date` · `time_zone` · `source_name?` | One `rpc('publish_program_revision', …)` with `owner = execution.user_id` | A different owner; any actual (the function has no way to write one); a second call on `23505` | `publishProgramRevision()` in `src/services/programs/publish.js`, the existing one-call thin caller; the same source twice returns the existing revision id as a refusal, never a retry |

### 3.3 Executor-issued — refused if proposed

| Verb | Arguments | May touch | Issued when |
|---|---|---|---|
| **`record_run_report`** | `objective` · `verification_state` ∈ `{verified, unverified, refused, failed}` · `unresolved_findings[]` · `recommended_next_action` · `body` | One INSERT into CoS `agent_runs` for `user_settings.cos_user_id`, through a new pinned `cosInsertAgentRun(row)` in `src/services/cos/client.js` (decision 7) | At every terminal rung: finished, failed, refused, rejected, expired. This is M8.6. If the person has no `cos_user_id` row, the executor announces `executor.report.unwritable` and the execution still closes; silence is not an outcome (C3's shape). |

### 3.4 What is deliberately not a verb in v1

- **No `git` verb.** Every git operation in Node either spawns the `git` binary or needs a library (`isomorphic-git`). The first is a shell path; the second is a real option for v2 and is decision 12. Until then the charter's "your own repositories, if you want agent runs" stays open (§9, E5).
- **No network verb.** The executor's only outbound HTTP is to `127.0.0.1:8080` (the model) and the two Supabase URLs. `fetch` is not reachable from a verb; the battery pins that the executor module graph does not import `node:http` clients other than the two SDKs.
- **No `delete_file`, no `move_file`.** A person who wants a file gone removes it themselves. Delete is the verb whose bad completion the amendment names (`rm -rf`), and there is no first use that needs it.
- **No multi-step plan.** One run is one verb (decision 10). A job that needs three verbs is three runs, each with its own receipt, and the model may propose the second after reading the first's evidence.
- **No cloud model call from the Mac Studio.** The Railway brief keeps OpenAI until M8.2's numbers decide the hybrid question in writing (decision 14). The executor talks to the local model only.

---

## 4. Per-person execution roots

### 4.1 Layout on the Mac Studio

```
/Users/cedrus/                        a standard (non-admin) macOS account that runs the daemon
  roots/                              mode 0700, owner cedrus
    3f9a…-<app_users.id of A>/        mode 0700 — the root is NAMED BY the Cedrus account id, not a person's name
      inbox/                          sources the person gives the machine (transcripts, plans)
      work/                           files runs read and write
      out/                            artifacts a run produces; linked from evidence
      runs/<execution_id>/            per-run evidence: proposal.json, rehearsal.json, receipt.json, events.jsonl
      .tmp/                           write_file staging; emptied at daemon start
    7c02…-<app_users.id of B>/
    b41e…-<app_users.id of C>/
  executor/                           this repo, checked out; read-only to verbs (it is not under any root)
  models/                             GGUF weights; read-only to verbs
  logs/                               daemon log (the same structured logger as Railway; scrubbed)
```

Roots are named by `app_users.id` for the same reason log lines carry `u_<id>` and never a phone: a directory name is a durable identifier and it should be the one the database already uses, not a first name that becomes a second identity. The directory for a person is created by the daemon on first sight of a `requested` execution for that `user_id`, never by hand and never from an argument.

The daemon runs as `cedrus`, a user with no admin rights, no SSH key, and no login shell need. It runs from a system LaunchDaemon so it needs no GUI session (runbook §4.5).

### 4.2 How a verb is confined to its caller's root

The root is derived, not passed: `root = realpath(ROOTS_DIR + '/' + execution.user_id)`. `ROOTS_DIR` is the one path the daemon reads from its own configuration at boot; no verb sees it. The proposal cannot mention a root because no verb schema has a field for one, and `additionalProperties: false` rejects any extra key before a verb runs.

`confine(root, relPath)` is one pure function and every filesystem verb calls it first:

1. Refuse if `relPath` is absolute, contains a NUL byte, or is longer than 1024 bytes.
2. `candidate = path.resolve(root, relPath)`. Refuse unless `candidate === root` or `candidate.startsWith(root + path.sep)`. This closes `..` and any prefix trick (`/roots/A` vs `/roots/AB` is why the separator is appended).
3. Walk down from `root` component by component, `lstat`ing each existing one. If any component is a symlink, `realpath` it and re-check containment against `root`. This closes the symlink-out escape, including a symlink planted by an earlier run.
4. Reads open with `O_NOFOLLOW` on the final component and `fstat` must report a regular file. Writes stage in `.tmp/` and `rename`; the target's final component is `lstat`ed immediately before the rename and refused if it is a symlink.
5. Return `{ resolved, existed, sha256_before }` so the rehearsal can record the precondition the receipt will carry.

Confinement is code, not the kernel (decision 4). The `cedrus` account can read every root, so the proof that A cannot read B's root is a proof about `confine()`, and it must be falsifiable: the battery removes step 2 and shows the suite go red (§8).

### 4.3 The proof that a verb for A cannot read B's root, with the control that it can read A's

Bundle E (proposed `test/executor-roots.test.mjs`), against a temporary `ROOTS_DIR` with two real roots on disk:

- Seed `A/work/plan.md` with the marker `MARKER_A_4f1c` and `B/work/plan.md` with `MARKER_B_9e07`.
- **E1, escape refused:** an execution for A proposing `read_file { path: '../<B-id>/work/plan.md' }` is refused with `path_outside_root`; assert zero `open` calls reached the fake fs and the response contains neither marker.
- **E1, symlink refused:** plant `A/work/link -> ../../<B-id>/work`; `read_file { path: 'work/link/plan.md' }` is refused with `path_outside_root` at step 3.
- **E5, same relative path, different root:** executions for A and B each propose `read_file { path: 'work/plan.md' }`; A receives exactly `MARKER_A_4f1c`, B exactly `MARKER_B_9e07`. This is the control that reading one's own equivalent file succeeds, and it is in the same test as the refusal.
- **E5, model context:** build the proposal prompt for A with both roots populated; assert `MARKER_B_9e07` does not appear anywhere in the prompt and `MARKER_A_4f1c` does. The second half is what makes the first half meaningful: a prompt builder that read nothing would also contain no B marker.
- **Mutation:** delete the `startsWith` check; the escape test must go red and the control must stay green. Delete the symlink walk; the symlink test must go red.

---

## 5. The ladder

Every execution walks the same rungs in the same order. Each rung is a status on `executions`, an append-only row in `execution_events`, and, where a model was called or a report is due, a row in one of the two `agent_runs` tables. The names are the ones `briefMode()` would use if it were describing an execution instead of a brief.

### 5.1 The rungs

| # | Rung | Who acts | What happens | What is written | What is NOT written |
|---|---|---|---|---|---|
| 0 | **requested** | the person, from the interface (Phase 3/4) or, until then, decision 11's endpoint | A brief, verbatim | `executions` row `status='requested'`; event `requested` | — |
| 1 | **proposed** | the executor daemon, one model call | Context from the person's root and their own workspace rows; the model returns `{verb, args, rationale}` under a JSON schema | `executions.verb, args, proposal_sha256, model`; event `proposed`; **Cedrus `agent_runs`** cost row `run_type='executor_propose'`; `runs/<id>/proposal.json` in the root | Nothing in the root's `work/`, no table but the two above |
| 2 | **validated** or **refused** | the executor, no model | Verb ∈ `VERBS`; args match the verb's schema; capability rows read; every path confined; no owner-like key in args | Event `validated`, or `status='refused'` + event `refused` with a closed reason code (§7); on refusal the report row is written (rung 8) | A refused run stops here. Nothing else is touched, including the root's `work/`. |
| 3 | **rehearsed** | the executor | The verb's rehearsal function runs: it computes exactly what the live call would touch and returns it. For `write_file`: resolved path, `existed`, `sha256_before`, bytes to write. For `publish_program_revision`: the compiled item table, the program it would find-or-create, the sha of the source text. For read-tier verbs the rehearsal *is* the run, and the result is the evidence. | `status='rehearsed'`; event `rehearsed` with the plan; `runs/<id>/rehearsal.json` | **Nothing in `work/` or `out/`. No rpc that writes. No ledger claim. No status past `rehearsed`.** See 5.2. |
| 4 | **receipt_issued** | the executor | The receipt is the rehearsal plan plus the execution id, the verb, the args, the preconditions, and the predicted evidence, canonicalised (sorted keys, no whitespace) and hashed | `executions.receipt, receipt_sha256, receipt_issued_at`; `status='receipt_issued'`; event `receipt`; `runs/<id>/receipt.json` | Read-tier runs skip rungs 4–6: their rehearsal is terminal and they go straight to `finished`. |
| 5 | **approved** or **rejected** | the person, from their own session | `approve_execution(id, sha)` (§6.4) sets `approved_by = auth.uid()`'s account, `approved_at`, `approved_sha256 = sha`; refuses unless `sha = receipt_sha256`, the caller owns the run, and the receipt is younger than 24 h | `status='approved'` or `'rejected'`; event `approved` / `rejected` | The Mac Studio has no write path to these columns. |
| 6 | **executing → finished** or **failed** | the executor | Compare-and-set `approved → executing` (the claim; the loser sees zero rows updated and stops). Re-check the precondition (`sha256_before` still matches; source unchanged). Perform the one write. Record evidence. | Event `write` (per write: path, bytes, `sha256_after`; or rpc name and returned ids); `status='finished'` + `finish_condition`, or `status='failed'` + error class | A precondition that no longer holds is `failed: precondition_failed`, not a retry with the new state. That would be a write the person did not approve. |
| 7 | **expired** | the executor, on its poll | A `receipt_issued` older than 24 h with no approval | `status='expired'`; event `expired` | — |
| 8 | **report** | the executor | The M8.6 digest, at every terminal rung | **CoS `agent_runs`** row: `agent='executor'`, `model`, `objective=brief`, `verification_state` (verified / unverified / refused / failed), `unresolved_findings[]`, `recommended_next_action`, `original_body` = a plain-text digest of the events; `user_id = user_settings.cos_user_id` | Never written twice for one execution (the event `report` carries the CoS row id; a second attempt sees it and stops). |

### 5.2 What "advances no cursor" means, exactly

A cursor is any state the system later reads to decide "this was already done." The rehearsal touches none of these, and the E3 test asserts each one individually, with the live run in the same suite moving the ones it should:

| Cursor | Rehearsal | Live run |
|---|---|---|
| `executions.status` beyond `rehearsed` | never | yes |
| `execution_events` rows other than `rehearsed` | never | `write`, `finished` |
| Any file under `work/` or `out/` | never (only `runs/<id>/rehearsal.json`) | the one target file |
| `programs.current_revision_id`, `program_revisions`, `program_items` | never (compile is pure) | moved by `publish_program_revision` |
| The send ledger (`system_flags` `cos_brief_send:*`) | never; the executor has no code path to it | never; the executor has no code path to it |
| CoS `agent_runs` (the report) | never | at finish |
| Cedrus `agent_runs` (cost) | the proposal's cost row is written at rung 1, before rehearsal; rehearsal itself makes no model call and writes no row | same |

The last line is the one honest asymmetry: the *proposal* costs tokens and is recorded, exactly as `proposeCapture` audits its spend before anyone confirms. That row records a model call, not a delivery, which is what E3 forbids.

### 5.3 The receipt

The receipt is the thing the person approves and the thing the executor is later bound to. It is therefore exact and canonical:

```json
{
  "execution_id": "e7a3…",
  "user_id": "3f9a…",
  "verb": "write_file",
  "args": { "path": "work/miami-man-2026.plan.md", "content_sha256": "c41d…", "expected_sha256": null },
  "preconditions": { "path_resolved": "/Users/cedrus/roots/3f9a…/work/miami-man-2026.plan.md", "existed": false },
  "predicted_effects": { "bytes": 4812, "creates": ["work/miami-man-2026.plan.md"], "tables": [] },
  "rehearsed_at": "2026-10-20T14:02:11Z",
  "model": "local:llama-3.3-70b-instruct-q8_0"
}
```

`content` itself is not in the receipt (it is in `runs/<id>/receipt.json` in the root, and in `args`); its sha is. The person approves a hash; the executor refuses to execute a run whose current `receipt_sha256` differs from `approved_sha256`, and the SQL function refuses to record an approval for any other hash. That pair is E4.

### 5.4 The brief, the morning after

`readAgentRuns()` is unchanged. `compose.js` maps each row to `agent_run` and the renderer prints it. For a finished run the row reads, in the columns the brief already knows:

> **executor** · *Compile the Miami Man plan from the coaching transcript and publish it* · verified · no unresolved findings · next: review the ten-week grid in Programs.

For a refusal the same reader prints *refused* with the finding "proposal refused: unknown verb `shell`" and the next action "no action was taken." The morning brief therefore says what happened on the machine, including what did not happen, with no new column in the reader and no new fixture written from the same reading of CoS (Lesson 20: `test/cos-schema-check.mjs` gains the insert's column list, so the write is checked against CoS's own description of itself).

---

## 6. The model's role, and what the executor refuses

### 6.1 What the model is given

One system prompt naming the eight verbs, their argument schemas, and the rule that it returns exactly one JSON object. One user turn containing: the brief; a bounded listing of the person's root (names and sizes, from `list_files`); the person's five readable workspace tables, bounded (from `read_workspace`); and, when a prior run in the same thread finished, that run's evidence. Nothing from any other root, any other person's rows, or the environment. The prompt builder is the only code that assembles context, and the E5 test asserts the other person's marker never appears in it.

### 6.2 What the model returns

`response_format: { type: 'json_schema', json_schema: PROPOSAL_SCHEMA, strict: true }` to a llama.cpp `llama-server` on loopback (decision 2). The schema is:

```json
{ "type": "object", "additionalProperties": false, "required": ["verb", "args", "rationale"],
  "properties": {
    "verb": { "enum": ["read_file", "list_files", "search_text", "read_workspace", "compile_program", "write_file", "publish_program_revision"] },
    "args": { "type": "object" },
    "rationale": { "type": "string", "maxLength": 600 } } }
```

`record_run_report` is absent from the enum on purpose; the executor issues it. Grammar-constrained decoding means the model *cannot* emit a verb outside the enum. The executor validates anyway, on the model's raw text, because a constraint the executor does not verify is a constraint the executor is trusting (Lesson 20 again: the server's grammar and the executor's list would otherwise be one author agreeing with itself). The refused-verb test drives the executor with a hand-written `{ "verb": "shell" }` precisely because the live server could never produce one.

### 6.3 The validation order, and the refusal codes

Validation runs in this order and stops at the first failure. Each code is closed by a `CHECK` on `execution_events.detail->>'reason'` in the proposed migration, so a new reason is a migration, not a string.

| Order | Check | Reason code on failure |
|---|---|---|
| 1 | Raw text parses as JSON and matches `PROPOSAL_SCHEMA` | `model_output_unparseable` |
| 2 | `verb` is a key of `VERBS` and not executor-issued | `unknown_verb` |
| 3 | `args` matches `VERBS[verb].schema`, `additionalProperties: false` | `schema_invalid` |
| 4 | No key in `args` is one of `user_id`, `owner`, `root`, `cos_user_id`, `table` (for filesystem verbs), and no string value under `args` equals any `app_users.id` or CoS user id known to the daemon | `owner_in_args` |
| 5 | `user_capabilities` has `(user_id, 'run_agents', granted=true)`; write tier also needs `write_workspace`; a read error refuses | `capability_not_granted` (or `capability_unreadable`) |
| 6 | `account_status = 'active'` on `app_users` | `account_inactive` |
| 7 | Every path argument passes `confine()` | `path_outside_root` · `path_not_regular_file` |
| 8 | `read_workspace.table` is in the executor's five-table subset | `table_not_readable` |
| 9 | Prerequisites the rehearsal needs exist: the model server answered, the root exists, `cos_user_id` is set (else the report is announced unwritable but the run proceeds) | `prerequisite_unmet` |

At execution time two more can occur: `receipt_mismatch` (the approved sha is not the current receipt's) and `precondition_failed` (the file or source changed since rehearsal). At approval time, in SQL: `receipt_expired`, `not_owner`, `wrong_status`.

### 6.4 The approval function

Proposed `approve_execution(p_execution_id uuid, p_receipt_sha256 text, p_decision text)`, SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE granted to `authenticated` only (the one function in this design a browser session may call), and it takes the actor from `current_app_user_id()`, never from a parameter:

- refuse `42501` unless the execution's `user_id = current_app_user_id()` (decision 8: only the owner approves their own run; an admin cannot approve for someone else);
- refuse unless `status = 'receipt_issued'` and `receipt_issued_at > now() - interval '24 hours'`;
- refuse unless `p_receipt_sha256 = receipt_sha256`;
- set `approved_by, approved_at, approved_sha256, status` in one UPDATE; insert the `approved` or `rejected` event; return the new status.

`authenticated` holds SELECT-own on `executions` and `execution_events` and no INSERT/UPDATE/DELETE grant at all; the function is the only door, exactly as `provision_user()` is the only door to an account. The Railway route `POST /api/executions/:id/approve` (decision 11) is a thin caller: `requireUser` → `rpc('approve_execution', …)` with the session's own identity behind it. The Mac Studio's service-role client never calls this function; it only ever *reads* `approved_sha256`.

### 6.5 What a refusal looks like in the audit trail

Three rows and one file, for a proposal of a verb that does not exist:

`executions`
```
id            e7a3f0c2-…
user_id       3f9a…                     (A)
status        refused
brief         "Clean up the old plans folder"
verb          shell                     (stored: it is the refused name, a bare string)
args          NULL                      (never stored in the database for a refusal — see below)
proposal_sha256  9f2e…
model         local:llama-3.3-70b-instruct-q8_0
```

`execution_events`
```
execution_id  e7a3f0c2-…   rung  proposed   detail {"model":"local:…","prompt_tokens":3120,"completion_tokens":41}
execution_id  e7a3f0c2-…   rung  refused    detail {"reason":"unknown_verb","verb_requested":"shell","args_keys":["cmd"],"args_sha256":"71bb…"}
execution_id  e7a3f0c2-…   rung  report     detail {"cos_agent_run_id":"b2d0…"}
```

Cedrus `agent_runs` (cost)
```
user_id 3f9a…  run_type executor_propose  model local:…  prompt_tokens 3120  completion_tokens 41  success true
```

CoS `agent_runs` (the brief's row)
```
user_id <A's cos_user_id>  agent executor  objective "Clean up the old plans folder"
verification_state refused
unresolved_findings ["proposal refused: unknown verb 'shell'"]
recommended_next_action "No action was taken. Rephrase the brief, or ask for a capability if one is missing."
original_body "requested 14:01:58Z · proposed 14:02:09Z (local model, 3161 tokens) · refused 14:02:09Z: unknown_verb 'shell' · nothing written"
```

`/Users/cedrus/roots/3f9a…/runs/e7a3f0c2-…/proposal.json` holds the raw model output verbatim, for the owner's own debugging.

Two choices in that trail are deliberate. The raw `args` of a *refused* proposal are stored only in the owner's root and as a sha plus key names in the database, because a refused proposal is the one place another person's path or identifier could appear, and the database row is what an admin can read (A10). And the refusal reaches the brief: a person who asked for something and got nothing is told so the next morning, in the same sentence shape as a success.

---

## 7. The proposed schema, in outline

One additive migration, `supabase/migrations/2026MMDD…_executions.sql`, Cedrus project, written and applied in M8.5's session, never by this one. Same conventions as the three migrations that exist: RLS enabled **and forced** in the same file, no policy naming `anon` or `public`, `user_id` on every table with a composite FK from child to parent `(id, user_id)`, closed vocabularies by `CHECK`, self-proof and controls inside the transaction.

- **`executions`**: `id, user_id → app_users, status (CHECK: requested · proposed · refused · rehearsed · receipt_issued · approved · rejected · executing · finished · failed · expired), brief, verb, args jsonb, proposal_sha256, model, receipt jsonb, receipt_sha256, receipt_issued_at, approved_by → app_users, approved_at, approved_sha256, finish_condition, finished_at, created_at, updated_at`. A trigger refuses any UPDATE that changes `verb`, `args`, `proposal_sha256`, `receipt` or `receipt_sha256` once set: the proposal and the receipt are immutable, so what was approved is what is executed.
- **`execution_events`**: `id, execution_id, user_id, at, rung (CHECK, the list in §5.1), detail jsonb, evidence jsonb`, composite FK `(execution_id, user_id) → executions(id, user_id)`, append-only by trigger (the `admin_audit` pattern: service role bypasses grants, a trigger fires for every writer).
- **`approve_execution()`** as in §6.4. **`claim_execution(id, expected_status, new_status)`** for the daemon's compare-and-set, `service_role` only, returning the number of rows moved so a lost race is a visible zero, not a silent success (Lesson 19's CAS).
- Policies: `authenticated` SELECT own on both tables; nothing else. `anon` nothing.

The V10 `RunExecution` shape (`status, brief, prerequisites[], events[], approval, artifacts[], usage, finish_condition`) is a projection of these two tables plus the cost row, so Phase 4's Runs surface gets the "actual provider for execution events/approval/artifacts" the proposal says it must identify before showing them as real.

---

## 8. The proofs: what each decision satisfies, and what stays open

| Proof | Claim (charter §7) | Satisfied by | Test that falsifies it | Status after this design |
|---|---|---|---|---|
| **E1** | A run reads and writes only under its own person's root. | Roots derived from `user_id` (§4.1); `confine()` with the four steps (§4.2); no verb takes a root | Bundle E §4.3: escape refused, symlink refused, own path succeeds; mutation removes the `startsWith` check | Closable in M8.3 |
| **E2** | The model proposes; a pinned list of verbs executes; no shell and no path to one. | Frozen `VERBS`; `record_run_report` outside the enum; JSON-schema output re-validated; verb implementations in §3 use `fs`, `rpc`, and pure functions only | `test/executor-verbs.test.mjs`: drive `{verb:'shell'}` → `unknown_verb`, zero fs/db calls (fakes count); control `read_file` returns content; a static import walker over `src/executor/**` asserts no `child_process`, `vm`, `worker_threads`, and only the OpenAI and Supabase SDKs as HTTP clients; mutation adds `shell` to `VERBS` → export-surface pin red | Closable in M8.4 |
| **E3** | A dry run writes nothing and advances no cursor; a rehearsal never records a delivery. | §5.2's cursor table; rehearsal functions are separate from live functions and the live one is not reachable before `approved` | One suite: rehearse `write_file` → assert file absent, `programs` untouched, status `rehearsed`, no `write` event, no CoS row; then approve and execute the same run → file present, `write` event, `finished`, CoS row. Mutation: make the rehearsal call the live writer → red | Closable in M8.5 |
| **E4** | No run writes anything before an approval receipt exists, scoped to that run. | `approved_sha256 = receipt_sha256` checked in SQL and re-checked by the executor; the immutability trigger; CAS `approved → executing` | Assert `events` order `receipt < approved < write` by `at`; drive an approval with a wrong sha → `receipt_mismatch`, no write; drive execution on a `receipt_issued` run with no approval → refused; mutation removes the sha comparison → red | Closable in M8.5 |
| **E5** | One person's run cannot read another's files, repositories or model context. | Files: E1's machinery. Model context: the prompt builder reads only the owner's root and `forUser(cosUserId)` rows (§6.1) | §4.3's marker test on the prompt, with the own-marker control | **Files: closable. Repositories: OPEN** (no git verb in v1, decision 12). **Model context: PARTIAL** until M8.2 verifies on the machine that `llama-server`'s prompt cache cannot surface one request's context to another (it is per-slot by design; unverified here) |
| **D5** | The Mac Studio answers only on the tailnet. | Topology §2: no listener; model on loopback; polling outbound | The runbook's two probes (§4.6 there): public probe fails, tailnet probe succeeds, outputs recorded verbatim | OPEN until the machine exists |

Also touched, not owned here: **A7** (capability gate reused, same three outcomes), **A10** (refused args kept out of the database), **D4**'s shape (`execution_events` append-only), **C3**'s shape (an unwritable report is announced, never silent).

**Open beyond the E series, stated plainly:**

- The interface approval button needs Phase 3's API and Phase 4's Runs surface. Until they land, approval goes through decision 11's endpoint, driven from the owner's own session.
- `user_settings.cos_user_id` is empty for everyone today (II.5, 2026-09-09). Until P1.3 backfills it, `record_run_report` announces `unwritable` for every run and the brief keeps saying no agent run appears. **M8.6 depends on P1.3, not only on the Mac Studio.**
- `v_daily_token_usage` sums every `agent_runs` row regardless of model, so local tokens will count against `DAILY_TOKEN_BUDGET` (decision 13). The view's definition is not in this repo; changing it is a data-side migration Emil applies.
- Concurrency on one machine: consulting §13.1 says ~2–3 light concurrent users. v1 executes one run at a time (decision 10); the local model's real throughput is M8.2's number.

---

## 9. What this design does not decide

- **Which 70B, at which quantisation.** M8.2 measures; this design only requires an OpenAI-compatible loopback server with JSON-schema output.
- **How a person gets a file into `inbox/`.** v1 sources arrive as text in the database (`program_revisions.source_text` already exists for exactly this) and as `write_file` output. Direct file drop over the tailnet is decision 5's second half and is not needed for the first run.
- **Skills.** Phase 9 says a skill is "a packaged capability the Engine loads." When it lands, a skill is most naturally a *named verb sequence with its own schema*, loaded into `VERBS` by the same pinned mechanism. Nothing here forecloses that and nothing here builds it.
- **The hybrid question** (consulting §13.2). Emil owes it in writing before client conversation #1; M8.2 supplies the numbers.

---

## 10. Decisions for Emil

Each has a recommendation. "Your call" without one is work handed back (II.0).

1. **Where the executor lives.** In this repo, under `src/executor/`, run on the Mac Studio from the same checkout as everything else. *Recommend yes.* The Engine is one codebase (consulting §0); the executor reuses `forUser`, `publishProgramRevision`, `requireCapability`'s query and the logger unchanged, and the battery already knows how to run bundles against real migrations on PGlite.

2. **The model server.** llama.cpp's `llama-server` on `127.0.0.1:8080` with `response_format: json_schema`, versus Ollama, versus an MLX server. *Recommend llama.cpp.* It is the one with grammar-constrained decoding today, it speaks the OpenAI shape so `src/lib/openai.js`'s client works with a `baseURL`, and it binds to loopback by flag. M8.2 decides the model and quant on measured numbers.

3. **The verb list.** The eight in §3, seven proposable. *Recommend approve as listed.* Every one has a working precedent in the repo; the two write verbs are the ones the first real job needs (a transcript becomes a plan file; the plan becomes a program).

4. **Confinement level.** Code-level confinement under one `cedrus` account (§4.2), versus one POSIX user per person with the daemon switching identity. *Recommend code-level for v1,* proven by Bundle E and mutation-checked, with the roots directory at 0700. Per-person POSIX users are stronger but require the daemon to run as root to switch users, which is a larger surface than the one it removes. Revisit when a fourth person or a client install shares a machine.

5. **Roots: location and naming.** `/Users/cedrus/roots/<app_users.id>`; sources arrive through the database in v1, not by file drop. *Recommend yes,* and defer file drop until Connect can show a person what the machine can see of theirs (connector doctrine 1: explicit authorisation, shown before approval).

6. **Where the ladder's state lives.** Two new tables, `executions` and `execution_events`, in the Cedrus project (§7), versus reusing `system_flags` as the ledger did. *Recommend the two tables.* The ledger reused `system_flags` because applying a migration was a hard stop that day; migrations now have a sanctioned path, and the Runs surface needs a queryable history, which a `key/value` row cannot give it.

7. **Where the digest lands.** A second pinned write in `src/services/cos/client.js`, `cosInsertAgentRun`, table fixed to the constant `'agent_runs'`, versus teaching the brief's reader to read the Cedrus `executions` table instead. *Recommend the second pinned write.* The reader stays byte-for-byte what `cos-schema-check.mjs` already validates, and the widening is one named edit that Bundle 38/41's export-surface pins force into the open. The longer answer is the amendment's open decision 3, consolidating to one database, at which point both `agent_runs` become one table; this design does not wait for that.

8. **Who may approve.** Only the run's owner, from their own session; an admin cannot approve for another person. *Recommend yes.* The write boundary is the person's, and an admin approving on someone's behalf is the special case the parity rule exists to refuse.

9. **`read_workspace` scope.** Five tables (`workstreams, open_loops, decisions, captures, agent_runs`), excluding `email_messages` and `email_ai_analyses`. *Recommend exclude.* Email bodies are the most sensitive rows the brief reads (audit finding 19), and a local model's context is the one place in this design where content is copied wholesale. Add them later with their own decision, as the connector doctrine requires of any new use of already-connected data.

10. **One verb per run, one run at a time.** *Recommend both for v1.* One verb makes the receipt exact and E4 trivially checkable; one at a time matches the machine's real concurrency until M8.2 says otherwise. Per-person FIFO by `created_at`.

11. **The approval surface before Phase 4.** `POST /api/executions/:id/approve { receipt_sha256, decision }` behind `requireUser` in this repo, the shape A3.2 will keep, versus waiting for the interface, versus an SMS keyword. *Recommend the endpoint,* built in M8.5's session, with the interface button arriving in C4.x and SMS approval considered only after the SMS consent gap for provisioned accounts (II.5, 2026-09-09) is closed.

12. **Repositories.** No git verb in v1. *Recommend yes,* and when it comes, `isomorphic-git` over a spawn, so E2 keeps holding. E5's "repositories" half stays open and says so in the charter.

13. **Local model spend.** Log every local call to Cedrus `agent_runs` with `model='local:<name>'` and `run_type='executor_propose'`, accepting that it counts against `DAILY_TOKEN_BUDGET` until the view is changed. *Recommend yes.* An unlogged model-calling job is the exact undercount II.5 warns about, and a budget that also caps local work is a ceiling on total machine work, which is not wrong on day one.

14. **No cloud model from the Mac Studio; OpenAI stays on Railway for the brief until M8.2.** *Recommend yes.* The hybrid decision is owed in writing (consulting §13.2) and should be made on the benchmark, not on the executor's needs; nothing in this design requires a cloud call.

15. **Receipt expiry.** 24 hours. *Recommend yes.* A receipt describes preconditions that age; a day is long enough to approve from a phone and short enough that the file it describes is probably still the file.

**What happens after the decisions.** M8.3, M8.4 and M8.5 become three build sessions with the proofs in §8 as their done-whens; M8.6 waits on P1.3's `cos_user_id` backfill as much as on the hardware. The install runbook's §4 and §6 carry the machine-side steps and mark every one UNVERIFIED until the Mac Studio is on the bench.
