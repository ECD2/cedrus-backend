# ENTITY_RESOLUTION_V2 — smarter person resolution + "ask me first" dedup over SMS

**Status:** DESIGN ONLY. No implementation in this document. This is the plan; the code
change is a separate PR.

**Why now.** A live dogfood test (Emil, 2026-07-23) sent three texts in one minute:

| text | intended person | what happened |
|---|---|---|
| "Grabbed dinner with **Luca** last night — adopted a dog named Miso" | brother Luca (known) | correct: fact added to Luca |
| "**Luka**'s thinking about moving to Austin next year" | brother Luca (typo) | merged into Luca (defensible) |
| "Met a guy named **Lucas** at a work event, might collaborate" | a NEW person | **WRONG: silently merged into brother Luca** |

All three collapsed onto the single existing `Luca` row. The third is a wrong-person merge —
the failure `people.js:8-12` explicitly calls "the worst failure for a memory product."
Separately, "Quin's birthday is November 12th" was acknowledged but **never populated
`people.birthday_month/day`** — it landed only as a `reminders` row, so the insight and
discovery engines (which read the person columns) never see it.

This document specifies (1) confidence bands that stop the false merge, (2) an ask-first
clarification loop over SMS for the genuinely-ambiguous case, (3) same-first-name
disambiguation, and (4) the birthday-routing fix — all compliant with the VOICE and SAFETY
specs, and all keeping merge + safety logic in one place.

---

## 0. Today's flow and the two defects

Inbound path (unchanged parts stay unchanged):

```
routes/sms.js  →  pipeline/index.js:runInboundPipeline
  B1 identify (users.findOrCreateByPhone)
  B4 logInbound (idempotent on MessageSid)
  B2 compliance (STOP/START/HELP short-circuit)
     onboarding / fresh-start
  B3 rate limit
  C  understand()          ← Priority-0 SAFETY runs FIRST, inside here
  D  resolveEntities()  →  persist()
  E  reply = parsed.reply  →  TwiML <Message> (ONE reply per turn)
```

**Defect 1 — the merge (fix in §1).** `pipeline/06_resolveEntities.js:18-27`: when the model
returns `resolution:"new"`, a `people.fuzzyFind` backstop runs and **any** score `>= 0.6`
silently merges. `people.js:77-92` scores an exact name/alias as `1.0` and a **bare substring
(≥3 chars) as `0.7`**. `"lucas".includes("luca")` is true → 0.7 ≥ 0.6 → silent merge. So a
confident-new mention is overridden by a weak substring hit, with no regard to the "met a guy
named…" new-person phrasing. (The backstop comment says its purpose is "catches Mike/Michael"
— but Mike/Michael is a *nickname*, not a substring, so the rule does not even deliver its
stated benefit; it only produces false merges.) The `ambiguous` branch (`:31-35`) exists but
just "picks the first candidate" with a `TODO: optionally open a confirm prompt` — never asks.

**Defect 2 — the birthday (fix in §4).** `prompts/extraction.system.txt:157` tells the model
"A birthday mentioned belongs on the person," but the JSON OUTPUT SHAPE has **no structured
birthday field** — only `reminders[].reminder_type:"birthday"`. So the model files birthdays
as reminders. And `pipeline/07_persist.js` has **no writer** for `people.birthday_month/day`.
Result: `reminders` gets a row; the person columns the engines read stay null.

---

## 1. Confidence bands — when to merge, create, or ASK

### 1.1 Inputs to the decision (all already available or cheaply derived)

- **Model signals** (already emitted, `extraction.system.txt:22-34`): `resolution ∈
  {existing, self, new, ambiguous}`, `person_id`, `candidate_ids[]`, `proposed_name`,
  `confidence ∈ [0,1]`.
- **Refined match** — `fuzzyFind` upgraded to return a *kind*, not just a scalar:
  `exact_name | exact_alias | nickname | partial_substring | none` (see §1.4).
- **New-person phrasing cue** — a deterministic boolean over `mention_text` + the message
  (see Appendix C). "met a guy named X", "someone named X", "a coworker named X", a stated
  surname/initial that differs from every same-first-name known person, etc.
- **Owned-candidate check** — any `person_id`/candidate must satisfy `(user_id, person_id)`
  exists for THIS user before it can be a merge target (the WS-A cross-tenant guard).

