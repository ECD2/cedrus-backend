/**
 * JSON Schema agreement.
 *
 * The generator builds the schemas from the same declarations the validators
 * use, so agreement is true by construction. That is exactly the kind of proof
 * CEDRUS.md Part II §II.2 says not to trust: "a control that produces identical
 * output to the real case is not a control."
 *
 * So agreement is checked against an independent implementation. Ajv compiles
 * the published JSON Schema files from disk and validates the same fixtures.
 * Three assertions:
 *
 *   1. DRIFT     — the files on disk are byte-identical to what the generator
 *                  would write. A validator change that skips `npm run schemas`
 *                  fails here.
 *   2. VALID     — every valid example is accepted by both implementations. Any
 *                  disagreement means the schema is stricter than the validator,
 *                  which would break a consumer validating with JSON Schema.
 *   3. INVALID   — every counterexample is rejected by the TypeScript validator,
 *                  and the JSON Schema verdict matches the `json_schema_catches`
 *                  flag the counterexample declares. A rule that JSON Schema
 *                  cannot express stays visible instead of quietly widening.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { CONTRACTS, contractByName } from '../src/registry.ts';
import { schemaFileName, type JsonSchema } from '../src/schema/core.ts';
import { VALID_EXAMPLES } from './examples/valid.ts';
import { COUNTEREXAMPLES } from './examples/invalid.ts';
import { renderAll } from '../scripts/generate-json-schemas.ts';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', 'schemas');

const buildAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats.default(ajv as never);
  return ajv;
};

const loadSchemaFromDisk = (name: string): JsonSchema => {
  const contract = contractByName(name);
  assert.ok(contract !== undefined, `unknown contract ${name}`);
  const file = join(schemaDir, schemaFileName(contract));
  return JSON.parse(readFileSync(file, 'utf8')) as JsonSchema;
};

/** Ajv validators, compiled once from the files on disk. */
const compiled = new Map<string, ReturnType<Ajv2020['compile']>>();
const validatorFor = (name: string): ReturnType<Ajv2020['compile']> => {
  const existing = compiled.get(name);
  if (existing !== undefined) return existing;
  const ajv = buildAjv();
  const validate = ajv.compile(loadSchemaFromDisk(name));
  compiled.set(name, validate);
  return validate;
};

test('the schemas on disk match what the generator would write', () => {
  for (const { file, body } of renderAll()) {
    const onDisk = readFileSync(join(schemaDir, file), 'utf8');
    assert.equal(onDisk, body, `${file} is stale; run "npm run schemas" in the same commit as the validator change`);
  }
});

test('every published schema compiles under an independent JSON Schema implementation', () => {
  for (const contract of CONTRACTS) {
    const schema = loadSchemaFromDisk(contract.name);
    assert.doesNotThrow(() => buildAjv().compile(schema), `${contract.name} does not compile`);
  }
});

test('valid examples are accepted by the validator and by the JSON Schema', () => {
  for (const example of VALID_EXAMPLES) {
    const contract = contractByName(example.contract);
    assert.ok(contract !== undefined);

    const tsResult = contract.safeParse(example.value);
    assert.ok(tsResult.ok, `${example.id}: TypeScript validator rejected a valid example`);

    const validate = validatorFor(example.contract);
    const jsonOk = validate(example.value) as boolean;
    assert.ok(
      jsonOk,
      `${example.id}: the published JSON Schema is stricter than the validator: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
});

test('counterexamples: the validator always rejects, and the JSON Schema verdict matches what is recorded', () => {
  for (const counter of COUNTEREXAMPLES) {
    const contract = contractByName(counter.contract);
    assert.ok(contract !== undefined);

    const tsResult = contract.safeParse(counter.value);
    assert.equal(tsResult.ok, false, `${counter.id}: the TypeScript validator accepted a counterexample`);

    const validate = validatorFor(counter.contract);
    const jsonRejected = !(validate(counter.value) as boolean);
    assert.equal(
      jsonRejected,
      counter.json_schema_catches,
      `${counter.id}: json_schema_catches is recorded as ${String(counter.json_schema_catches)} but Ajv ` +
        `${jsonRejected ? 'rejected' : 'accepted'} it. Correct the flag, or express the rule in the schema.`,
    );
  }
});

test('the JSON Schema is never stricter than the validator (one-way agreement holds)', () => {
  /**
   * The direction that matters. A consumer in another language validates with
   * the JSON Schema; if the schema rejected something the validator accepts,
   * that consumer would refuse valid Cedrus data. The reverse gap is expected
   * and is what `json_schema_catches: false` records.
   */
  for (const example of VALID_EXAMPLES) {
    const validate = validatorFor(example.contract);
    assert.ok(validate(example.value), `${example.id}: schema stricter than validator`);
  }
});

test('every contract records honestly whether its rules are fully expressed in JSON Schema', () => {
  /**
   * `fullyExpressedInJsonSchema` drives the flag published in each schema. It is
   * checked against reality: if a contract claims full expression, then every
   * counterexample for it must be caught by Ajv too.
   */
  for (const contract of CONTRACTS) {
    if (!contract.validator.fullyExpressedInJsonSchema) continue;
    const counters = COUNTEREXAMPLES.filter((c) => c.contract === contract.name);
    for (const counter of counters) {
      assert.equal(
        counter.json_schema_catches,
        true,
        `${contract.name} claims full JSON Schema expression, but ${counter.id} is not caught by the schema`,
      );
    }
  }
});
