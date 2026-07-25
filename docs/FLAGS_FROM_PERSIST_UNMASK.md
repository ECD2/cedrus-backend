# Flags from the persist/clarifications unmask session (`fix/persist-unmask-dates`)

Cross-cutting needs this session found but **must not implement here** (they live outside
its ownership: `07_persist.js`, `memory.js`, `clarifications.js` + tests). Branch-only; no
migration/push/deploy run. This session unmasked every swallowed catch in the two files
(STEP 2) and centralized model-timestamp parsing (STEP 3, `memory.toTimestamptz`).

---

## CORRECTION — `pending_clarifications` EXISTS in prod (my earlier "missing table" call was wrong)

An earlier draft of this session claimed the table was never migrated (the cause of the
"pending_clarifications / non-self people = 0" incident). **That was wrong.** Verified
read-only against the live DB (`~/.config/cedrus/migrate`, 2026-07-24):

```
to_regclass('public.pending_clarifications') = "pending_clarifications"   (NON-NULL)
COUNT(*) = 3    BY STATUS: resolved = 3        (19 columns, matches proposed.sql)
```

The three "confirmations" I relied on were stale artifacts, not live state: the
migrations folder can be bypassed by the automated runner (`~/.config/cedrus/migrate/
run-migration.mjs`); `cedrus-supabase/generated/database.types.ts` was generated Jul 18,
before Phase 2a shipped Jul 24; and "NOT EXECUTED" in the proposed SQL is authoring
boilerplate, not deploy status. **Do not gate a migration on this** — the table is live
and its loop has resolved rows.

Consequently the STEP 4 fallback (`createFromDroppedHold`) was removed — it traded
ask-first for duplicate creation on a false premise. **The real reason any `enqueue`/
clarification write fails is now UNKNOWN**; the STEP 2 unmask (`errText` = message +
SQLSTATE code + constraint) is what will surface it in logs once deployed, instead of the
`String(err)` that hid it.

---

## FLAG — 📝 EXTRACTION PROMPT (station 2 owns it — do not edit `prompts/extraction.system.txt`)

Independent of the table question, bug #1 is real: the model emits *natural language* for
model-fed timestamptz fields — `event_date` = `"this morning"`/`"tonight"` (and possibly
`reminders.trigger_at` / `goals.due_at`). Inserted raw that is SQLSTATE 22007, and before
the unmask it destroyed the entire saved-item write.

**Defended in code this session:** `memory.toTimestamptz()` parses these in ONE place — a
valid ISO-8601 value is kept; anything unparseable drops to `null` for the nullable
garnish fields (`event_date`, `due_at`) so the memory is **still saved**, and a reminder
with no schedulable time is skipped (its column is `NOT NULL`).

**Requested prompt change (higher-value complement):** instruct the extractor to emit
**fully-localized ISO-8601** (offset included — it already receives `localNow(tz)`) for
`event_date`, `trigger_at`, `due_at`, and to emit **`null`** when it cannot compute a real
timestamp — never a natural-language phrase. Today "concert this weekend" loses its date
entirely (code drops the unparseable value); if the model resolved it to an ISO date, the
date would survive. The code fix stops data loss; the prompt fix restores the dates.
