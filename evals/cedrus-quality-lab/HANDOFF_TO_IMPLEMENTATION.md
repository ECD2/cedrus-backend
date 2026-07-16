# Handoff to Implementation

This lab made no production changes. The following observations come directly from the current repository.

## Likely files to change

1. `src/pipeline/05_understand.js`: add provider-neutral schema validation after `JSON.parse`, with a safe failure path. It currently only parses JSON and truncates long replies.
2. `src/services/memory.js`: decide and document canonical aliases and which attributes are single-valued. Current aliases cover relationship status/type/to-user, location/home, and work/employer/career; the fixture-requested `relation`, `connection`, and `partner_status` are absent. Current forced single-valued keys are relationship, job, city, and mood.
3. `src/pipeline/06_resolveEntities.js`: stop silently selecting `candidate_ids[0]` for an ambiguous mention. Preserve ambiguity or require confirmation before persistence.
4. `src/pipeline/07_persist.js`: reject malformed nested structures before loops and separate confirmed corrections from model-proposed uncertainty. Current code coerces enum values and confidence but accepts arbitrary object shape.
5. `prompts/extraction.system.txt`: only if prompt behavior still fails after deterministic safeguards. It already instructs canonical relationship keys, non-tautological values, supersession, emotional register, and prompt-only actions.
6. Database schema/view code, if it exists outside this checkout: verify uniqueness/current-fact constraints and historical exposure. No migration or schema files were available in the inspected repository, so do not infer their behavior.

## Recommended order

1. Add strict structured-output validation and tests for malformed arrays/objects.
2. Make canonicalization and single-valued policy explicit and comprehensive; decide whether birthday, address, favorite color, and transient relationship state belong there.
3. Prevent ambiguous person resolution from reaching persistence.
4. Encode confirmed-versus-proposed correction semantics.
5. Re-run captured-output evaluations, then tune extraction/reply prompts only for remaining model-level failures.
6. Verify database-level preservation and concurrency behavior in a separate authorized integration environment.

## Regression commands

After each change:

```sh
node evals/cedrus-quality-lab/runner/run.mjs --outputs /absolute/path/to/candidate-outputs.json
```

For deterministic runner and current source audit:

```sh
node evals/cedrus-quality-lab/runner/run.mjs
```

The repository also contains a safe, in-memory production-logic test:

```sh
sh test/run-tests.sh
```

Do not run `test/extraction-prompt-cases.mjs` in this task; it calls OpenAI.

## Risks and unknowns

- `memory.addFact` retires then inserts in separate Supabase calls, with no visible transaction. Concurrent updates may leave gaps or multiple current values.
- Entity ambiguity is currently converted to the first candidate before persistence, risking wrong-person memories.
- JSON mode is not a schema guarantee; malformed but parseable nested data may be silently dropped or coerced.
- Fact history depends on `is_current`, `ended_at`, and `ended_reason`, but database constraints and agent-facing view definitions are unavailable here.
- Relationship facts also update `people.relationship`; failure between the fact insert and column update can diverge the two representations.
- The model creates both facts and user-facing replies in one call, so extraction prompt changes can regress tone and vice versa.
