# Cedrus Second Brain — install runbook (DRAFT, install #1)

**2026-09-09 · DRAFT · branch `docs/executor-design-2026-09-09` · rewritten after the timed install**

This runbook is written for the **named owner inside the company that runs Cedrus**, not for Cedrus Consulting. It is the document that lets you run, check, fix and, if you ever want to, take the whole thing away from us (consulting values 2 and 3: you own it, and no dependency by design).

**Install #1 is a household, not a client.** The owner is Emil; the three people are Emil, his father and his brother; the machine is a Mac Studio arriving around 15 October. Read every "you" below as the owner, and read every ⚖ **judgment call** as the question a client's owner will ask about that step. Recording those calls before the install is this draft's whole job. The timed install rewrites it.

**How to read the tags.** Every step carries one:

- **VERIFIED (from source)** — the step is stated from files in this repository at commit `39c6d22`, read this session. It describes what the code does. It has not been run on the machine.
- **UNVERIFIED (needs the machine)** — the step cannot be checked from a laptop that is not the Mac Studio, or from a repository that does not contain the thing. It is our best understanding and it says so.

Nothing in this document was executed against production or against any machine. Where a fact about production is cited, its source is CEDRUS.md II.5 (verified environment facts) and the date is given.

---

## 0. Before anything: the four things that do not change

1. **The Mac Studio is never on the public internet.** No port forwarded, no Funnel, no service bound to anything but loopback or the tailnet. Proof is two probes, one that fails and one that succeeds, both written down (§4.6).
2. **Nothing goes out to a person until it has been rehearsed.** Every sender in the Engine has a dry-run switch that is on by default. You turn each one off deliberately, in order, and you keep the log line that says which mode it ran in.
3. **Every person is created by the same code path.** One function makes an account. The only hand-made act in the whole install is promoting the first admin, once, and it is written down as the exception it is.
4. **You can leave.** Your data is in a Postgres database you own; your files are in folders on a machine you own; the export is a dump and a tarball (§5, step 12). If that ever stops being true, we broke the deal.

---

## 1. What you are installing, in plain terms

The Engine is one codebase with five pieces. Three exist today, one is arriving, one is being built.