### 1.2 The three bands

**(a) CONFIDENT-EXISTING → silent merge.** No question. Use the resolved `person_id`.
Fires when *any* of:
- `resolution ∈ {existing, self}` with an **owned** `person_id` AND `confidence ≥ 0.70`; or
- refined match is `exact_name` / `exact_alias` / curated `nickname`, there is exactly **one**
  such candidate, AND **no new-person cue** is present.

**(b) CONFIDENT-NEW → silent create.** No question. Create the person (with §3 disambiguation
if the first name collides). Fires when *any* of:
- `resolution == new` AND refined match is `none`; or
- `resolution == new` AND refined match is only `partial_substring` **AND a new-person cue is
  present** ← *this is the Lucas fix*; or
- a stated surname/initial conflicts with every same-first-name candidate (clearly distinct).

**(c) AMBIGUOUS → ASK (hold the write, §2).** Fires when *any* of:
- `resolution == ambiguous` (the model surfaced `candidate_ids`); or
- `resolution == new` AND refined match is `partial_substring` **AND no new-person cue** (a
  genuine "could be the same Luca, could be new"); or
- `resolution == existing` but `confidence < 0.70` with ≥1 alternative candidate; or
- **two or more owned people share the mention's first name** and the mention carries no
  disambiguator ("text Luca" when there are two Lucas → which one?).

### 1.3 The explicit rule changes (the fix, stated as diffs-in-prose)

1. **Delete the `>= 0.6 ⇒ merge` rule** in `06_resolveEntities.js`. A merge may be *automatic*
   only at `exact_name | exact_alias | nickname`. 
2. **A bare `partial_substring` never auto-merges.** It routes to **CONFIDENT-NEW** when a
   new-person cue is present, otherwise to **ASK**. It is never silent-merge.
3. **New-person phrasing outranks a weak match.** If a new-person cue is present, the mention
   is at most ASK and defaults to CREATE; it is never silently merged into a same-ish name.
4. **Merge targets must be owned.** Verify `(user_id, person_id)` before any merge (guards a
   model-hallucinated or foreign id).
5. **Confidence floor for a model "existing".** Below `0.70` with alternatives → ASK, not a
   silent trust of the model's id.

Applied to today's case: "Met a guy named Lucas at a work event" → `resolution:"new"`,
match `partial_substring` (Luca⊂Lucas), **new-person cue present** ("met a guy named … at a …
event") → **CONFIDENT-NEW → create "Lucas" as a separate person.** No merge, no question.
"Luka's thinking about moving to Austin" → no cue, `partial_substring` is false (neither
string contains the other) so match is `none`/`nickname` at best → the model's `existing`
(if confident) merges, else ASK. Either way the brother is never contaminated by "Lucas".

### 1.4 `fuzzyFind` refinement (people.js)

Return `{ kind, score, personId, candidates[] }` where:

| kind | when | score | auto-merge? |
|---|---|---|---|
| `exact_name` | normalized name equals | 1.0 | yes (if no cue, single) |
| `exact_alias` | normalized alias equals | 1.0 | yes (if no cue, single) |
| `nickname` | curated equivalence table (Mike↔Michael, Alex↔Alexander, …) | 0.9 | yes (if no cue, single) |
| `partial_substring` | one name contains the other, ≥3 chars | 0.5 | **no** — ASK or (cue) CREATE |
| `none` | no match | 0 | n/a → CREATE |

The **curated nickname table** replaces the substring rule for the "Mike/Michael" intent the
backstop actually wanted. Surname/initial tokens are indexed so a future "Luca N." resolves to
the right person, and a bare "Luca" when two exist yields `candidates=[…]` → ASK (§3).

---

## 2. Ask-first clarification loop over SMS

**This aligns with the house rule; it does not fight it.** The "guess + let the user correct,
rather than interrogate" phrase in `06_resolveEntities.js:32` is not verbatim in any spec — it
is an assembly, and the real, spec-stated house rule is two-sided by confidence:

- **Confident → propose, don't announce, let the user correct.** (`cedrus-sms-voice.md §5`
  "Propose, never announce"; VOICE §3.1 "Acknowledge, then do the task.")
