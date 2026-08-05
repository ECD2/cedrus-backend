/**
 * The vendor-time amendments, 2026-08-05.
 *
 * This copy of the contracts package is not the lab's. Six amendments were
 * applied when it was vendored into cedrus-backend, from the boardroom's
 * canonical contract catalog and from reboot canon. `VENDORED_FROM.md` lists
 * them with their authority; this file is the part that fails if one of them
 * silently comes undone.
 *
 * The discipline here is Law 3, and it is the reason each amendment gets TWO
 * assertions rather than one. A counterexample alone cannot tell a widened enum
 * from an unchanged one: `origin: 'imported'` is refused before and after, so
 * its rejection proves nothing about whether `cedrus_inferred` was added. Each
 * amendment therefore asserts both directions:
 *
 *   ACCEPTS  a payload the lab copy refuses  (proves the amendment landed)
 *   REFUSES  a payload with the exact code   (proves the domain is still closed)
 *
 * The ACCEPTS half is the control. Delete the amendment and it goes red.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { contractByName } from '../src/registry.ts';
import { VALID_EXAMPLES } from './examples/valid.ts';
import { COUNTEREXAMPLES } from './examples/invalid.ts';
import { GOAL_ORIGINS, GOAL_STATUSES, GOAL_TEXT_MAX_CHARS } from '../src/contracts/goals.ts';
import { REJECTION_REASONS, REJECTION_SCOPES } from '../src/contracts/card-outcome.ts';
import { CONNECTION_STATUSES } from '../src/contracts/connection.ts';
import { ASSISTANT_JOBS } from '../src/common/primitives.ts';

const accepts = (exampleId: string): void => {
  const example = VALID_EXAMPLES.find((e) => e.id === exampleId);
  assert.ok(example !== undefined, `no valid example named ${exampleId}`);
  const contract = contractByName(example.contract);
  assert.ok(contract !== undefined, `unknown contract ${example.contract}`);
  const result = contract.safeParse(example.value);
  assert.ok(result.ok, `${exampleId} must be accepted; issues: ${result.ok ? '' : JSON.stringify(result.issues)}`);
};

const refusesWith = (counterexampleId: string, expectedCode: string): void => {
  const counter = COUNTEREXAMPLES.find((c) => c.id === counterexampleId);
  assert.ok(counter !== undefined, `no counterexample named ${counterexampleId}`);
  assert.equal(
    counter.expected_code,
    expectedCode,
    `${counterexampleId} declares ${counter.expected_code}, this test expects ${expectedCode}`,
  );
  const contract = contractByName(counter.contract);
  assert.ok(contract !== undefined, `unknown contract ${counter.contract}`);
  const result = contract.safeParse(counter.value);
  assert.equal(result.ok, false, `${counterexampleId} must be refused`);
  if (result.ok) return;
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes(expectedCode), `${counterexampleId}: expected ${expectedCode}, got ${codes.join(', ')}`);
};

// --- amendment 1: goal.status → the deployed CHECK ---------------------------

test('amendment 1: goal.status is the deployed user_goals_status_check', () => {
  assert.deepEqual([...GOAL_STATUSES], ['open', 'completed', 'missed', 'canceled']);
  accepts('goal.missed'); // the lab enum (active/paused/retired) cannot hold this
  refusesWith('goal.status_active', 'enum/not_allowed'); // the lab enum accepts it
  refusesWith('goal.status_invented', 'enum/not_allowed');
});

// --- amendment 2: goal.origin gains cedrus_inferred --------------------------

test('amendment 2: goal.origin can hold the live partition key', () => {
  assert.deepEqual([...GOAL_ORIGINS], ['user_set', 'cedrus_inferred', 'operator_entered']);
  accepts('goal.pipeline_inferred');
  refusesWith('goal.origin_invented', 'enum/not_allowed');
});

// --- amendment 3: card_outcome rejection scope and reason --------------------

test('amendment 3: "not this" and "not today" are separable', () => {
  assert.deepEqual([...REJECTION_SCOPES], ['this_action', 'today']);
  assert.deepEqual([...REJECTION_REASONS], ['wrong_thing', 'wrong_time', 'wrong_place', 'unspecified']);
  accepts('card_outcome.not_today');
  accepts('card_outcome.rejected_without_saying_why'); // `unspecified` is new
  refusesWith('card_outcome.rejection_scope_invented', 'enum/not_allowed');
  refusesWith('card_outcome.rejection_reason_invented', 'enum/not_allowed');
});

test('amendment 3: the old field name is refused rather than ignored', () => {
  // The object is closed, so the rename cannot fail silently. A caller still
  // sending `not_this_reason` gets an error, not a dropped answer.
  refusesWith('card_outcome.old_field_name', 'object/unknown_key');
});

// --- amendment 4: connection status gains disconnected -----------------------

test('amendment 4: a member disconnecting is not a provider revoking', () => {
  assert.deepEqual([...CONNECTION_STATUSES], ['authorized', 'expired', 'revoked', 'disconnected', 'failed']);
  accepts('connection_authorization.disconnected_by_member');
  refusesWith('connection_authorization.half_connected', 'enum/not_allowed');
});

// --- amendment 5: assistant jobs re-derived from reboot §6.4 -----------------

test('amendment 5: the assistant jobs are the current §6.4 list', () => {
  assert.deepEqual([...ASSISTANT_JOBS], [
    'find_somewhere_to_work',
    'suggest_for_open_window',
    'make_or_schedule_plan',
    'record_what_happened',
    'answer_goal_or_progress',
  ]);
  accepts('agent_request.record_what_happened');
});

test('amendment 5: every retired job is refused, and each was legal in the lab copy', () => {
  refusesWith('agent_request.retired_job_local_activity', 'enum/not_allowed');
  refusesWith('agent_request.retired_job_calendar_of_events', 'enum/not_allowed');
  refusesWith('agent_request.retired_job_connect_with_member', 'enum/not_allowed');
});

// --- amendment 6: goal text cap matches the deployed service ------------------

test('amendment 6: the goal text cap is the deployed 280, and it still rejects', () => {
  assert.equal(GOAL_TEXT_MAX_CHARS, 280);
  accepts('goal.long_but_legal'); // 250 chars: refused by the lab's 200 cap
  refusesWith('goal.text_over_the_cap', 'string/too_long');
});

// --- the amendments do not leak into the runtime path -----------------------

test('the retired vocabulary appears nowhere in the amended contracts', () => {
  const retired = [
    'find_local_activity',
    'answer_calendar_of_events',
    'connect_with_member',
    'not_this_reason',
  ];
  const serialised = JSON.stringify([
    contractByName('cedrus.goal')?.jsonSchema,
    contractByName('cedrus.card_outcome')?.jsonSchema,
    contractByName('cedrus.connection_authorization')?.jsonSchema,
    contractByName('cedrus.agent_request')?.jsonSchema,
  ]);
  for (const word of retired) {
    assert.ok(!serialised.includes(word), `retired vocabulary "${word}" still reaches the published schema`);
  }
});
