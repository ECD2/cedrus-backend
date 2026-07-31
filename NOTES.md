READ `CEDRUS.md` (repo root) BEFORE STARTING ANY WORK. It is the single source of truth and
replaced `CEDRUS_OPERATING_DOCTRINE.md` on 2026-07-31.

# Overnight build notes — backend (2026-07-11)

All changes are UNCOMMITTED in the working tree so you can review the diffs
(`git diff`) before anything lands.

## Part 1a — tautological fact values

**Change:** `prompts/extraction.system.txt` — rewrote the fact_key section into
"FACT_KEY & FACT_VALUE": fact_value must carry information the key alone does
not (bans `key: jewelry / value: "likes jewelry"`), with worked examples for
vague input ("she likes jewelry" → key `gifts`, value `jewelry`) vs specific
input (gold / necklace details survive into the value).

## Part 1b — corrections stacked instead of superseding

**Root cause (two layers):**
1. The model was free to invent key variants (`relationship` one message,
   `relationship_status` the next), and supersession only retired rows whose
   `fact_key` matched *exactly*.
2. Even when a relationship fact landed, nothing updated `people.relationship`,
   so the model kept seeing the stale value ("girlfriend") in KNOWN PEOPLE.

**Canonical key decision: `relationship`.** The `people.relationship` column,
the extraction schema's `proposed_relationship`, the dashboard's person label,
and `fact_type: relationship_detail` all already use the word "relationship";
`relationship_status` appeared nowhere in the codebase except as a throwaway
example inside the old prompt text. Prompt now mandates the canonical key; code
enforces it regardless.

**Changes:**
- `prompts/extraction.system.txt`: "ONE CANONICAL KEY PER ATTRIBUTE" +
  "SUPERSESSION & CORRECTIONS" sections (corrections = same key +
  `supersedes_prior: true`, with the exact girlfriend→ex example).
- `src/services/memory.js`: `canonicalFactKey()` normalizes alias keys
  (`relationship_status`→`relationship`, `location`→`city`, `work`→`job`, …);
  single-valued keys (`relationship`, `job`, `city`, `mood`) now force
  supersession even if the model forgets the flag; retirement also sweeps
  alias-keyed legacy rows (existing `is_current=false` + `ended_reason=
  'superseded'` pattern kept — nothing is deleted).
- `src/pipeline/07_persist.js` + `src/services/people.js`: a relationship fact
  also updates `people.relationship` (new `setRelationship`), so KNOWN PEOPLE
  context and the dashboard label reflect the correction.

**Tested:** `test/run-tests.sh` — runs the REAL memory.js/persist.js code
against an in-memory Supabase double (uses node if present, else macOS's
bundled JavaScriptCore, since this machine has no node/bun). 16/16 pass,
including the exact production sequence: girlfriend fact + correction arriving
under the wrong key with the flag forgotten → exactly one current relationship
fact ("ex-girlfriend", key `relationship`), old row retired, unrelated fact
untouched, `people.relationship` synced.

## Part 3 — emotional register

**Change:** `prompts/extraction.system.txt` — new "EMOTIONAL REGISTER" section
+ 5 calibration examples (2 routine, 3 weighted: breakup, death, friend's
diagnosis). Distinguishes routine updates from heavy disclosures; bans leading
with "Saved"/"Noted" on heavy ones; explicitly bans therapy-speak ("I'm so
sorry you're going through this", "must be so hard", "healing", "processing");
keeps the existing voice (understated, specific, contractions, no em dashes).
Also: the brand-new-user "confirm + mention the dashboard" rule now yields to
the register rules when the first message is heavy.
`nudge.system.txt` / `brief.system.txt` untouched — the reported failure
("noted" on a breakup) lives in the inbound reply path, and the brief prompt
already handles heavy selfNotes.

## NOT tested live (be aware)

There is **no OPENAI_API_KEY (and no node/npm) on this machine**, so the
prompt changes could not be run against gpt-4.1-mini tonight. What I did
instead:
- Encoded the required test cases as a runnable eval:
  **`test/extraction-prompt-cases.mjs`** — 4 extraction cases (vague, specific,
  relationship correction, correction-of-vague) + 4 register cases with
  programmatic assertions (no tautological values, canonical key +
  supersedes flag, no flat "Noted." opener on heavy messages, no
  therapy-speak, no em dashes). Run it wherever the backend env lives:
  `node test/extraction-prompt-cases.mjs`.
- The DB-side behavior is fully covered by the jsc test above even if the
  model misbehaves.

Also untestable here: anything needing a live Twilio webhook or the production
Supabase (no `.env` in this checkout — only `.env.example`).
