/**
 * The validator core.
 *
 * Small tests, but they hold up everything else: if `object` silently allowed an
 * unknown key, most of the calendar boundary would evaporate without a single
 * contract test going red.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ContractViolation,
  arrayOf,
  boolean,
  caseInsensitiveWordPattern,
  defineContract,
  discriminatedUnion,
  enumOf,
  integer,
  jsonObject,
  literal,
  matchesAnyWord,
  nullable,
  object,
  optional,
  refine,
  schemaFileName,
  string,
  walk,
  type Validator,
} from '../src/schema/core.ts';

const codes = (issues: readonly { readonly code: string }[]): readonly string[] => issues.map((i) => i.code);

test('objects are closed: an unknown key is a rejection, not a warning', () => {
  const validator = object({ a: string() });
  assert.deepEqual(codes(validator.check({ a: 'x' }, '')), []);
  assert.deepEqual(codes(validator.check({ a: 'x', b: 'y' }, '')), ['object/unknown_key']);
  assert.equal(validator.schema['additionalProperties'], false);
});

test('a missing required field and a present optional one behave differently', () => {
  const validator = object({ a: string(), b: optional(string()) });
  assert.deepEqual(codes(validator.check({ a: 'x' }, '')), []);
  assert.deepEqual(codes(validator.check({ b: 'y' }, '')), ['object/missing_required']);
  assert.deepEqual(validator.schema['required'], ['a']);
});

test('every issue carries the path that failed', () => {
  const validator = object({ outer: object({ inner: arrayOf(string({ minLength: 2 })) }) });
  const issues = validator.check({ outer: { inner: ['ok', 'x'] } }, '');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, 'outer.inner[1]');
});

test('literals reject anything but the constant', () => {
  const validator = literal(false);
  assert.deepEqual(codes(validator.check(false, '')), []);
  assert.deepEqual(codes(validator.check(true, '')), ['literal/mismatch']);
  assert.deepEqual(codes(validator.check(0, '')), ['literal/mismatch']);
});

test('an enum can carry the doctrine code its rejection should use', () => {
  const plain = enumOf(['a', 'b'] as const);
  const named = enumOf(['a', 'b'] as const, { code: 'provenance/inference_as_known' });
  assert.deepEqual(codes(plain.check('c', '')), ['enum/not_allowed']);
  assert.deepEqual(codes(named.check('c', '')), ['provenance/inference_as_known']);
});

test('nullable accepts null and still validates a present value', () => {
  const validator = nullable(integer({ minimum: 1 }));
  assert.deepEqual(codes(validator.check(null, '')), []);
  assert.deepEqual(codes(validator.check(2, '')), []);
  assert.deepEqual(codes(validator.check(0, '')), ['number/too_small']);
});

test('a refinement only runs once the shape is valid', () => {
  const validator = refine(object({ a: integer(), b: integer() }), {
    code: 'test/b_after_a',
    message: 'b must exceed a',
    expressedInJsonSchema: false,
    predicate: (v) => v.b > v.a,
  });
  assert.deepEqual(codes(validator.check({ a: 1, b: 2 }, '')), []);
  assert.deepEqual(codes(validator.check({ a: 2, b: 1 }, '')), ['test/b_after_a']);
  // A shape failure short-circuits, so the refinement never sees a bad value.
  assert.deepEqual(codes(validator.check({ a: 'x', b: 1 }, '')), ['type/expected_number']);
});

test('a discriminated union routes by its tag and names the tag when it is wrong', () => {
  type Tagged = { kind: 'a'; a: string } | { kind: 'b'; b: number };
  const union = discriminatedUnion<'kind', Tagged>('kind', [
    { tag: 'a', validator: object({ kind: literal('a'), a: string() }) as Validator<Tagged> },
    { tag: 'b', validator: object({ kind: literal('b'), b: integer() }) as Validator<Tagged> },
  ]);
  assert.deepEqual(codes(union.check({ kind: 'a', a: 'x' }, '')), []);
  assert.deepEqual(codes(union.check({ kind: 'c' }, '')), ['union/unknown_variant']);
  assert.deepEqual(codes(union.check({}, '')), ['union/missing_discriminant']);
  assert.deepEqual(codes(union.check({ kind: 'b', b: 'x' }, '')), ['type/expected_number']);
});

test('fullyExpressedInJsonSchema is false as soon as one rule is not expressible', () => {
  const expressible = object({ a: string({ minLength: 1 }) });
  assert.equal(expressible.fullyExpressedInJsonSchema, true);

  const crossField = refine(object({ a: integer(), b: integer() }), {
    code: 'test/x',
    message: 'x',
    expressedInJsonSchema: false,
    predicate: () => true,
  });
  assert.equal(crossField.fullyExpressedInJsonSchema, false);

  const containing = object({ nested: crossField });
  assert.equal(containing.fullyExpressedInJsonSchema, false, 'the flag must propagate upward');
});

test('parse throws with every issue, safeParse returns them', () => {
  const contract = defineContract(
    { name: 'test.thing', version: 1, title: 'Thing', description: 'x', sources: [] },
    object({ a: string(), b: boolean() }),
  );
  const result = contract.safeParse({});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.issues.length, 2, 'both missing fields are reported, not just the first');

  try {
    contract.parse({});
    assert.fail('parse should have thrown');
  } catch (error: unknown) {
    assert.ok(error instanceof ContractViolation);
    assert.equal(error.contract, 'test.thing');
    assert.equal(error.issues.length, 2);
  }
});

test('is() narrows without throwing', () => {
  const contract = defineContract(
    { name: 'test.thing', version: 1, title: 'Thing', description: 'x', sources: [] },
    object({ a: string() }),
  );
  assert.equal(contract.is({ a: 'x' }), true);
  assert.equal(contract.is({ a: 1 }), false);
});

test('the schema file name encodes the contract name and version', () => {
  assert.equal(
    schemaFileName({ name: 'cedrus.pace_card', version: 3, title: '', description: '', sources: [] }),
    'cedrus-pace_card.v3.schema.json',
  );
});

test('case-insensitive word patterns match words, not fragments', () => {
  const pattern = new RegExp(caseInsensitiveWordPattern('usually'));
  assert.ok(pattern.test('usually'));
  assert.ok(pattern.test('You are USUALLY free'));
  assert.ok(pattern.test('free, usually.'));
  assert.equal(pattern.test('unusually'), false, 'a fragment inside a longer word is not a match');
});

test('multi-word markers tolerate any whitespace', () => {
  assert.equal(matchesAnyWord('it looks   like rain', ['looks like']), 'looks like');
  assert.equal(matchesAnyWord('nothing here', ['looks like']), null);
});

test('walk visits every node once, with a usable path', () => {
  const seen: string[] = [];
  walk({ a: { b: [1, 2] } }, '', (node) => {
    if (node.key !== null) seen.push(node.path);
  });
  assert.deepEqual(seen, ['a', 'a.b']);
});

test('jsonObject accepts an arbitrary object but not an array or a scalar', () => {
  const validator = jsonObject();
  assert.deepEqual(codes(validator.check({ anything: 1 }, '')), []);
  assert.deepEqual(codes(validator.check([], '')), ['type/expected_object']);
  assert.deepEqual(codes(validator.check('x', '')), ['type/expected_object']);
});
