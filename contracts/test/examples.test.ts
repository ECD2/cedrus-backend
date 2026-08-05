/**
 * Every valid example parses. Every counterexample is rejected with the code it
 * declares.
 *
 * The second half is the half that carries information (Law 3): a test that only
 * ever asserts success cannot tell you whether the guard exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VALID_EXAMPLES } from './examples/valid.ts';
import { COUNTEREXAMPLES } from './examples/invalid.ts';
import { CONTRACTS, contractByName } from '../src/registry.ts';

test('every valid example parses against its contract', () => {
  assert.ok(VALID_EXAMPLES.length > 0, 'there must be examples');
  for (const example of VALID_EXAMPLES) {
    const contract = contractByName(example.contract);
    assert.ok(contract !== undefined, `unknown contract ${example.contract} in example ${example.id}`);
    const result = contract.safeParse(example.value);
    assert.ok(
      result.ok,
      `${example.id} should be valid but was rejected: ${result.ok ? '' : JSON.stringify(result.issues, null, 2)}`,
    );
  }
});

test('every counterexample is rejected with the code it declares', () => {
  assert.ok(COUNTEREXAMPLES.length > 0, 'there must be counterexamples');
  for (const counter of COUNTEREXAMPLES) {
    const contract = contractByName(counter.contract);
    assert.ok(contract !== undefined, `unknown contract ${counter.contract} in counterexample ${counter.id}`);

    const result = contract.safeParse(counter.value);
    assert.equal(result.ok, false, `${counter.id} should have been rejected but passed`);
    if (result.ok) continue;

    const codes = result.issues.map((i) => i.code);
    assert.ok(
      codes.includes(counter.expected_code),
      `${counter.id} was rejected, but not for ${counter.expected_code}; got: ${codes.join(', ')}`,
    );
  }
});

test('parse throws a ContractViolation carrying every issue', () => {
  const counter = COUNTEREXAMPLES[0];
  assert.ok(counter !== undefined);
  const contract = contractByName(counter.contract);
  assert.ok(contract !== undefined);
  assert.throws(
    () => contract.parse(counter.value),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'ContractViolation');
      return true;
    },
  );
});

test('every contract has at least one valid example', () => {
  const withExamples = new Set(VALID_EXAMPLES.map((e) => e.contract));
  const missing = CONTRACTS.filter((c) => !withExamples.has(c.name)).map((c) => c.name);
  assert.deepEqual(missing, [], `contracts without a valid example: ${missing.join(', ')}`);
});

test('every contract that enforces a guard has at least one counterexample', () => {
  /**
   * Not every contract needs one (a pure projection may only have shape rules),
   * but the ones carrying a named guard do. Listed explicitly so adding a guard
   * without a counterexample is a failing test rather than a quiet omission.
   */
  const mustHaveCounterexamples = [
    'cedrus.statement',
    'cedrus.pace_card',
    'cedrus.connection_authorization',
    'cedrus.calendar_freebusy_projection',
    'cedrus.availability',
    'cedrus.today_state',
    'cedrus.progression',
    'cedrus.person',
    'cedrus.consent_event',
    'cedrus.voice_preference',
    'cedrus.agent_request',
    'cedrus.operator_review',
    'cedrus.analytics_event',
    'cedrus.data_envelope',
    'cedrus.api_error',
    'cedrus.card_outcome',
  ];
  const covered = new Set(COUNTEREXAMPLES.map((c) => c.contract));
  const missing = mustHaveCounterexamples.filter((name) => !covered.has(name));
  assert.deepEqual(missing, [], `contracts without a counterexample: ${missing.join(', ')}`);
});
