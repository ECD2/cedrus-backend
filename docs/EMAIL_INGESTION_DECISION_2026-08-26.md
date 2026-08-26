# Email ingestion into Chief of Staff — a decision for Emil

**2026-08-26 · written by an overnight session · NO CODE WAS WRITTEN · nothing was applied**

This memo prepares a decision. **It does not make it.** Master §7 says the `sync_mode` question is
"Unresolved. Settle it deliberately before building ingestion," and §9 puts "solve email ingestion
properly, which means settling the `sync_mode` question first" third in the build sequence. That is
still where it sits.

Read this, pick (a), (b) or (c) in §9, and a build session can start from there.

---

## 0. What this memo rests on, and what it does not

| Source | Reached | Status |
|---|---|---|
| CoS migration `20260714210000_email_ingestion.sql` | read in full | **file** — describes intent at authoring time |
| CoS `supabase/functions/email-sync/index.ts` | read | file |
| CoS `src/lib/email-inbox.ts`, `src/routes/_authenticated/app.inbox.tsx` | read | file |
| `cedrus-backend/src/services/cos/client.js`, `reader.js` | read in full | file |
| Railway log dumps 2026-08-24 → 2026-08-26 | read | **observation** |
| Gmail brief bodies 08-24 / 08-25 (via the 08-26 live-state check) | quoted second-hand | observation |
| **The live CoS database** | **NOT reached** | needs `railway variables` / a Supabase read, both out of scope tonight |

**The most important caveat, and it is Lesson 2 verbatim: a migration file is not evidence about a
database.** Everything in §2 below is what the *file* says. The live constraint has never been read
by anyone, on any session. §8 says how to close that in one command before anything is applied.

