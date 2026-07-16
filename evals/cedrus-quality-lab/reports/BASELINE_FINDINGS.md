# Baseline Findings

Baseline date: 2026-07-12. This assessment used only read-only source inspection, the lab's golden mock outputs, and the repository's in-memory fact test. It did not call a model or database, so it does not assign a production model score.

## What passed

- The quality runner accepted 34/34 golden outputs, demonstrating all mandatory fixture rules and report generation.
- `sh test/run-tests.sh` passed every assertion against real, concatenated `memory.js` and `07_persist.js` logic using in-memory stubs.
- Current code normalizes `relationship_status`, `relationship_type`, and `relationship_to_user` to `relationship`.
- Current code forces supersession for relationship, job, city, and mood even if the model omits the flag.
- A prior relationship row is marked `is_current=false` with `ended_at` and `ended_reason=superseded` in the tested path.
- A relationship fact also updates `people.relationship` in the tested persist path.
- Persistence constrains several enums, clamps confidence, bounds fact/reply lengths, and catches individual item write failures.

## What failed in the source audit

- Requested aliases `relation`, `connection`, and `partner_status` do not appear in `FACT_KEY_ALIASES`; a model emitting them can fork the relationship concept.
- Birthday is not forced single-valued. Correct behavior depends entirely on `supersedes_prior=true` from the model.
- `05_understand.js` uses JSON mode and `JSON.parse` but has no visible schema validation for required fields, nested types, enums, or confidence.
- `06_resolveEntities.js` resolves an ambiguous person to the first candidate ID, despite the prompt saying to surface ambiguity.

These audit failures are evidence about safeguards, not proof that every corresponding model fixture fails.

## Could not be safely tested

- Actual prompt extraction and reply quality, because the repository's prompt-case test calls OpenAI.
- Supabase constraints, transactions, triggers, view definitions, row-level security, and real concurrency.
- Whether current versus superseded facts are exposed correctly by `v_agent_person_context`; its definition is not in this checkout.
- Twilio delivery behavior and Railway runtime behavior.
- Provider-level structured-output guarantees beyond the code's `response_format: {type: "json_object"}` request.

## Likely root causes

- Canonicalization is a hand-maintained alias map, while fact keys remain open-ended model strings.
- Single-valued policy is a small hard-coded set rather than an explicit attribute registry.
- Model output is trusted at field-shape level after parsing; persistence mostly defends at individual values.
- The “guess + let the user correct” entity policy favors continuity over attribution safety.
- Fact extraction and emotional reply generation share one prompt/model response, coupling two distinct quality surfaces.

## Five most important current quality risks

1. **Wrong-person persistence:** ambiguous mentions are silently mapped to the first candidate.
2. **Relationship key forks:** unrecognized aliases can create simultaneous current relationship concepts.
3. **Malformed structured output:** parseable JSON can have missing or wrongly typed nested fields with no central rejection.
4. **Non-atomic corrections:** retiring an old fact, inserting a new one, and syncing `people.relationship` are separate visible operations.
5. **Coupled extraction and tone regressions:** one model response controls both memory writes and the emotionally sensitive SMS.

## Recommended production changes

Implement strict schema validation first; make canonical attributes and single-valued behavior explicit second; block persistence on ambiguous attribution third; then add confirmed-versus-proposed correction handling. Finally use captured candidate outputs to tune the prompt. See `HANDOFF_TO_IMPLEMENTATION.md` for evidence, order, commands, risks, and unknowns.
