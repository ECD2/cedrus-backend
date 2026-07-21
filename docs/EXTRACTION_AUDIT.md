# Extraction / fact-quality audit — silent-contradiction & data-quality risks

Scope: harden "the one who remembers." The `relationship` vs `relationship_status`
fork (a girlfriend and an ex-girlfriend both `is_current` on one person) was one
instance of a class. This audit traces the whole **extraction → normalize → merge
→ persist** path for other places the same class can occur — single-valued
attributes that could fork, stale `is_current` rows, and alias keys missing from
the canonical registry — fixes the clear ones in the ONE place slots are defined
(`src/services/memory.js`), and records the ambiguous/risky ones here instead of
guessing.

Companion files:
- Fixes: `src/services/memory.js` (`FACT_KEY_ALIASES`, `SINGLE_VALUED_KEYS`,
  `canonicalFactKey`).
- Proof: `test/fact-supersession.test.js` (extended).
- Legacy cleanup: `docs/REL_STATUS_RECONCILE.proposed.sql` (extended, **unrun**).

---

## 1. Write-path inventory (where a fact can be born)

Every durable fact write funnels through the canonical registry, so the registry
is the single choke point that has to be right:

| Path | Entry | Key normalization | Single-valued supersession |
|------|-------|-------------------|----------------------------|
| SMS | `pipeline/07_persist.js` → `memory.addFact()` | `canonicalFactKey()` | yes, on write |
| Web "Tell Cedrus" | `services/capture.js` → same `persist()` → `addFact()` | `canonicalFactKey()` | yes, on write |
| Chat import (confirm) | `services/chatImport.js` `confirmImport()` (direct insert) | `canonicalFactKey()` (harvest) | **no** by design (historical never clobbers present; single-valued keys are *skipped* when a current value exists) |