**The CoS clone is current.** Fetched tonight: `origin/main` = `c57c6e0`, dated **2026-07-16**,
byte-identical to the local checkout, one branch on the remote, no migration newer than
`20260716150000`. **Lovable has changed nothing in Chief of Staff in 41 days**, so this memo is not
reasoning from a stale clone — which the 08-26 live-state check flagged as a real risk, since the
clone had last been fetched on 07-16 and nobody had checked. (It can still have been changed
*outside* the repo, through Lovable's own tooling. Same caveat, one level down.)

---

## 1. The question in one line

Chief of Staff's `email_sources.sync_mode` is CHECK-constrained so that `'manual'` is the only
value that can exist. If Cedrus ingests email into CoS, **either that constraint changes, or CoS's
own inbox UI will label Cedrus's work "manual sync only" — which is false.**

---

## 2. The constraint, as verified in the migration

```sql
-- supabase/migrations/20260714210000_email_ingestion.sql
create table public.email_sources (
  ...
  -- Forward-only: manual is the only mode that exists. Scheduled sync would
  -- need a new migration and its own approval.
  sync_mode text not null default 'manual'
    check (sync_mode = 'manual'),
  ...
  -- One row per mailbox per owner.
  unique (user_id, mailbox_address)
);
```

Two separate locks, and they close different doors:

1. **`check (sync_mode = 'manual')`** — not an enum with one member; an equality check. No row can
   ever say anything else. The comment states the intent plainly: this was **deliberate and
   forward-only**, and a second mode was always expected to need its own migration and its own
   approval. **This is a design decision to be revised, not a bug to be fixed.**
2. **`unique (user_id, mailbox_address)`** — one source row per mailbox per owner. So "just add a
   second source row for the same mailbox" is not available. That is what makes Option 2 in §5
   require a *different* address, not merely a different row.

### The behavioural evidence, which points the same way

The constraint is a file. The behaviour is an observation, and the two agree:

- **08-24 run:** `email selection capped: 20 of 53 eligible messages considered`
- **08-25 run:** `email selection capped: 20 of 53 eligible messages considered`
- **08-26 run (today, 11:00 UTC):** `email selection capped: 20 of 53 eligible messages considered`

**Three consecutive days, the eligible pool flat at 53**, while the "oldest unreviewed" age aged
exactly one day per day (4 → 5 days across 08-24/08-25 per the brief bodies). A mailbox that is
receiving mail and a database that is not growing is precisely what manual-only sync looks like.
Nothing has been pulled into CoS since someone last clicked.

**And the click is the only trigger.** `src/lib/email-inbox.ts:63` is the sole invocation:

```ts
const { data, error } = await supabase.functions.invoke("email-sync", { body: {} });
```

No cron, no scheduled trigger, no webhook. Master §8's "email is flowing in and producing nothing"
describes a *mailbox* that fills. The *database* fills only on demand.

---

## 3. What the CHECK does NOT do — and this is the crux of the whole decision

**The constraint does not stop Cedrus from writing.** It constrains one column on one row in
`email_sources`. `email_messages` has no `sync_mode` at all.

So a Cedrus that inserted into `email_messages` today would succeed — under a source row whose
label says a human did it. **The constraint is not a lock on the door; it is a sign on the door.**
Removing the sign does not open anything, and leaving it up does not keep anything out. What it
governs is whether CoS's record of its own history is true.

That reframes every option below. The question is **not** "how do we get permission to write." It
is **"when Cedrus writes, what will the record say happened?"**

---

## 4. Option 1 — relax the CHECK to `('manual','cedrus')`

**The SQL.** Constraint names are generated by Postgres and this one is unnamed in the migration,
so the real name **must be read live before anything is applied** (§8):

```sql
-- Read the ACTUAL name first. Do not guess it, and do not assume the
-- conventional name — this constraint was declared inline and unnamed.
--   select conname from pg_constraint
--    where conrelid = 'public.email_sources'::regclass and contype = 'c';
-- Expected shape: email_sources_sync_mode_check

alter table public.email_sources
  drop constraint email_sources_sync_mode_check;      -- <- the name READ ABOVE

alter table public.email_sources
  add constraint email_sources_sync_mode_check
  check (sync_mode in ('manual', 'cedrus'));
```

Additive in effect: `'manual'` stays legal, every existing row stays valid, nothing is rewritten.
**It widens what may be said; it changes no row and no behaviour.**

**The UI change that must ship with it.** `src/routes/_authenticated/app.inbox.tsx:717`:

```tsx
{source.folder_allowlist.join(", ")} · {source.sync_mode} sync only
```

That interpolates the column, so a `'cedrus'` row would render **"cedrus sync only"** — grammatical
noise. The label needs an explicit mapping (`manual` → "manual sync only", `cedrus` → "synced by
Cedrus"). **Shipping the migration without the label change trades a false statement for an
incoherent one.**

**This is a CoS migration, and CoS migrations are reserved.** It belongs to the Lovable-managed
repo, not to `cedrus-backend`. It needs its own approval and its own path.

**The thing to be clear-eyed about:** this does **not** make Chief of Staff act. CoS's refusal to
act autonomously is deliberate (master §10, first line) and this preserves it exactly. CoS still
does nothing on its own; it merely gains the vocabulary to **record truthfully that Cedrus did**.
The row still describes a sync that something else performed.

**Cost:** one CoS migration, one label change, plus the §6 build. **Risk:** low — additive, no data
rewritten, reversible by re-tightening the CHECK if no `'cedrus'` row exists yet.

---

## 5. Option 2 — a second source row under a different mailbox address

`unique (user_id, mailbox_address)` blocks a second row for the same mailbox, so this option
requires Cedrus to claim a **different address** — a second intake mailbox that exists only to give
Cedrus a row to write under.

**This is false provenance and it should be rejected.** The `email_sources` row is a claim about
*where mail came from*. Two rows for what is really one mailbox would make `source_mailbox`,
`original_recipient` and the `email_sources_user_idx` grouping describe a mail topology that does
not exist. Every downstream count would silently double-count a mailbox, and the deception is
*structural* — it lives in the schema, where nobody rereads it, rather than in a label somebody
might notice.

It also fails the project's own rule: **"do not present a simulated connector as connected"**
(master §10). Inventing a mailbox to satisfy a constraint is that rule pointed at the database
instead of the UI. **Not recommended.**

---

## 6. Option 3 — accept the "manual sync only" label

Change nothing; let Cedrus write under the existing `'manual'` row.

**This is the cheapest option and it is a lie in the UI.** The inbox would tell Emil, in his own
product, that he synced mail he did not sync. It is a small lie today and it compounds: the moment
anyone asks "when did this arrive and who pulled it in?", the answer the database gives is wrong,
and the sentence looks internally consistent, so nothing prompts a second look.

That is the exact failure shape II.5 recorded this week about the truncation note — a bare age
beside two hedged counts, where "the sentence looked internally consistent, which is worse than
either hedging or not." **Not recommended.**

---

## 7. What Cedrus has to build — under ANY option

Choosing (a), (b) or (c) does not shrink this list. It is the same work in every case; only the
label differs.

### 7.1 A second pinned verb, with a FROZEN table

Today `src/services/cos/client.js` exposes exactly one write, and its shape is the thing to copy:

```js
export const WRITABLE_TABLE = 'today_briefs';        // a CONSTANT, not a parameter
export async function cosInsertTodayBrief(row, { env = process.env } = {}) { … }
```

The new verb must be `cosInsertEmailMessage(row)` with `WRITABLE_TABLES` frozen to
`['today_briefs', 'email_messages']` — **and never a table parameter.** The moment the table is an
argument, the guarantee "this module cannot write anywhere else" becomes "this module cannot write
anywhere else *unless someone passes a different string*", which is not a guarantee. Bundle 38
already asserts the module's export surface has no second write verb; that assertion must be
**updated deliberately**, not deleted, and must then pin *two* verbs and no more.

### 7.2 The IMAP client, ported with its gate intact

CoS's `email-sync/index.ts` opens the mailbox with **EXAMINE** (read-only) and routes every command
through a single `guardedExec` allowlist, with a dedicated error category
(`read_only_unavailable`) for a server that will not honour read-only. **That gate is the feature,
not scaffolding around it.** A port that keeps the parsing and drops the allowlist has kept the
easy half. The port must carry:

- EXAMINE, never SELECT
- the single choke point — every command through one guarded function, the same reason
  `sendSms()` is a choke point rather than a check per call site
- the forbidden-verb refusal, with a test that drives a *refused* verb (Lesson 19: a guard whose
  failing branch no test exercises is live but unfalsified)
- **no credentials in any transcript or table.** CoS keeps IMAP host/port/user/password in Edge
  Function secrets and stores none of them. Cedrus must do the same, in Railway variables.

### 7.3 The normalization port, and the fixture-corpus diff

This is where Lesson 20 will bite if it is going to. Two normalizers over one mailbox will diverge,
and the divergence will be invisible: both produce plausible text.

**The test that catches it is a byte-for-byte diff of Cedrus's normalizer output against CoS's own
output over a shared fixture corpus.** Not a spot check, not "looks right" — byte-for-byte, on a
corpus that includes the awkward cases (multipart, quoted-printable, non-UTF-8 charsets, HTML-only
bodies, empty bodies, 2000-char excerpt boundary, 500-char subject boundary). **Something in the
battery must read CoS's own description of itself**, exactly as `test/cos-schema-check.mjs` does
for the reader.

### 7.4 The cursor-collision hazard — the one that silently loses mail

`email_sources.last_seen_uid` is a **single cursor on a single row**, and it was designed for a
single writer. Two writers advancing one cursor **skip messages**: Cedrus reads to UID 900 and
writes 900; the human clicks sync, reads from 900, and every message between the human's last
position and 900 is never examined by anyone. **Nothing throws. Nothing logs. The mail is simply
never ingested**, and the only symptom is a count that is quietly too low — the same shape as the
unreviewed-count bug fixed on 2026-08-26, which also stopped growing without saying so.

Two ways out, and this is a real design choice:

- **A separate cursor column per writer** (`last_seen_uid_cedrus`), so the two never interact.
  Simple, additive, no locking, and it makes "who has seen what" legible. **Preferred.**
- **A Postgres advisory lock** around read-then-advance, so only one writer holds the cursor at a
  time. Correct, but it serialises a human click behind a cron and fails in the direction of a
  confusing UI stall.

Whichever is chosen, **`uid_validity` must be re-checked on every run**, not cached. The schema
comment is explicit: if the server changes the generation, the cursor is meaningless and sync must
re-anchor rather than trust stale UIDs.

### 7.5 The two dedupe indexes — the safety net, not the plan

```sql
unique (email_source_id, uid_validity, provider_uid)                 -- primary
create unique index email_messages_message_id_key
  on public.email_messages (email_source_id, internet_message_id)
  where internet_message_id is not null;                             -- secondary
```

These will catch a genuine double-insert as a `23505`, which the ledger's `claimSend()` already
demonstrates handling correctly. **But they are a net, not a design.** Note the partial predicate:
the Message-ID index only applies `where internet_message_id is not null`, so a sender that omits
Message-ID falls through to the primary key alone — and the primary key is scoped to
`email_source_id`, so **the same logical message ingested under two different source rows would
NOT be caught by either index.** That is one more reason Option 2 is worse than it looks.

### 7.6 Four column-level truths that must not be assumed

- **`normalization_version` must be truthful, and there are TWO stages, not one.** Migration
  `20260715220000_email_provenance.sql` exists because a single label was being stamped from the
  *analyzer's* compile-time constant, so a row normalized by v1 and analyzed by a v2-era analyzer
  recorded `email_norm_v2` — and the claim that provenance "stays auditable" was **false**. The
  model is now two independently versioned stages: `email_messages.normalization_version` (which
  ingestion pipeline produced the stored text) and `email_ai_analyses.analysis_input_version`.
  **A Cedrus port is a NEW ingestion pipeline and must stamp its own version**, not reuse CoS's.
  Reusing it would re-create the exact defect that migration was written to fix — and this time
  there would be rows written under the defective semantics, which there were not before.
- **`received_at` is NULLABLE in CoS's schema** (`received_at timestamptz`, no NOT NULL). The
  design intent stated for this work is that Cedrus must never write a null there — but **that is
  a Cedrus-side discipline, not a database guarantee**, so it needs an assertion in Cedrus's own
  code and a test, not a reliance on the column. Worth noting the index
  `email_messages_user_received_idx (user_id, received_at desc)` sorts NULLs FIRST on DESC in
  Postgres — the same trap the `getOpenGoals` `week_of` note records — so a single null row would
  sort to the top of the newest-first ranking the brief's selector depends on.
- **`is_demo boolean not null default false`** exists on both tables. Cedrus must write `false`
  explicitly and every read path must filter on it, or demo rows enter the real brief.
- **`owner_review_status` defaults to `'unreviewed'`**, which is the exact status the brief's
  unreviewed count keys on (`UNREVIEWED_ACTION_STATUS`, exported by `reader.js` and imported by
  `compose.js` precisely so the two ends cannot drift). **Every message Cedrus ingests lands in the
  unreviewed count.** Ingesting a large backlog will move that number a long way in one run, and
  the brief will say so. That is correct behaviour and it should be expected, not treated as a bug
  when it happens.

### 7.7 The feedback loop — and a precondition this session cannot verify

Cedrus's own briefs are emailed **from `brief@updates.cedrus.life`**. If Gmail forwards them into
the intake mailbox, Cedrus ingests its own briefs, they become records, and the next brief cites
them. A model summarising its own summaries is a loop with no fixed point and no error message.

**The precondition is a Gmail filter excluding `updates.cedrus.life` from forwarding.** That lives
in Emil's Gmail settings. **It could not be verified from this session** and must be confirmed
before the first ingestion run — not after. A belt-and-braces sender-address exclusion should be
built on the Cedrus side too, because a filter is one checkbox away from being switched off by
someone who does not know what it is load-bearing for.

---

## 8. Before anything is applied — the live reads that are owed

Every claim in §2 is from a file. **Run these first; they are cheap and one of them could change
the recommendation.**

1. **The real constraint name and definition.**
   `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.email_sources'::regclass and contype = 'c';`
2. **Whether the CHECK is even still there** — Lovable Cloud can alter the database outside the
   repo, and this clone proves only what the repo says.
3. **The live shape of `email_messages`**, via `test/cos-schema-check.mjs`, which reads PostgREST's
   own OpenAPI document. **It could not run tonight** — no `COS_` credentials without
   `railway variables` / `railway run`, both forbidden this session. Without them it announces a
   skip and exits 0 by design, so running it here would have proved nothing. It was not faked.
4. **The current `email_sources` row(s):** how many, which mailbox, what `last_seen_uid` and
   `uid_validity`, and whether `status` is `'active'`.

---

## 9. Recommendation — and it is a recommendation, not a decision

**Take Option 1: relax the CHECK to `('manual','cedrus')`, and ship the inbox label change with
it.**

Because the constraint is a sign and not a lock (§3), the real choice is only ever between
**recording what happened** and **recording something else**. Option 2 puts the untruth in the
schema, where nobody rereads it. Option 3 puts it in the UI, where Emil reads it. Option 1 is the
only one where the database ends up saying what actually occurred — and it costs one additive,
reversible migration.

It also does the least violence to the original design. That comment — *"manual is the only mode
that exists. Scheduled sync would need a new migration and its own approval"* — is not a wall. It
is an instruction for exactly this moment: a new mode, a new migration, an explicit approval.
Option 1 follows it. Options 2 and 3 route around it.

**Costs, honestly:**

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| CoS migration | 1, additive, reversible | 0 | 0 |
| CoS UI change | 1 (the label map) | 0 | 0 |
| Cedrus build (§7) | full | full | full |
| Record is true | **yes** | no — schema-level | no — UI-level |
| Reversible | yes, while no `'cedrus'` row exists | no — a fake mailbox persists | n/a |
| Violates a stated rule | no | **yes** (master §10) | **yes** (§10) |

**What I did NOT decide, and deliberately left to Emil:** whether to do this at all. Master §9 puts
ingestion third, after making V8 truthful locally and unifying the domain model, and there is a
real argument for leaving email alone until the interface work lands — the brief's daily complaint
is that the workspace has no next actions, and more email does not supply next actions. **Relaxing
the constraint is cheap and can be done independently of building the ingestion.** Doing the
constraint now and the build later is a legitimate third path.

---

## 10. Test plan and mutation list, for whoever builds §7

**Tests** — a new bundle (claim the number with
`grep -rhoE 'Bundle [0-9]+' test/*.sh | sort -u`, and check every rig, not just `run-tests.sh`):

1. `cosInsertEmailMessage` refuses every table but `email_messages` — driven with a refused table,
   not only a permitted one.
2. The client's export surface carries **exactly two** write verbs. Assert on exported data, not a
   source grep (II.5's corollary on pins: a textual pin cannot tell a code reference from prose).
3. The IMAP port refuses a forbidden verb, and refuses SELECT specifically, with a test that
   *drives* the refusal.
4. Normalizer output is **byte-identical** to CoS's over the fixture corpus, with a guard that
   fails if the corpus is empty (Lesson 3: a vacuously-true comparison).
5. Two concurrent writers do not skip a UID range — drive the real cursor logic, assert every UID
   in the range is accounted for by exactly one writer.
6. A duplicate insert raises `23505` and is handled, for both indexes, including the
   Message-ID-absent case that falls through to the primary key alone.
7. `received_at` null is refused before the insert; `is_demo:false` is written explicitly;
   `normalization_version` is Cedrus's own, not CoS's.
8. A brief-sender address is excluded from ingestion (the §7.7 loop), with a control proving a
   non-brief sender IS ingested.

**Mutations** — each must turn the suite RED, then restore byte-identically by checksum:

- `WRITABLE_TABLES` accepts a table parameter → RED
- the forbidden-verb gate always allows → RED
- EXAMINE becomes SELECT → RED
- the normalizer diff compares lengths instead of bytes → RED
- the cursor advances without the per-writer separation → RED
- the `uid_validity` re-check is removed (a cached generation) → RED
- the `is_demo` filter is dropped from a read path → RED
- the brief-sender exclusion always returns false → RED
- `normalization_version` is stamped from CoS's constant → RED

---

## 11. The arming ladder — four rungs, and no rehearsal records a delivery

The same shape that took the daily brief from disarmed to live, and for the same reason: **"never
let a rehearsal record a delivery"** (master §6). A dry run that writes real rows corrupts the exact
records you would use to answer what was actually ingested.

| Rung | What runs | What is written | How you know it worked |
|---|---|---|---|
| **1. Read-only** | IMAP connect, EXAMINE, fetch, normalize | **nothing** | a log line with counts and the normalizer's own hash; the mailbox's `uid_validity` and cursor are *read* and not advanced |
| **2. Diff-only** | rung 1 + compare against what CoS already has | **nothing** | a report naming rows Cedrus would have inserted and rows already present — this is where a normalization divergence surfaces, before any row exists |
| **3. Writeback-only** | rung 2 + insert into `email_messages` | **rows, cursor NOT advanced** | rows appear in the CoS inbox; a second run re-proposes the same rows and is refused by the dedupe indexes, which proves the net works on real data |
| **4. Live** | rung 3 + advance the cursor | rows **and** cursor | steady state |

**The cursor advance is deliberately the LAST thing armed**, because it is the only irreversible
step: rows can be deleted, a skipped UID range cannot be recovered without re-anchoring the whole
mailbox. Rungs 1 and 2 write nothing at all, so they can run against production safely and
repeatedly. Rung 3 writes rows but leaves the cursor where it was, so a human sync still covers the
same ground and nothing is lost if rung 3 is wrong.

**No rung may set `last_successful_sync_at`, `last_attempt_at`, or `sync_mode = 'cedrus'` until
rung 4.** Those three columns are the record of what happened; a rehearsal that stamps them makes
the record describe a sync nobody performed — which is the same untruth this whole memo exists to
avoid, arriving through the back door.
