# Vendored from `01-cedrus-contracts`

This directory is a **vendored copy**, not a checkout and not a dependency. It was copied out of
the contracts lab and amended here. The lab is read-only and was not modified.

| | |
|---|---|
| **Source** | `/Users/scu/Developer/Cedrus-Labs/01-cedrus-contracts` (local git repo, no remote) |
| **Commit** | `113a3389c424222c37f421b2944c495d13ed1c30` |
| **Commit subject** | `Refresh mutation results against the final tree` |
| **Lab tree state at copy** | clean |
| **Vendored** | 2026-08-05, Slice 1 Phase B |
| **Authority** | `CANONICAL_CONTRACT_CATALOG_PROPOSAL_2026-08-05.md`, cross-cutting port rule 3 ("vendor Lab 01 with the commit hash recorded"). Emil approved decision (a) on 2026-08-05. |

There is no private registry, and both Railway and Lovable deploy a single repo, so vendoring is
the delivery mechanism v0 justifies. Re-vendoring means: copy the lab again at a named commit,
re-apply the amendments below, `npm run schemas`, `npm run check`, `npm run mutate`, `npm run build`.

---

## What was moved, and why

**`src/examples/` is not here.** The synthetic fixtures live at `test/examples/` instead. Nothing
under `contracts/src/` is a record about a person, real or invented, so nothing synthetic can reach
the runtime path `cedrus-backend` imports. Two files reference the new location: `test/discipline.test.ts`
(the 555-and-`.invalid` fixture-hygiene check) and the three suites that import the fixtures.

**`dist/` is new, and it is committed.** See the compile decision below.

---

## The compile decision: compiled JavaScript, not JSON Schemas + Ajv

The catalog left this open for the port session. **Chosen: compile to `.js` + `.d.ts` at vendor
time** (`npm run build` → `tsconfig.build.json` → `dist/`). `cedrus-backend` imports
`contracts/dist/index.js`. Four reasons, in the order they mattered:

1. **JSON Schemas alone cannot carry most of these rules.** The lab measured it honestly: **7 of 24
   contracts are fully expressed in JSON Schema**, and **19 of 51 counterexamples are TypeScript-only**.
   The schemas-only option would have silently dropped every rule in that gap. Named, because
   naming the loss was mandatory and the loss is the reason the option lost:

   - all four guards (`provenance`, `authorization`, `calendar-boundary`, `fabrication`) — so
     `provenance/inference_as_known`, `authorization/vague_outcome`, `calendar/forbidden_field` and
     `fabrication/derived_score` stop being enforced;
   - every cross-field `refine`, including `card_outcome/silence_source_mismatch` (a silent outcome
     must have arrived by no response), `availability/basis_notice_mismatch`, and
     `window/ends_before_starts`;
   - every `inspect` rule, including `goal_set/member_mismatch`, `goal_set/duplicate_goal`,
     `fabrication/progress_contradicts_counts`, and the analytics vanity-event rejection;
   - `Count` derivation (`value === source_refs.length`), which is trust law item 3 made mechanical.

   The JSON Schemas are still generated, still committed, and still cross-checked against the
   validators by Ajv in `test/json-schema-agreement.test.ts`. They are for consumers that cannot run
   this JavaScript (miami, the frontend, anything later). They are not the enforcement path here.

2. **No new runtime dependency.** `dist/` imports nothing. The schemas-only option needs `ajv` and
   `ajv-formats` in `cedrus-backend`'s production dependencies, which is two more packages in the
   deploy for a weaker check.

3. **No raised Node floor.** The lab runs its `.ts` sources directly under Node 24 type stripping and
   declares `node >=24`. `cedrus-backend/package.json` declares `node >=20`, and the Railway
   service's Node version is not verified in this session. Importing `.ts` directly would make a
   type-stripping floor a *deploy-time* failure, and it would fail at module load — that is, with
   `CONTRACTS_VALIDATE` off, on a change whose whole point is that it cannot alter behaviour.
   `dist/` is plain ES2023 and has no such floor.

4. **The source stays byte-comparable with the lab.** `rewriteRelativeImportExtensions` rewrites the
   `.ts` specifiers at emit, so `contracts/src/` can be diffed against the lab commit directly. The
   only differences are the amendments below.

**What this costs, stated plainly.** `dist/` is build output under version control, and it goes
stale if someone edits `contracts/src/` without running `npm run build`. That is a real hazard and
it is not fully closed: `test/contracts-goals.test.mjs` asserts the compiled `dist/` agrees with the
amended source on the values Slice 1 depends on, which catches the case that matters now, not every
possible drift.

---

## Amendments applied to this copy

Applied here, never to the lab. Amendments 1 to 5 are the boardroom catalog's; 6 is this session's
and is flagged as such. Every one is proved in both directions by `test/amendments.test.ts`: a
payload the lab copy **refuses** and this copy accepts (the control — delete the amendment and it
goes red), plus a counterexample rejected with an exact code (the domain is still closed).