Confirmed: there is no fourth backend write path that bypasses
`canonicalFactKey()`. (The web dashboard edits facts Supabase-direct from the
**frontend**, which is out of scope for this worktree; the canonical-key
guarantee there is the frontend's responsibility and is noted in §4/D5.)

The on-write invariant is also self-locked by the test at
`test/fact-supersession.test.js` ("every alias canonicalizes to its declared
target" + "every aliased slot is single-valued"), so a future edit that aliases
onto a multi-valued slot fails loudly.

---

## 2. Fixed (clear, low-risk, done in the registry)

### F1 — `status` alias gap (the direct sibling of the original bug)
The extraction prompt names **three** forbidden relationship variants:
"Never variants like relationship_status, relationship_type, or **status**"
(`prompts/extraction.system.txt`, "ONE CANONICAL KEY PER ATTRIBUTE"). Two of the
three were aliased; `status` was not — so a model slip to `fact_key: "status",
value: "ex-girlfriend"` would fork exactly like the original bug.
**Fix:** added `status → relationship` (and the natural `relationship_to_me →
relationship`). Genericity caveat in D8.

### F2 — separator normalization in `canonicalFactKey`
Old normalization folded only whitespace (`/\s+/ → _`), so `relationship-status`
or `job-title` (hyphen) and `relationship__status` (double underscore) slipped
past the alias table and forked. **Fix:** fold any run of spaces / hyphens /
underscores to a single `_` and trim, so `"Relationship Status"`,
`"relationship-status"`, and `"relationship_status"` all reach the same entry
before lookup. Purely additive for existing keys (single underscores are
preserved); covered by a new test case.

### F3 — additional single-valued synonyms the model realistically reaches for
The registry already decided that both facets of "work" collapse into one `job`
slot (`employer` = the org, `career` = the field, both aliased), and that "where
they live" collapses into `city` (`location`, `home`). Extended **consistently**
with the same-granularity synonyms:
- → `job`: `occupation`, `profession` (like `career`), `workplace`, `company`
  (like `employer`).
- → `city`: `lives_in`, `residence` (like `location`/`home`).

All new aliases point at single-valued slots (`relationship`/`job`/`city`), so a
correction under any of them supersedes instead of stacking, and the retire step
in `addFact()` (which dynamically covers `[canonical, ...its aliases]`)
automatically retires legacy rows under the new keys on the next write.

These are mirrored into `docs/REL_STATUS_RECONCILE.proposed.sql` (the file asks
for exactly this lockstep) so a one-time cleanup collapses any pre-existing rows.

---

## 3. Documented, NOT auto-fixed (ambiguous or info-destroying)

### D1 — `hometown` deliberately NOT aliased to `city`
`city` is "where they are now" (prompt example: "he's in Chicago now" supersedes).
`hometown` is origin, not current location; folding it would let a hometown
mention retire a correct current city. Left distinct.

### D2 — `job_title` / `role` / `title` / `position` NOT aliased to `job`
`job` is single-valued and typically holds the employer ("Stripe"). A title
("engineer") is a **complementary** facet, not a contradiction. Aliasing it onto
`job` would make stating a title *retire* the employer (and vice-versa) — silent
data loss, the opposite of the goal. Kept separate. (If the product later wants a
first-class `job_title` slot, it should be its own multi-valued-or-single key, not
an alias of `job`.)

### D3 — "current life situation" has no safe canonical key
The prompt lists "current life situation" as single-valued alongside
relationship/job/city/mood, but there is no clean key for it and candidate keys
(`situation`, `life_situation`, `living_situation`) are too broad to hard-force
supersession without risking unrelated merges. Left to the multi-valued default;
flagged for a product decision if it proves to fork in real logs.

### D4 — `age` / `birthday` as *facts*
Both are single-valued in reality, but: birthdays are structured on
`people.birthday_month/day` (not facts), and `age` is rarely emitted as a fact
key. Adding them to `SINGLE_VALUED_KEYS` is defensible (newest wins) but is
speculative without log evidence, and `SINGLE_VALUED_KEYS` also drives the chat
import "skip when present" rule (§4/D5), so widening it has a second-order effect.
Deferred pending real data rather than guessed.

### D5 — chat-import single-valued/idempotency check keys off the RAW stored key
`confirmImport()` builds `currentByKey` from existing rows' `r.fact_key`
(`services/chatImport.js`) and compares against the already-canonical
`f.fact_key`. For rows written **after** the registry landed this is a no-op
(stored keys are canonical). For **legacy** rows still under a non-canonical key
(e.g. an old `employer` row), the "historical never clobbers present" guard and
the already-known dedup can miss, so an import could add a second `job`-ish row.
Impact is low (import is propose-then-confirm and conservative), and the
`REL_STATUS_RECONCILE` migration canonicalizes legacy rows, which closes it. Not
patched in code to avoid re-implementing canonicalization at the read site;
tracked here.

### D6 — legacy rows under newly-aliased keys need the (unrun) reconcile
The on-write guarantee only reshapes rows on the next write to that slot. Rows
sitting under a newly-aliased key (`occupation`, `status`, …) with no subsequent
write stay forked until `REL_STATUS_RECONCILE.proposed.sql` runs. That file is
extended to include every new alias and remains **unrun** (Emil runs migrations
through the Supabase ceremony). No migration was executed by this worktree.

### D7 — rare hyphenated legacy keys
`canonicalFactKey` now folds hyphens for **new** writes (F2). The reconcile SQL
keeps `lower(btrim(fact_key))` (underscore-form — the shape every known
production fork actually took) rather than adding regex separator-folding, to
keep the human-reviewed migration simple. A legacy row whose key contained a
literal hyphen is a vanishing edge; the section-0 pre-flight count will reveal it
if it exists.

### D8 — `status` genericity caveat (paired with F1)
`status` is the one added alias that is not a pure relationship synonym in the
abstract. In *this* product the prompt uses it solely for relationship, so the
alias is correct for all realistic inputs; the caveat is called out in the SQL
header so the pre-flight is eyeballed before the one-time collapse.

---

## 4. Verified safe — no change needed

- **Supersession on write** retires the canonical key *and* its aliases before
  insert (`addFact`), so a correction under any alias can't leave a stale
  `is_current` sibling. Proven per-alias in the test.
- **`is_current` is written explicitly** by `addFact` (not resting on a column
  default), so the "exactly one current value per single-valued slot" invariant
  holds on its own.
- **Tautological facts** ("jewelry"/"likes jewelry") are dropped in code
  (`isTautologicalFact`) on both the SMS and import paths.
- **Ownership guard** scopes every people write by `user_id`, so a hallucinated
  foreign `person_id` writes zero rows rather than cross-tenant.
- **Crisis suppression** writes no product content, so no fact-quality surface
  there.

---

## 5. Tests

`test/fact-supersession.test.js` extended with:
- `status` and the new job/city synonyms canonicalize correctly, incl. the
  hyphen/underscore-run normalization case;
- a correction arriving under a *newly added* alias (e.g. `status`,
  `occupation`) supersedes instead of forking, through the full `addFact` path;
- the existing invariant checks (alias → single-valued target) continue to pass
  over the enlarged table, which is what guarantees the extension stayed safe.