| Piece | What it is | Where it runs | Today |
|---|---|---|---|
| **A. The backend** | One Node process. Answers the SMS webhook, runs eleven scheduled jobs, composes and sends the morning brief, serves the API. Starts with `node src/index.js`, answers `/health`. | Railway, public HTTPS (it must be: Twilio has to reach it, and a brief that needs a VPN is a brief nobody's father reads) | Live. **VERIFIED** `railway.json`, `src/index.js`, `src/jobs/scheduler.js` |
| **B. The database** | Postgres with row-level security. Every person's rows carry `user_id`; the browser key can read nothing it is not granted. | Supabase, managed | Live. Two projects today (⚖ §7, call 2) |
| **C. The channels** | SMS in and out (Twilio), the brief by email (Resend), the language model (OpenAI today) | Their clouds | Live, each behind its own arming switch |
| **D. The Mac Studio** | A local 70B model and the executor that runs agent work on your own files, reachable only over the tailnet | Your premises | Arriving ~15 Oct. **UNVERIFIED** throughout §4 |
| **E. The interface** | The six surfaces (Now, Day, Programs, Runs, Atlas, Connect) with sign-in | Railway, same origin as the API | Not connected yet (Phases 3–4 of `docs/BUILD_PLAN.md`). Until then the brief is the product you see. |

---

## 2. Inventory — what exists in this repository that an install needs

Everything in this section is **VERIFIED (from source)** unless a line says otherwise.

### 2.1 The service and its schedule

- Start command `node src/index.js`, health check `/health` returning `{"ok":true,"service":"cedrus"}`, restart on failure up to 5 times (`railway.json`). Node ≥ 20 (`package.json`). Deploys on push to `main`; there is no staging (CEDRUS.md Law 6).
- Boot refuses to start in production if the Twilio signature check is disabled, if `PUBLIC_BASE_URL` is missing while signatures are validated, or if any sender is half-armed (`assertSecureBoot()` in `src/config.js`). A misconfigured deploy dies at boot with the variable named, rather than failing at 11:00 UTC in a log nobody reads.
- The scheduler registers exactly these eleven jobs (`JOB_REGISTRY`, `src/jobs/scheduler.js`; observed live 2026-08-26, II.5). Cron times are UTC. `outbound: true` jobs stop when the budget kill switch is tripped.

| Job | Cron (UTC) | Outbound | What it does |
|---|---|---|---|
| `reminder-dispatch` | `*/5 * * * *` | yes | user-set reminders |
| `daily-sweeps` | `*/15 * * * *` | yes | birthdays / drift / events nudges |
| `clarification-expiry` | `*/15 * * * *` | no | held dedup asks past TTL |
| `weekly-briefs` | `0 * * * *` | yes | hourly: users whose SMS brief hour is now |
| `weekly-brief-emails` | `0 * * * *` | yes | legacy email brief; no-op unless `BRIEF_EMAIL_ENABLED=true` |
| `trial-downgrades` | `30 * * * *` | no | retired consumer machinery, still scheduled |
| `budget-guard` | `10 * * * *` | no | sums the day's tokens and SMS segments, arms the kill switch |
| `card-sender` | `*/15 * * * *` | yes | the card rail |
| `card-followup` | `25 * * * *` | yes | "did it happen?" three days after a yes |
| `monthly-core-five` | `0 3 1 * *` | no | first of the month |
| `cos-daily-brief` | `0 11 * * *` | yes | **the morning brief.** 11:00 UTC = 07:00 New York in summer, 06:00 in winter. One fixed hour for everyone until B2.5. |

### 2.2 Environment variables, by name

Read from `src/config.js`, `src/lib/cors.js`, `src/routes/adminAuth.js`, `src/services/adminSession.js`, `src/jobs/briefEmail.js`, `src/jobs/cosDailyBrief.js`, `src/services/cos/*`, `src/services/programs/today.js`, `.env.example`. Grouped by what they are for. **The last group is the one an install must not copy from us.**

**Required at boot, or the process exits** (`required()` in `src/config.js`):
`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `OPENAI_API_KEY` · `TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM_NUMBER`

**Required in production** (boot refuses otherwise):
`NODE_ENV=production` · `PUBLIC_BASE_URL` (the public HTTPS origin Twilio signs against; never derived from the Host header) · `VALIDATE_TWILIO_SIGNATURE` (defaults true; `false` is forbidden in production)

**Global arming switches and ceilings** (these are the only non-secret things an environment variable is allowed to hold, II.5 multi-user rule):
`BRIEF_DRY_RUN` (SMS rail; **stays `true` until a named arming session**, Law 5) · `DAILY_TOKEN_BUDGET` · `DAILY_SMS_BUDGET` (unset = that dimension disarmed and announced hourly; set to 750000 / 400 on Railway, verified 2026-08-18) · `ENABLE_JOBS` (default on) · `WEB_ONBOARD_DRY_RUN` · `CONTRACTS_VALIDATE`

**The morning-brief ladder** (`.env.example` has the rung-by-rung text; each rung is safe to sit on):
`COS_SUPABASE_URL` + `COS_SERVICE_ROLE_KEY` (rung 1, arm the reader; exactly one set is a boot failure) · `COS_BRIEF_DRY_RUN` (rung 3, compose and log only) · `COS_BRIEF_WRITEBACK_ONLY` (rung 4, write the row into the app, no email; overrides the live flag) · `COS_BRIEF_LIVE` + `RESEND_API_KEY` (rung 5, all required to send) · `COS_BRIEF_FROM` · `COS_BRIEF_REPLY_TO` · `COS_BRIEF_MODEL`

**The admin panel** (email + password + TOTP; `docs/ADMIN_AUTH_CONTRACT.md`):
`ADMIN_EMAIL` · `ADMIN_PASSWORD_HASH` (make it with `bun scripts/hash-admin-password.mjs`) · `ADMIN_TOTP_SECRET` · `ADMIN_TOTP_ISSUER` · `ADMIN_TOTP_LABEL` · `ADMIN_SESSION_SECRET` · `ADMIN_SESSION_TTL_HOURS` · `ADMIN_PANEL_TOKEN` · `ADMIN_KEY` (header key for the founder routes; unset = those routes 404)

**Legacy email brief** (SendGrid transport; dormant unless enabled): `BRIEF_EMAIL_ENABLED` · `BRIEF_EMAIL_TRANSPORT` · `BRIEF_EMAIL_LIVE` · `BRIEF_EMAIL_SENDGRID_KEY` · `BRIEF_EMAIL_LINK_SECRET` · `BRIEF_EMAIL_LINK_SECRET_PREV` · `BRIEF_EMAIL_LINK_BASE` · `BRIEF_EMAIL_OUTPUT_DIR`

**Miscellany:** `PORT` (default 3000) · `DEFAULT_TIMEZONE` (default America/New_York) · `OPENAI_MODEL` (default gpt-4.1-mini) · `CORS_ALLOWED_ORIGINS` (default cedrus.life origins; a `*` is refused)

**Variables that name a person — do not copy these; they are being retired into rows** (`docs/SINGLETON_AUDIT_2026-08-30.md`, BUILD_PLAN P1.4):
`COS_USER_ID` (whose brief is composed; set on Railway, verified 2026-09-04) · `COS_BRIEF_TO` (whose inbox) · `COS_BRIEF_USAGE_USER_ID` (whose spend; also the fallback owner for today's program) · `ALLOWED_PHONES` (which numbers SMS serves, both directions; set 2026-08-16, value unverified since) · `TESTER_PHONES` (who the reset tool may reset)

For a client these become `user_settings` rows and capability grants. For install #1 they are still variables, which is ⚖ call 4 in §7.

### 2.3 The database and the migration path

- **Two projects today.** Cedrus, ref `qjwbtlnwnjjuvrwblkzx`, **named "cedrus-dev" and it is production** (the trap is recorded in the header of every migration). Chief of Staff, ref `kpzyzjhfvjfvxowhusir`, a separate app whose database the brief reads and writes one table of. The Supabase org was on the free plan with a two-active-project limit and three projects as of 2026-08-30 (amendment §7.3). ⚖ call 2.
- **Three migration files exist**, `supabase/migrations/`, and their production state as of 2026-09-09 (II.5):

| File | What it creates | Applied to production? |
|---|---|---|
| `20260830120000_multiuser_foundation.sql` | roles and status on `app_users`; `user_capabilities` (closed vocabulary `run_agents, write_workspace, receive_brief, receive_sms`); `user_settings`; `admin_audit` (append-only by trigger); RLS enabled and forced | **Yes**, 2026-08-31, verified by read-back |
| `20260909120000_provision_user.sql` | `provision_user()`: sign-in identity, account row, settings defaults, capability grants, one audit row, in one transaction; `service_role` only | **Yes** (II.5 correction of 2026-09-09 evening, from a read of `schema_migrations` and `pg_proc`) |
| `20260909180000_programs_foundation.sql` | `programs`, `program_revisions`, `program_items`; `publish_program_revision()`, `todays_program_items()` | **No**, as of 2026-09-09 |

- **The sanctioned apply path is the Supabase CLI**, one file at a time: `supabase migration up --linked`, **never a bare `db push`** (Law 8). Before the first apply on this project the remote history holds six versions with no file, which must be marked applied first with `supabase migration repair --status applied <version>` for `20260711053438, 20260711053439, 20260713120000, 20260713120001, 20260716120000, 20260716120001` (`docs/MIGRATION_PATH.md`; the six are from a session prompt, not confirmed against `migration list`). The equivalent path without the CLI is `python3 scripts/apply-<name>-via-api.py`, which uses a Supabase personal access token (`SUPABASE_ACCESS_TOKEN` or the macOS keychain) and the Management API, runs the file's own pre-check and post-check, and records the history row. That is how the first two reached production.
- **The base schema is not in version control.** `app_users`, `people`, `messages`, `facts`, `saved_items`, `reminders`, `user_goals`, `consent_events`, `agent_runs`, `system_flags`, the quota and usage views and the rest were created by an older workflow whose SQL was never committed; the foundation migration *alters* `app_users` rather than creating it, and `scripts/local-dev-supabase.sh` refuses `db reset` for exactly that reason. **A fresh project cannot be built from this repository today.** This is the largest UNVERIFIED item in the runbook and ⚖ call 1.

### 2.4 The allowlists

| Allowlist | Where | What it gates | Disarmed state |
|---|---|---|---|
| `ALLOWED_PHONES` | env → `src/lib/smsAllowlist.js` | inbound SMS (STAGE A2, `routes/sms.js`) and outbound SMS at the single `sendSms()` choke point (`lib/twilio.js`) | empty = every number served, and every inbound logs `mode=DISARMED` |
| `TESTER_PHONES` | env → `src/config.js` | who `POST /admin/reset-user` may reset | empty = the reset tool refuses everyone |
| `CORS_ALLOWED_ORIGINS` | env → `src/lib/cors.js` | which browser origins get an `Access-Control-Allow-Origin` | defaults to `https://cedrus.life`, `https://www.cedrus.life`; `*` refused |
| `READABLE_TABLES` / `WRITABLE_TABLE` | constants in `src/services/cos/client.js` | the eight CoS tables the brief may read; the one (`today_briefs`) it may write | not configurable; widening is an edit to the file, and Bundles 38/41 pin the export surface |
| capability vocabulary | `CHECK` on `user_capabilities.capability` | `run_agents, write_workspace, receive_brief, receive_sms` | a typo is refused at write time (`23514`); a new capability is a migration |
| binary-file allowlist | `test/no-nul-bytes.sh` | which tracked files may contain a NUL byte (three PNGs) | exact paths; never widen to a pattern |
| `RETRYABLE_READ_CODES` | `src/services/cos/client.js` | which CoS read errors are retried (`PGRST303` only) | everything else fails on the first attempt |

### 2.5 Scripts and checks an owner will use

- `sh test/run-all.sh` — the full battery. **Gate on `echo $?`, never on the banner** that prints halfway through (II.5). At `39c6d22` merged main: 59 suites, FAIL=0 (the HEAD commit message). Needs `bun` for several suites.
- `bun scripts/verify-brief-run.mjs` — post-deploy check that the 11:00 UTC run emitted the required events in order (`cos.mode → cos.delivery.mode → … → cos.brief.written`).
- `python3 scripts/verify-multiuser-state.py` — read-back of tables, policies and admin count.
- `bun scripts/load-program.mjs <file> --user-id <id> [--start …] [--horizon-days …] [--commit]` — compiles a plan; **dry run by default**; nothing is constructed without `--commit`.
- `bun scripts/hash-admin-password.mjs` — makes `ADMIN_PASSWORD_HASH`.
- `bash scripts/local-dev-supabase.sh` — brings up a local stack in Docker and then refuses to reset it (see 2.3).

### 2.6 Tools on the operator's laptop (this machine, today; VERIFIED by `command -v`)

Present: `bun`, `node`, `npm`, `railway`, `tailscale`, `python3`, `curl`, `git`. **Absent: `supabase` CLI, `docker`.** macOS 26.5.2, Apple silicon. The Mac Studio's own tool state is UNVERIFIED.

---

## 3. Accounts and who owns them

⚖ **Judgment call 3.** For install #1 every account below is Emil's. For a client install every one is created in the client's name with us added as a member, or the ownership promise in §0 is false. UNVERIFIED how long that takes; A2P registration alone is measured in days to weeks.

| Account | Used for | Owner for install #1 | Owner for a client |
|---|---|---|---|
| Supabase organisation and project(s) | the database | Emil | the client |
| Railway project `respectful-transformation`, service `cedrus-backend` | the backend | Emil | the client |
| Twilio (number, Messaging Service, A2P brand and campaign) | SMS | Emil | the client; A2P consent language is theirs |
| OpenAI | the model, until the Mac Studio proves itself | Emil | the client, or none if fully local |
| Resend, plus DNS for a sending subdomain (`updates.cedrus.life` today; root DMARC `p=reject` stays with the mailbox provider) | the brief | Emil (Porkbun DNS, Purelymail inbox) | the client's domain; UNVERIFIED alignment work |
| Tailscale tailnet | reaching the Mac Studio | Emil | the client's tailnet; we are a member device only while under contract |
| Apple ID and the Mac Studio itself | the machine | Emil | the client; hardware is a pass-through invoice |

---

## 4. The Mac Studio on the tailnet with no public ports (M8.1, M8.2)

**Every step in this section is UNVERIFIED (needs the machine).** It is written from the charter's tier rule, the amendment's hardware section, and the executor design (`docs/EXECUTOR_DESIGN_2026-09-09.md` §2). The machine: M5 Max, 128 GB, 2 TB, ordered (charter §9).

### 4.1 Placement
- Wired Ethernet, not Wi-Fi. On a small UPS if the premises lose power more than rarely.
- Somewhere it is never unplugged "to charge a phone". A machine that sleeps at 07:00 sends no brief; the deterministic fallback on Railway exists for that morning, but the executor does not.

### 4.2 macOS first boot
- One admin account for the owner. One **standard** account named `cedrus` for the daemons: no admin, no iCloud, no auto-login of a GUI session needed because the services are system LaunchDaemons (4.5).
- Apply updates, then stop letting the machine update itself on its own schedule (an unattended reboot is a missed brief).
- System Settings → Energy: never sleep, start up automatically after a power failure. Screen Sharing, Remote Login, File Sharing, AirDrop, Handoff: **off**.
- Firewall **on**, with stealth mode. It is belt and braces: the design has no listener to reach, but a firewall makes that true even if a future package adds one.
- ⚖ **Judgment call 5, FileVault.** On: a reboot stops at the pre-boot login screen until someone types a password, so an unattended power cut means no brief and no runs until a human visits. Off: the disk is readable if the box is carried away. Install #1 recommendation: **on**, with the owner's password, and accept the visit, because the roots will hold people's plans and transcripts. A client's answer depends on where the machine sits. Write the decision down either way.

### 4.3 Tailscale
- Install Tailscale, sign in to the **owner's** tailnet, and for this node **disable key expiry** so it does not silently fall off the tailnet in 180 days.
- MagicDNS on; the node gets a stable name. Every service the interface will ever reach on this machine is reached by that name.
- Access control: the tailnet ACL allows only the three people's devices (by tag or by user) to reach this node on the ports the executor will one day expose to the tailnet, which in v1 is none. Deny by default.
- `tailscale serve` (tailnet-only) is allowed if ever needed. **`tailscale funnel` is never enabled on this machine.** Funnel is the one Tailscale feature that makes a port public.
- Tailscale SSH, if the owner wants a terminal, is tailnet-only by construction and is preferable to macOS Remote Login.

### 4.4 The router
- No port forwarding to this machine. UPnP off. ⚖ **Judgment call 6:** in a client's office the router may be someone else's; get the two probe outputs in 4.6 from them, in writing, rather than assuming.

### 4.5 The two daemons, both bound to loopback
- `llama-server` (llama.cpp, via Homebrew) listening on `127.0.0.1:8080` only. Model weights in `/Users/cedrus/models/`, read-only.
- The executor daemon (`node src/executor/daemon.js`, once M8.4 builds it), running as `cedrus`, polling Supabase outbound, calling the model on loopback, holding `/Users/cedrus/roots/<account id>/` at mode 0700 (design §4.1).
- Both as `/Library/LaunchDaemons/*.plist` with `KeepAlive`, logging to `/Users/cedrus/logs/`. Neither opens a port on any interface but loopback. `lsof -iTCP -sTCP:LISTEN` after boot should list nothing bound to `0.0.0.0` or the Tailscale address except Tailscale itself.

### 4.6 The D5 probe — the only proof that §0 rule 1 is true
Do both, the same hour, and paste both outputs into this runbook when it is rewritten. One without the other proves nothing (a probe that fails against a machine that is off also "fails").

- **Public probe, must fail.** From a phone on cellular with Tailscale turned off: the home network's public IP (from the router, not from the machine) on 22, 80, 443, 8080, and the executor's future port. Expect timeouts or refusals on all. Optionally an external port-scan service against the public IP; expect no open ports.
- **Tailnet probe, must succeed.** From the same phone with Tailscale on: `tailscale ping <node name>` answers; a `curl` to `http://<node name>:8080/health` **fails** in v1 because the model is loopback-only (that failure is correct and is recorded as such); once the executor exposes a tailnet health endpoint, that one succeeds. The success half of the probe in v1 is Tailscale reachability itself.

### 4.7 The model (M8.2)
- A 70B instruct model in GGUF at Q8_0 is roughly 70 GB; the amendment's arithmetic gives ~96 GB GPU-addressable of 128 GB by default, raisable with `sysctl iogpu.wired_limit_mb`. Leave room for the executor, Postgres is **not** on this machine (amendment §7.3), and a browser.
- Measure and **write down real numbers**: tokens per second at generation, time to first token at a 4k and a 32k context, memory pressure during a run. These numbers decide the hybrid-versus-local question (consulting §13.2) and the executor's polling cadence. Expected numbers are not numbers.

---

## 5. The install, step by step

Each step: what to do, the tag, the source, and the ⚖ call if there is one.

**Step 1 — Create the database project.** UNVERIFIED (needs a fresh project). A new Supabase project has no Cedrus schema and this repository cannot create one (2.3). For install #1 the existing production project is used as-is. ⚖ **Judgment call 1:** before any client install, commit a baseline migration made from a `pg_dump --schema-only` of production, reviewed line by line, and prove `local-dev-supabase.sh` can build a database from it. Without that, every install is a copy of ours, which is the opposite of "they own it".

**Step 2 — Repair the migration history and apply the three files in order.** VERIFIED (the files, the commands, `docs/MIGRATION_PATH.md`); UNVERIFIED on any project but ours. Run each file's PRE-CHECK, apply, run its POST-CHECK, keep the output. Two of the checks are controls that must **raise** (the closed vocabulary, the append-only trigger); a migration that "succeeded" without those raises has not been shown to work (Law 3). The programs migration is unapplied as of 2026-09-09 and is the next one Emil applies (Law 5: only he applies).

**Step 3 — Deploy the backend.** VERIFIED (`railway.json`; push is deploy, ~50 s). ⚖ **Judgment call 7:** the backend is public because Twilio must reach `/sms/inbound` and because a brief must arrive without a VPN. A client who wants nothing public gives up SMS and gets the brief only over the tailnet, which means the brief is composed on the Mac Studio, which the deterministic fallback does not cover yet. Say this before they pay.

**Step 4 — Set the environment.** VERIFIED (names in 2.2). Safe initial values: `NODE_ENV=production`, `PUBLIC_BASE_URL` set, `BRIEF_DRY_RUN=true`, `COS_BRIEF_DRY_RUN=true`, `COS_BRIEF_LIVE` unset, `RESEND_API_KEY` unset, `ALLOWED_PHONES` set to the people's numbers **before** the Twilio webhook is pointed at the service, `DAILY_TOKEN_BUDGET` and `DAILY_SMS_BUDGET` set. ⚖ **Judgment call 4:** the five person-naming variables are still variables. For install #1 set `COS_USER_ID`, `COS_BRIEF_TO`, `COS_BRIEF_USAGE_USER_ID` to Emil's values, and record that the second and third person get no brief until B2.1–B2.3 land. A client install after P1.4 sets none of them.

**Step 5 — Verify the boot.** VERIFIED (method from II.5 and BUILD_PLAN F0.6). Three checks, each with its control:
- `GET /health` → 200 `{"ok":true,"service":"cedrus"}`; control: `GET /definitely-not-a-route` → 404. A 401 or 403 proves nothing about a mount (II.5).
- The log line `event="scheduler.started"` names all eleven jobs.
- Zero `[ERROR]` and zero `[FATAL]` tags in the first hour of logs. **Do not grep `level=error`; Railway renders levels as tags and that string can never match** (II.5, 2026-08-26).

**Step 6 — One admin, then every person through `provision_user()`.** VERIFIED (`supabase/migrations/20260909120000_provision_user.sql`, `src/services/provisioning.js`, `docs/PROVISION_USER_2026-09-09.md`). The migration grants nobody admin on purpose; **exactly one row is promoted by hand, once**, in the SQL editor, verified by a returning `SELECT`, and recorded with the date (P1.1; done for Emil 2026-08-31 as `c6cf9fb9`). Every other account, and eventually that one, is created by `provision_user(actor, phone, display_name, capabilities[], timezone)` on the service-role path, actor taken from the admin's session token. It creates no admin, records no SMS consent, and leaves `brief_enabled=false`. The admin panel that wraps it is O5.1; until then the call is made from a session on the admin's behalf. ⚖ **Judgment call 8:** for install #1 the first person's first sign-in is the real test of the SQL-created identity (unverified from any machine); a client's first person should not be the one who finds out.

**Step 7 — SMS.** VERIFIED (`src/routes/sms.js`, `src/lib/twilio.js`, `src/lib/smsAllowlist.js`); the Twilio console side UNVERIFIED. Point the number's webhook at `POST <PUBLIC_BASE_URL>/sms/inbound` and the status callback at `/sms/status`; signatures are validated against `PUBLIC_BASE_URL`. A2P registration is the client's own, with unbundled, unchecked-by-default consent language (III.4). Then two separate steps that are not the same step: add the number to `ALLOWED_PHONES` (technical), and record consent (`sms_consent_at` plus a `consent_events` row; legal). **Known gap:** a provisioned account's first text records no consent because `findOrCreateByPhone` only writes it on create (II.5, 2026-09-09); owed before a second person texts.

**Step 8 — The brief ladder, one rung at a time.** VERIFIED (`.env.example`, `src/config.js`, `src/jobs/cosDailyBrief.js`). Rung 1 arm the reader; rung 2 set the usage account so spend is counted; rung 3 dry run (real model call, no email, no writeback, no ledger claim); rung 4 writeback-only (the row appears in the app, no email); rung 5 live. Each rung announces itself in `cos.delivery.mode`. Do not skip rung 4: on the live path the email goes out **before** the writeback, so a writeback failure found on rung 5 arrives as a brief in an inbox that never appears in the app.

**Step 9 — Programs.** VERIFIED (`scripts/load-program.mjs`, `docs/PROGRAMS_2026-09-09.md`); depends on Step 2's third migration being applied. Dry-run the source, read the printed item table, then `--commit`. The same source committed twice is one revision by constraint; a changed source is a second. The two real sources for install #1 are in `~/Developer/Cedrus/_handoffs/programs/` and have not been loaded.

**Step 10 — The Mac Studio.** UNVERIFIED in full: §4 here, then M8.3–M8.6 as designed in `docs/EXECUTOR_DESIGN_2026-09-09.md`. Note M8.6 also waits on P1.3, because the digest needs each person's `user_settings.cos_user_id`, and that table is empty for everyone as of 2026-09-09.

**Step 11 — The battery, on whatever machine will run sessions.** VERIFIED. `sh test/run-all.sh; echo $?` must print `0`. A green run on a laptop is not proof about production (II.2), but a red one stops the install.

**Step 12 — Handover.** UNVERIFIED (never done). You receive: this runbook rewritten from the install log; the export path (`pg_dump` of your project, a tarball of `/Users/cedrus/roots/`, and the environment variable list with secrets redacted); the published response times for Operate; and the card in §6. ⚖ **Judgment call 9:** the export has never been rehearsed. Rehearse it during install #1 and time it.

---

## 6. When it breaks — the owner's card

- **No brief this morning.** Read the durable record before the logs (Law 10): the ledger row `cos_brief_send:<user id>:<date>` in `system_flags` (`claimed` and stuck means the send may have gone; the next tick refuses on purpose; clear that one row and it retries tomorrow), then `agent_runs` for the run's cost row, then the app's `today_briefs`. On 2026-09-01 all three said "sent" and the email was in Trash on the inbox side (II.5).
- **The brief aborted.** `cos.brief.aborted` names the table. A `42703` is a column the reader expects and CoS does not have; run `bun test/cos-schema-check.mjs` with the CoS credentials and it names the column.
- **SMS silent.** `sms.allowlist.check` in the logs says `mode=armed` or `DISARMED` and whether the number was allowlisted; a blocked number gets HTTP 200 with empty TwiML by design, so the status code tells you nothing.
- **Everything paused.** `budget.check` hourly; `mode=armed … outcome="paused"` means the kill switch tripped; raise the ceiling or wait for the UTC day to roll.
- **The Mac Studio is unreachable.** `tailscale status` on your device; on the machine, `launchctl list | grep cedrus`, the daemon log in `/Users/cedrus/logs/`, `curl 127.0.0.1:8080/health` from the machine itself. Nothing about the Mac Studio is reachable from the public internet, so "I can reach it from the office but not the café" means Tailscale is off on the phone.
- **Who to call.** Cedrus Consulting, within the published Operate response time. The export in §5 step 12 is how you stop needing to.

---

## 7. Judgment calls a stranger's business would not permit

Numbered so the timed install can strike, keep or price each one.

1. **The base schema lives only in production.** We cannot build a fresh database from the repository. Fix: a committed baseline migration from a schema dump, before install #2.
2. **Two database projects, one of them named "cedrus-dev" while being production.** History, not design. Fix: consolidate to one project (amendment §7.3) and rename it; do not move Postgres onto the Mac Studio.
3. **Every account is the founder's.** Supabase, Railway, Twilio, OpenAI, Resend, DNS, Tailscale, Apple. A client owns all of these or owns nothing.
4. **Five environment variables name a person.** Retired by P1.4 and B2.x; until then the second and third person are configured by a deploy, not a click.
5. **FileVault versus unattended reboots.** Decided per premises, in writing.
6. **The router is ours.** A client's IT provides the probe outputs.
7. **The backend is public.** Required by SMS and by a VPN-free brief; a fully private install gives up SMS and needs the brief composed locally.
8. **The first admin is promoted by hand.** Once, recorded; never a precedent. A client sees it happen and sees the audit row that follows.
9. **The export has never been rehearsed.** Rehearse and time it on install #1.
10. **The morning brief is composed by OpenAI in the cloud.** The privacy position (hybrid by default, disclosed, fully local priced higher) is owed in writing before client conversation #1, on M8.2's numbers.
11. **The brief hour is 11:00 UTC for everyone and drifts an hour across daylight-saving.** Accepted for one owner; B2.5 fixes it for three.
12. **`quota.read.failed` pages nobody.** The budget guard enforces but has no alert consumer (II.6 flag 17). A client on Operate is paying for someone to be paged.
13. **There is no staging.** Push is deploy on every repository. A client install inherits the discipline (one merge at a time, battery between, only the owner pushes) or inherits the risk.
14. **The Management API token sits in a laptop keychain.** It applied two migrations to production. For a client, the token is theirs and short-lived.
15. **The `supabase` CLI is not installed on the machine that prepares migrations.** Migrations are written blind and applied by a script; a client install should have the CLI linked to their project so `migration list` is the source of truth.
16. **A provisioned person's first text records no consent.** Closed before any second person texts (II.5, 2026-09-09).
17. **The Mac Studio's roots are protected by code, not by separate OS users** (design decision 4). Adequate for a household of three; revisited before any shared client machine.

---

## 8. Verification ledger

| Step / claim | Tag | Source |
|---|---|---|
| Service boot, health, restart policy | VERIFIED | `railway.json`, `src/index.js`, `src/routes/health.js` |
| Eleven jobs and their cron specs | VERIFIED | `src/jobs/scheduler.js`; live 2026-08-26 (II.5) |
| Fail-closed boot checks | VERIFIED | `src/config.js` `assertSecureBoot()` |
| Complete environment variable list | VERIFIED | grep of `src/` for every `env.NAME` read, this session |
| Which variables name a person | VERIFIED | `docs/SINGLETON_AUDIT_2026-08-30.md`, `src/services/programs/today.js` |
| Migration files, order, apply commands | VERIFIED | `supabase/migrations/`, `docs/MIGRATION_PATH.md` |
| Production state of each migration | VERIFIED as of 2026-09-09 | CEDRUS.md II.5 (read-only Management API query by the R6.2a session) |
| Six file-less remote versions | UNVERIFIED | `docs/MIGRATION_PATH.md` says so itself |
| Base schema reproducible from the repo | UNVERIFIED, believed false | `scripts/local-dev-supabase.sh` header; no DDL for `app_users` in the tree |
| Allowlists and their disarmed states | VERIFIED | `src/lib/smsAllowlist.js`, `src/lib/cors.js`, `src/services/cos/client.js`, `test/no-nul-bytes.sh`, the foundation migration |
| `ALLOWED_PHONES` current value | UNVERIFIED | II.5: set 2026-08-16, not re-read |
| Battery command and gate | VERIFIED | `test/run-all.sh`, II.5, HEAD commit message |
| Tools on the operator laptop | VERIFIED today | `command -v`, this session |
| Twilio webhook paths and signature source | VERIFIED | `src/routes/sms.js`, `src/routes/deliveryStatus.js`, `src/lib/twilio.js` |
| `provision_user()` behaviour and refusals | VERIFIED | the migration file, Bundle 42 report |
| First sign-in of a SQL-created identity | UNVERIFIED | `docs/PROVISION_USER_2026-09-09.md` says so |
| Brief ladder rungs and their effects | VERIFIED | `.env.example`, `src/jobs/cosDailyBrief.js` |
| Program load, dry run default | VERIFIED | `docs/PROGRAMS_2026-09-09.md`, `scripts/load-program.mjs` |
| Everything in §4 (Mac Studio, tailnet, model, probes) | UNVERIFIED | needs the machine |
| Executor behaviour | DESIGN ONLY | `docs/EXECUTOR_DESIGN_2026-09-09.md` |
| Handover and export | UNVERIFIED | never done |

---

## 9. How this draft gets rewritten

During install #1 keep one log: every step, its start and end time, the tag it turned out to deserve, and the judgment call it raised. When it is over:

- every UNVERIFIED line in §4 and §5 becomes either VERIFIED with the observed output pasted in, or a finding with a task in `docs/BUILD_PLAN.md`;
- every ⚖ in §7 becomes a decision with a date, a price, or a strike-through;
- the hours go into consulting §8's labour line. The first install may take sixty hours. If the fifth is not near twenty-five, the skills are not reusable and this is hourly work.

Until then this is a draft, and it says so at the top.