| # | Contract | Change | Authority |
|---|---|---|---|
| 1 | `cedrus.goal` | `status`: `active\|paused\|retired` → **`open\|completed\|missed\|canceled`** | Catalog item 2. The deployed `user_goals_status_check` wins; changing a live CHECK is a data migration nobody needs yet. |
| 2 | `cedrus.goal` | `origin`: `user_set\|operator_entered` → **`user_set\|cedrus_inferred\|operator_entered`** | Catalog item 2. `origin` is the live partition key in both directions; a contract that cannot hold `cedrus_inferred` cannot describe the table. |
| 3 | `cedrus.card_outcome` | `not_this_reason` → **`rejection_reason`**, `+ unspecified`; new nullable **`rejection_scope`** (`this_action\|today`) | Catalog item 8, and CEDRUS.md Part I §22 (approved by Emil 2026-08-05). "Not this" suppresses a strategy, "not today" defers a card. |
| 4 | `cedrus.connection_authorization` | `status` gains **`disconnected`** | Catalog item 6. A member disconnecting and a provider revoking are different events with different obligations. |
| 5 | `cedrus.agent_request` / `ASSISTANT_JOBS` | Re-derived from reboot §6.4 (see below) | Catalog item 14. The lab was built against the pre-reboot job list. |
| 6 | `cedrus.goal` | `stated_text` max **200 → 280** | Catalog item 2 ("280-char cap, reject-not-truncate"), matching `services/goals.js` `MAX_GOAL_TEXT_CHARS`. **Not in the Slice 1 prompt's enumerated list** — added because 200 would make every legitimate 201-to-280 character goal a logged violation, and a validation log full of false alarms gets ignored. |

### Amendment 5 in full

Reboot §6.4's list is: find somewhere to work, suggest what to do with an open window, help make or
schedule a simple plan, record what actually happened, answer questions about the member's own goals
and progress.

| Lab value | Fate | Reason |
|---|---|---|
| `find_somewhere_to_work` | kept | §6.4 |
| `make_or_schedule_plan` | kept | §6.4 "help make or schedule a simple plan" |
| `find_local_activity` | **dropped** | §6.4: "Removed from this list 2026-08-04: 'find Cedrus workdays and local activity' as a named reliable job." |
| `answer_calendar_of_events` | **dropped** | §6.4: the fifth job added by §15 goes with the retired event sequence. |
| `connect_with_member` | **dropped** | Not in §6.4, and §4 is explicit that Cedrus introduces nobody to anybody in the founding release. |
| — | added `suggest_for_open_window` | §6.4 "suggest what to do with an open window" |
| — | added `record_what_happened` | §6.4 "record what actually happened" |
| — | added `answer_goal_or_progress` | §6.4 "answer questions about the user's own goals and progress" |

A dropped job does not become unanswerable. It becomes out of scope, which means an honest answer
and a logged request. The out-of-scope log is the roadmap.

### The analytics half of amendment 5, and why it is empty

The Slice 1 prompt pairs "agent-request jobs" with "analytics better-day props" and asks for both to
be re-derived from reboot §6.4/§11. **The better-day props do not exist in this package.**
`src/contracts/analytics.ts` carries `card.helped` as a bare boolean and has no better-day category
enum anywhere; a full grep of `src/` for `workday`, `better_day` and `better-day` returns only the
three retired job names, all in amendment 5. The stale better-day vocabulary the catalog complains
about (item 10: kebab-case spellings, `attended_cedrus_workday`) belongs to **Labs 09 and 10**, which
Slice 1 does not vendor. Nothing was changed, because there was nothing to change. Recorded here so
the next session does not go looking for it.

`cedrus.progression`'s `nothing_moved` boolean — which catalog item 10 rules against, because it
conflates zero with unknown — **is** in this package and **was left alone**. It is outside the five
named amendments, no Slice 1 code path touches it, and replacing it is the three-state
`evidence_present | insufficient_evidence | unknown` model that Slice 2 builds. Filed, not fixed.

---

## Divergences between this contract and the deployed service

Found while wiring `POST /api/goals`. None are defects in either side; they are the gap the
validation exists to make visible. All are recorded because the *next* person to see a
`contract.violation` line needs to know which of these it is.

| Field | Contract | `services/goals.js` | Handling |
|---|---|---|---|
| `stated_text` min | 3 | any non-empty string after trim | **Kept.** This is the divergence the wiring actually catches today, and it is the worked example in the route-level control. A one-character goal is not a goal. |
| `stated_text` max | 280 (amended) | 280 | Aligned by amendment 6. |
| `priority` | nullable integer 1–3, member-set rank | integer 0–100, default 0, ranking weight for `selectVitalFew` | **Same name, different concept.** The adapter sends `null`, never the service's value. Mapping them would make every default-priority goal a violation and would assert a member ranked something they never ranked. |
| `goal_id` / `member_id` | `prefix:suffix` opaque ids | bare UUIDs | The adapter prefixes (`goal:`, `member:`). Recorded because an un-prefixed id fails `string/pattern`, which reads like a data problem and is not one. |
| `lane` | nullable `work\|people\|body` | column does not exist yet | Adapter sends `null`. The additive migration is Slice 2 (`GOALS_LANE.proposed.sql`, on `feat/goals-lane`, unapplied). |

---

## Running it

```
npm install        # dev toolchain only. dist/ has zero runtime dependencies.
npm run check      # tsc --noEmit, then 97 tests
npm run schemas    # regenerate schemas/ from the validators
npm run mutate     # 30 mutation controls
npm run build      # rm -rf dist && tsc -p tsconfig.build.json
```

`npm run mutate` edits files in place and restores them. It **refuses** a mutation whose target
string is missing rather than reporting a pass — M28 did exactly that when amendment 6 moved its
target, and was retargeted rather than dropped. A harness that has never refused is a harness nobody
knows can refuse.

State at vendor time: **typecheck 0, tests 97/97, mutations 30/30, build 0.**