- **Low-confidence / ambiguous → ask exactly one question.**
  (`session4-consumer-interface/CAPTURE_AND_CONVERSATION_UX.md §5`: "Cedrus asks one question
  rather than guessing (never guess silently; never stack questions)";
  `session6-privacy-trust/USER_TRUST_UX.md`: "anything below the confidence floor asks instead
  of asserting (house pattern)".)

So bands (a)/(b) keep proposing silently; band (c) asks exactly one question. The one-question
discipline is itself a hard rule — `PROGRESSIVE_PROFILING_DESIGN.md §2` "Never stacks: one
question per message, never two"; `cedrus-sms-voice.md §2` "Questions earn their place, never
filler"; `PROGRESSIVE_PROFILING_DESIGN.md §1` "Silence is always a valid response". The only
thing missing today is that this ask-vs-guess pattern is **specced and built for the web
surfaces only** (People add, Capture, Import review); **there is no SMS-channel "same person?"
flow** (confirmed gap). This design extends the existing pattern to SMS, reusing its copy.

### 2.1 Where the state lives — `pending_clarifications` (new table, migration in §5)

We **hold** the write instead of guessing. Confident parts of the same message persist
immediately; only the ambiguous mention's writes are held. Columns (described, not DDL):

| column | purpose |
|---|---|
| `id` | pk |
| `user_id` | ownership scope (every read/write filtered by it) |
| `status` | `pending` (queued) · `active` (question outstanding) · `resolved` · `expired` · `cancelled` |
| `kind` | `person_dedup` (extensible to other confirmations later) |
| `mention_text`, `proposed_name`, `proposed_relationship` | the new mention as parsed |
| `candidate_person_ids` (uuid[]) | the owned existing person(s) it might be |
| `held_payload` (jsonb) | the facts / saved_items / reminders / goals / birthday / contact-signal that reference this mention, plus `source_message_id` — applied verbatim on resolution |
| `question_text` | the exact authored question we sent |
| `asked_message_id`, `answered_message_id` | audit links to `messages` |
| `reask_count` (int, cap 1) | how many gentle re-asks used |
| `created_at`, `activated_at`, `expires_at`, `resolved_at` | lifecycle timestamps |
| `resolution` | `same` · `different` · `expired_default_new` · `cancelled` |
| `resolved_person_id` | the person the held write was applied to |

**One active question per user** — enforced by a partial unique index on `(user_id) WHERE
status='active'`. Extra ambiguous mentions queue as `pending` (FIFO). We never send two dedup
questions at once; the SMS thread stays clean.

### 2.2 How the inbound router dispatches (index.js), revised

```
… identify / dup / compliance / onboarding / rate-limit  (unchanged)
buildContext(user)  → now ALSO loads the user's ACTIVE clarification
                       (its question + candidate names) into model context
understand()        → Priority-0 SAFETY FIRST (unchanged)
  ├─ crisis/boundary override?  → return the fixed template.
  │                               DO NOT touch pending_clarifications.   ← safety bypass
  └─ not crisis:
       STEP 1  If an ACTIVE clarification exists, interpret THIS message as its answer
               (model's new `clarification_answer` field, deterministic backstop).
                 same      → apply held_payload to the chosen candidate; add the new
                            spelling as an alias; mark resolved('same').
                 different → create the new person (+ §3 disambiguation); apply
                            held_payload; record the pair as not-duplicate (§2.5);
                            mark resolved('different').
                 unclear + message is unrelated/new → process the new message normally;
                            leave clarification active; ONE gentle re-ask if reask_count<1.
                 unclear + engaging → re-ask once (reask_count++), do not resolve.
       STEP 2  Run resolveEntities() with the §1 bands on THIS message.
                 (a)/(b) → persist now, as today.
                 (c) ASK → persist the CONFIDENT parts now; HOLD the ambiguous mention's
                          writes into a pending_clarifications row.
                          If no active clarification → mark it active, this turn's reply IS
                          the authored question. Else enqueue as pending (ask later).
       STEP 3  Compose reply (see §2.4), return via TwiML.
```

Because answer-interpretation (STEP 1) sits **after** `understand()` and is skipped whenever
`parsed._suppressPersistence` is set, a crisis/boundary message is **structurally incapable**
of resolving or consuming a pending clarification. This is the central safety invariant.

### 2.3 Required edge cases

- **Safety / crisis bypasses pending state entirely (critical).** A crisis or substance-boundary
  message returns the fixed template and returns *before* STEP 1. The active clarification is
  left untouched — not consumed, not resolved, not expired, never treated as "same/different".
  This holds for both the deterministic gate (`evaluateSafety`, `safetyDetection.js:341`) and
  the model second-net (`understand()` band === 'crisis', `05_understand.js:93-107`). On a
  crisis turn the current code sets `_suppressPersistence` and writes **no product content**;
  crisis content is segregated per SAFETY §7 (segregation + no briefs/analytics — *not* a
  blanket no-persistence guarantee; the detection event itself may be logged for audit). The
  resolution stage additionally asserts `!parsed._suppressPersistence` before touching state
  (belt-and-suspenders). Safety logic is **not** re-implemented here — it stays in
  `safetyDetection.js` + `understand()`; we only gate on their result.
  **Spec gap being filled (flag for Emil):** the SAFETY spec short-circuits *reply generation*
  but says nothing about an open confirmation hold when crisis fires mid-flow. This design
  decides: leave the held clarification intact and untouched. Recommend adding this rule to
  `CEDRUS_SAFETY_AND_CRISIS_ESCALATION_SPEC.md` so it is specced, not just implemented.
- **Reply unrelated / ignored.** The user ignores the question and says something new. The new
  message is processed normally (STEP 2). The clarification stays active; we re-ask **at most
  once** (a single low-pressure clause appended to that turn's reply), then leave it to expiry.
  Never badger.
- **Timeout / expiry.** A sweep job (§5, sibling of `dailySweeps.js`, every ~15 min) finds
  `active|pending` rows past `expires_at` and resolves them to **`expired_default_new`**:
  create the person + apply `held_payload`, then activate the next queued item. **Default is
  CREATE, never a guessed merge** — a duplicate is cheaply mergeable later; a wrong merge
  silently corrupts. Optionally one brief factual note ("I saved Lucas as someone new; tell me
  if that's wrong"). This sweep is an ordinary factual task, so the §6 promo-suppression window
  does **not** pause it (mirrors how `dailySweeps.js:25-32` keeps goal follow-ups and birthday
  alerts flowing while pausing only the playful layer).
- **Multiple pending.** Only one `active` at a time (partial unique index). Two ambiguous
  mentions in one message → ask the first, queue the second; ask it after the first resolves or
  expires. (Batching two into one question is possible but off by default; see §7.)
- **Sensitive / negative turn.** If THIS message's band is `sensitive_neutral | negative`,
  **do not ask this turn.** Hold the write silently and let a later routine turn or the expiry
  sweep resolve it. Asking a bookkeeping question mid-heavy-disclosure violates the empathy
  grammar (open-door only, no prying — VOICE spec §5). ASK is emitted only on `routine |
  positive` turns.

### 2.4 The question surface — authored in code, voice-compliant

This is a **new outbound-SMS surface**, so it must comply with the VOICE spec. It rides the
existing single-reply TwiML channel (`sms.js:49-51`) — no new send path. It is **authored
deterministically**, never model-drafted, mirroring the safety fixed-template philosophy
(§10: reviewed text, not a prompt hope) and `voiceGuard`'s "structural, not a prompt hope".
It **reuses the existing web dedup copy** for voice consistency (see §2.5), not new phrasing:

- **New-vs-existing** (the Lucas case): `Quick check: is <NewName> the same person as
  <ExistingName> (<their relationship>), or someone new?` — mirrors
  `PEOPLE_AND_PRIORITY_UX.md §3` "You already have an Ana (your sister). Same person?".
  Including the existing person's relationship tag is what makes the question answerable.
- **Which-of-two** (two owned people share the first name): reuse the existing microcopy key
  `capture.clarify.person` — "Which <name>: your sister, or <name> from the gym?"
  (`CONTENT_AND_MICROCOPY_EN_ES.md`, `CAPTURE_AND_CONVERSATION_UX.md §5`).
- **Bilingual.** Cedrus is EN/ES; the em-dash ban is "English or Spanish"
  (`cedrus-sms-voice.md §2`). Author both variants by extending the EN/ES microcopy file, not
  by inventing one-off strings.
- **Compliance backstops.** No em dash, no exclamation, warm/brief (VOICE §3.2); passed through
  `applyVoiceGuard({ band:'routine' })`; kept under the ~134-char 2-segment UCS-2 ceiling
  (`cedrus-sms-voice.md §10`, tighter than `REPLY_CHAR_CAP`). Never bundled with a Pro upsell
  (VOICE §4).
- **Composed turn.** When an ambiguous mention shares a turn with confident saves, the reply is
  `[specific confirmation of what WAS saved] + [the one question]`, both authored in code so we
  never confirm the wrong merge. The confirmation must reflect the specific content, never a
  generic "Noted" (`cedrus-sms-voice.md §9`); if the segment budget is tight, the confirmation
  is trimmed first and the question is preserved whole.

Answer interpretation is **model-first, deterministic-backstop** (the house "model proposes,
code disposes" pattern): a new `clarification_answer` field on the extraction output
(`{ resolves, decision: same|different|unclear, matched_candidate_id? }`), plus a tiny
deterministic classifier for bare tokens (yes/yeah/same/that's him → same; no/nope/different/
new/someone else → different) when the model is unsure.

### 2.5 Prior art — reuse, don't reinvent

The web surfaces already implement this exact pattern; SMS should mirror them so a user sees
one consistent Cedrus across channels and merges share one mechanism:

- **Copy + flow:** `PEOPLE_AND_PRIORITY_UX.md §3` (add-person confirm, "Same person?" →
  `[Open Ana]` / `[Different Ana — create new]`); `CAPTURE_AND_CONVERSATION_UX.md §3/§5`
  (new-person card runs a duplicate check; ambiguous → one chip question); `INGESTION_UX.md`
  (import review "Looks like your Ana" → `[Same person]` / `[Different person]`); acceptance
  tests `INTERFACE_ACCEPTANCE_TESTS.md` CAP-03 / PPL-06 / IMP-05.
- **Merge mechanism:** `PEOPLE_AND_PRIORITY_UX.md §4` — the `person_merges` table; a merge
  **unions** everything ("nothing is discarded"), undo-able; "Keep separate" records the pair
  as **not-duplicates so it stops re-suggesting**.
- **Not-duplicate memory (adopt).** When the SMS answer is `different`, record the (new person,
  candidate) pair as a confirmed not-duplicate — the same "keep separate" signal — so Cedrus
  **never re-asks Luca-vs-Lucas again**. `fuzzyFind` / the band verdict consult it: a known
  not-duplicate pair skips straight to CONFIDENT-NEW, never ASK.
- **Holding is cleaner than the web import path.** Because the SMS loop **holds** the write, the
  `same` case just attaches held facts to the existing person — **no duplicate row is ever
  created, so no `person_merges` union/undo is needed** on this path. `person_merges` is used
  only later, if a human decides two *already-existing* rows are the same, or to undo an
  expiry-default-new that turned out to be a dup.

---

## 3. Same-first-name disambiguation ("Luca" vs "Luca N.")

**Trigger.** After a clarification resolves `different` (or a confident-new create), if the new
person's normalized first name equals an existing **active, non-self** person's first name for
this user, apply a disambiguating label. (Single-"Luca" users never see a label.)

**Deriving the label**, in priority order:
1. **Last-name initial** from a stated surname in the mention/message ("Luca Nannini" / "Luca
   N." → `N.`). This is the primary, per the requirement.
2. **Short context tag** if no surname is known — from `proposed_relationship` or a salient
   context word ("Luca from work", "Luca (coworker)").
3. **Invite one, once** — the confirm turn may add a single clause ("A last name or how you
   know him helps me tell them apart"), never a second forced question. Fallback: a minimal tag.

**Where it is stored.** Add a nullable `people.last_initial` column (migration, §5). The
canonical `people.name` stays `"Luca"` — we never mutate the real name. (No-migration
fallback: encode the token in the existing `aliases` array with a sentinel; the dedicated
column is recommended for clean display and matching.)

**Where it surfaces.** A single new helper `people.displayName(person, siblings)` returns
`"Luca"` normally and `"Luca N."` only when a first-name collision exists among the user's
active people. It is used **everywhere a name is rendered**:
- the model's `KNOWN PEOPLE` context block (`messages.js:buildContext` → so future mentions
  disambiguate and resolve to the right id),
- the dashboard / brief,
- insight & discovery messages.

Collision-scoping keeps the label out of the common single-name case, and centralizes display
logic in one function.

---

## 4. Birthday routing fix

**Goal:** "X's birthday is <date>" must populate the structured `people.birthday_month/day`
the insight/discovery engines read — in addition to (or instead of) any reminder row.

1. **Add a structured birthday output** to the extraction schema — a top-level array
   `birthdays: [{ person_ref, month (1-12), day (1-31), year|null, confidence }]`. (Chosen over
   a nested `people[].birthday` field to mirror the existing `person_ref` pattern used by
   `facts/saved_items/reminders/goals`, and to allow a birthday for a person mentioned only for
   that.)
2. **Update the prompt** (`extraction.system.txt`): "A birthday stated for a person → emit it in
   `birthdays[]` (month/day, and year if given). Do **not** emit a birthday as a reminder."
   Replace the current line 157 guidance accordingly.
3. **Add a persist writer** in `07_persist.js`: iterate `parsed.birthdays`, resolve
   `person_ref` → **owned** `personId`, validate ranges, and write via a new
   `people.setBirthday(userId, personId, { month, day, year })` (ownership-scoped, mirroring
   `people.setRelationship`). This is exactly the field `getBirthdaysForUser` (`people.js:103`)
   and both engines consume.
4. **Source of truth.** `people.birthday_month/day` is authoritative and **recurring**. Stop
   minting a separate one-shot birthday `reminders` row for a stated birthday — the insight
   engine already derives the birthday window from the person columns, and a one-shot
   `trigger_at` (this year only) is the exact today-bug where the birthday "saved" but never
   reached the engine. If a reminder row is still wanted for the reminder job, derive it from
   the structured field and dedupe; recommended default is **not** to create it.
5. **Migration:** none required for the birthday fix — `birthday_month/day` already exist.
   `birthday_year` would need a new column and is out of scope (engines use month/day only).
6. **Backfill (optional follow-up):** existing mis-routed birthday reminders (e.g. Quin's
   Nov 12) can be one-time backfilled into the person columns by a small script. Not part of
   this change.

---

## 5. Ownership, safety, modularity — one place each; files; migrations

### 5.1 Keep it in one place (modularity rule)

- **Merge / resolution logic → one module.** New `src/services/entityResolution.js` owns: the
  §1 confidence-band verdict (given model output + refined match + cues), the new-person cue
  list, and the create-vs-merge-vs-ask decision. `06_resolveEntities.js` becomes a thin caller.
  No merge decision lives anywhere else.
- **Clarification lifecycle → one module.** New `src/services/clarifications.js` owns
  `pending_clarifications` CRUD (enqueue / getActive / queueDepth / resolve / expire), the
  held-payload apply (delegating actual writes to `people`/`memory` so ownership guards apply),
  and the deterministic question authoring (through `applyVoiceGuard`).
- **Safety → unchanged, still one place.** `safetyDetection.js` + `understand()`'s Priority-0
  gate. The loop never re-implements a safety check; it runs strictly after `understand()` and
  early-returns on `_suppressPersistence`.

### 5.2 Ownership / cross-tenant safety

Every held-payload write goes through the existing user-scoped writers (`people.create/rename/
setRelationship/setBirthday`, `memory.addFact/…`), so a foreign or hallucinated `person_id`
cannot write cross-tenant (the `people.js:5-24` WS-A guarantee holds unchanged).
`candidate_person_ids` and `resolved_person_id` are verified owned before any merge.
`pending_clarifications` rows are keyed by `user_id` and only ever read/written for that user.

### 5.3 Files that change

| file | change | kind |
|---|---|---|
| `prompts/extraction.system.txt` | add `birthdays[]`; add `clarification_answer`; strengthen new-person cues; "ambiguous truly asks"; birthday → person not reminder | prompt |
| `src/services/entityResolution.js` **(new)** | confidence bands, cue list, verdict | code |
| `src/pipeline/06_resolveEntities.js` | delete 0.6 substring auto-merge; call the verdict; emit ASK/held | code |
| `src/services/people.js` | refine `fuzzyFind` (kinds + surname/initial + nickname table); add `setBirthday`; add `displayName` + `last_initial` capture | code |
| `src/pipeline/07_persist.js` | `birthdays[]` → `people.birthday`; persist-confident-now vs hold-ambiguous; apply-held on resolve | code |
| `src/services/clarifications.js` **(new)** | pending-clarification CRUD, held-payload apply, deterministic EN/ES question author, not-duplicate check | code |
| `src/pipeline/index.js` | insert clarification dispatch after `understand()`; crisis bypass; reply composition | code |
| `src/services/messages.js` | `buildContext` loads the active clarification into model context | code |
| `src/jobs/sweeps/clarificationExpiry.js` **(new)** + `src/jobs/scheduler.js` | expiry → default-to-new; activate next queued; register cron (~15 min) | code |
| `docs/ENTITY_RESOLUTION.proposed.sql` **(new)** | the migration (below), per the repo's `*.proposed.sql` convention | migration |

### 5.4 Migrations to flag

1. **`pending_clarifications` table (required)** — columns per §2.1, with a **partial unique
   index `(user_id) WHERE status='active'`** to enforce one outstanding question per user, and
   an index on `(status, expires_at)` for the sweep.
2. **`people.last_initial` column (required for §3)** — nullable text/char. (Or the
   no-migration alias-encoding fallback; the column is recommended.)
3. **Not-duplicate memory (§2.5)** — either reuse the web `person_merges` "keep separate"
   record, or add a small `person_not_duplicates` set `(user_id, person_id_a, person_id_b)`.
   Decide with the web-merge owner to keep one mechanism.
4. **Birthday fix — no migration** (`birthday_month/day` exist). Optional future
   `people.birthday_year`.

Authored as `docs/ENTITY_RESOLUTION.proposed.sql`, a sibling of `DISCOVERY.proposed.sql` /
`INSIGHTS.proposed.sql`. (This design doc contains no SQL by intent.)

---

## 6. Test surface (design-level; specifics in the PR)

- **Extraction prompt cases** (`test/extraction-prompt-cases.mjs`): the Luca / Luka / Lucas
  trio → new person for "met a guy named Lucas"; birthday emitted in `birthdays[]` not
  `reminders`.
- **Band verdict unit tests** (pure, like `voiceGuard`/`safetyDetection`): exact → merge;
  substring + cue → create; substring, no cue → ask; ambiguous → ask; foreign id → refused.
- **Clarification state machine:** ask → same / different / unclear / expire; one-active
  invariant; FIFO queue; re-ask cap.
- **Crisis-bypass:** a crisis message while a clarification is active never resolves,
  consumes, or expires it, and writes no product content.
- **Not-duplicate memory:** a confirmed `different` pair is never re-asked on a later mention.
- **Birthday routing:** "X's birthday is Nov 12" → `people.birthday_month/day` populated;
  `getBirthdaysForUser` returns it; the insight engine now emits a birthday reason in-window.

---

## 7. Open questions / tradeoffs (call before building)

- **TTL for a held clarification.** Proposed 72h — long enough for SMS cadence, short enough to
  avoid stale merges. (Expiry defaults to CREATE regardless.)
- **Batch two ambiguous mentions from one message into one question?** Default: no (sequential,
  one active). Revisit if it proves common.
- **Keep a derived birthday reminder row?** Default: no (person columns are the source of
  truth). Reconsider only if the reminder job needs an explicit row.
- **`last_initial` column vs. alias-encoded disambiguator.** Recommend the column.
- **`clarification_answer` model reliability.** Keep the deterministic backstop; measure model
  agreement from logs before trusting it alone.
- **Bilingual copy.** The question needs EN + ES variants in the shared microcopy file; confirm
  the ES phrasing with the voice owner (mirror `capture.clarify.person`).
- **Not-duplicate storage.** Reuse `person_merges`' "keep separate" record, or add a sibling
  `person_not_duplicates` set — decide with whoever owns the web merge table.
- **Safety-spec gap.** The crisis-vs-held-clarification interaction is unspecified today (§2.3);
  confirm the "leave it untouched" decision and fold it into the SAFETY spec.

**Compliance summary.** New ask surface: authored in code (reused web copy), EN/ES, band
`routine`, no em dash / exclamation / upsell, one question only (never stacks), under the
2-segment ceiling, deferred on sensitive/negative turns (VOICE §3.2/§4/§5; `cedrus-sms-voice.md`
§2/§10; `PROGRESSIVE_PROFILING_DESIGN.md` §2). Safety: untouched and first; a crisis turn
structurally bypasses all pending state and writes no product content, its content segregated
per SAFETY §6/§7/§10. Ownership: all writes user-scoped through existing guards.
