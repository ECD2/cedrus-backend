# Cedrus Quality Lab

This is an offline regression suite for Cedrus's relationship-memory pipeline. It separately measures what Cedrus extracts, how facts should change over time, who a fact belongs to, and whether the drafted SMS has the right emotional weight. It is intentionally provider-neutral and understandable without reading backend code.

## Relationship to the backend

The current inbound path is `src/pipeline/index.js`:

1. `src/services/messages.js` builds known-people, open-prompt, and recent-message context.
2. `src/pipeline/05_understand.js` sends that context and `prompts/extraction.system.txt` to one model call. The returned JSON contains both structured extraction and `reply`.
3. `src/pipeline/06_resolveEntities.js` maps mentions to people.
4. `src/pipeline/07_persist.js` coerces enum-like fields and delegates fact writes.
5. `src/services/memory.js` canonicalizes some fact keys and marks prior single-valued facts non-current before inserting the replacement.
6. The pipeline logs the model-drafted reply.

The lab does not import modules that initialize provider clients or require credentials. Its source audit reads production files as text; its behavioral evaluation consumes JSON output files. This makes every default run deterministic and network-free.

## What it measures

- specific, non-tautological facts without invented detail
- canonical keys and one current relationship state
- corrections, contradictions, and historical supersession
- correct person attribution and cautious ambiguity handling
- distinct emotional treatment for heavy and routine updates
- restrained, non-theatrical replies that claim no external action
- prompt-injection resistance
- structured-output shape, enums, confidence ranges, and required fields

See `EVALUATION_RUBRIC.md` for weights and release gates.

## Run it

Requires Node 20 or newer and no package installation:

```sh
node evals/cedrus-quality-lab/runner/run.mjs
```

The command writes `reports/generated/results.json` and `reports/generated/report.md`, prints the Markdown report, and exits nonzero if any mandatory fixture fails.

Evaluate a candidate implementation's captured outputs:

```sh
node evals/cedrus-quality-lab/runner/run.mjs \
  --outputs /absolute/path/to/candidate-outputs.json \
  --report-dir /absolute/path/to/report-folder
```

Candidate output files use the same provider-neutral envelope as `mocks/golden-outputs.json`:

```json
[{ "id": "relationship-correction", "output": { "intent": "save_memory", "people": [], "facts": [], "saved_items": [], "reminders": [], "goals": [], "prompt_answer": null, "reply": "..." } }]
```

## What is mocked

All model extraction/reply output is supplied from a local JSON file. No Supabase table, Twilio message, Railway deployment, OpenAI/Claude request, migration, credential, clock service, or other network dependency is used. `mocks/golden-outputs.json` demonstrates outputs that satisfy the contract; it is not a claim about the current live model.

## Workflow for an implementation agent

After changing a prompt or production rule, capture one output per fixture using an authorized environment outside this lab, remove provider metadata, and run it through `--outputs`. Compare extraction failures separately from reply failures. Run after every narrow change, then run the repository's safe local tests. Do not update expectations merely to make a regression pass; change an expectation only when product policy intentionally changes and record why in review.

Fixtures are in `fixtures/cases.json`; expected semantic outcomes are in `expected-results/results.json`. Exact prose is avoided. Add a new case and expected result whenever a production incident reveals a new failure mode.

## Limits

The runner validates proposed output and audits source-visible safeguards. It cannot prove database behavior against Supabase, model behavior without captured outputs, or the semantics of database views. Ambiguous and genuinely uncertain cases are marked for human confirmation. `reports/BASELINE_FINDINGS.md` identifies the current untestable seams.
