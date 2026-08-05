/**
 * Contract-level rules that the counterexample set does not already carry, plus
 * the structural promises the package makes about itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTRACTS, contractByName } from '../src/registry.ts';
import { todayStateContract } from '../src/contracts/today.ts';
import { paceCardContract } from '../src/contracts/pace-card.ts';
import { calendarFreeBusyProjectionContract } from '../src/contracts/calendar.ts';
import { statementContract } from '../src/contracts/statement.ts';
import { apiErrorContract, apiErrorFromIssues } from '../src/contracts/api-error.ts';
import { VALID_EXAMPLES } from './examples/valid.ts';

const clone = <T>(value: T): T => structuredClone(value);

const example = (id: string): Record<string, unknown> => {
  const found = VALID_EXAMPLES.find((e) => e.id === id);
  assert.ok(found !== undefined, `no example ${id}`);
  return clone(found.value) as Record<string, unknown>;
};

const codesOf = (result: { ok: boolean; issues?: readonly { code: string }[] }): readonly string[] =>
  result.issues?.map((i) => i.code) ?? [];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('every contract has a unique name, a version, and at least one canon source', () => {
  const names = new Set<string>();
  for (const contract of CONTRACTS) {
    assert.equal(names.has(contract.name), false, `duplicate contract name ${contract.name}`);
    names.add(contract.name);
    assert.ok(contract.version >= 1, `${contract.name} needs a version`);
    assert.ok(contract.sources.length > 0, `${contract.name} must cite the canon it comes from`);
    assert.ok(contract.description.length > 20, `${contract.name} needs a real description`);
  }
});

test('every published schema declares its dialect, id and contract metadata', () => {
  for (const contract of CONTRACTS) {
    assert.equal(contract.jsonSchema['$schema'], 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(contract.jsonSchema['x-cedrus-contract'], contract.name);
    assert.equal(contract.jsonSchema['x-cedrus-version'], contract.version);
    assert.ok(String(contract.jsonSchema['$id']).includes(contract.name.replace(/\./g, '-')));
  }
});

test('contractByName finds every registered contract and nothing else', () => {
  for (const contract of CONTRACTS) {
    assert.equal(contractByName(contract.name)?.name, contract.name);
  }
  assert.equal(contractByName('cedrus.not_a_contract'), undefined);
});

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

test('Today accepts a calendar-derived known day line', () => {
  const today = example('today.before_calendar');
  today['timing_basis'] = 'calendar';
  today['fallback_notice'] = null;
  today['day_line'] = {
    statement_id: 'stmt:s_known_2',
    kind: 'known',
    text: 'You are booked until 2pm, then clear until 6.',
    source: { type: 'calendar_freebusy', ref: 'projection:p_0001' },
    observed_at: '2026-08-04T18:00:00Z',
  };
  const result = todayStateContract.safeParse(today);
  assert.ok(result.ok, JSON.stringify(codesOf(result)));
});

test('a known day line that did not come from the calendar is rejected', () => {
  const today = example('today.before_calendar');
  today['timing_basis'] = 'calendar';
  today['fallback_notice'] = null;
  today['day_line'] = {
    statement_id: 'stmt:s_known_3',
    kind: 'known',
    text: 'You are clear this afternoon.',
    source: { type: 'member_stated', ref: 'profile:pr_0001' },
    observed_at: '2026-08-04T18:00:00Z',
  };
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('today/known_day_line_without_calendar'));
});

test('Today refuses a notice when there was no fallback', () => {
  const today = example('today.before_calendar');
  today['timing_basis'] = 'calendar';
  today['day_line'] = {
    statement_id: 'stmt:s_known_4',
    kind: 'known',
    text: 'You are clear until 6.',
    source: { type: 'calendar_freebusy', ref: 'projection:p_0001' },
    observed_at: '2026-08-04T18:00:00Z',
  };
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('today/notice_without_fallback'));
});

test('Today shows delivered cards only', () => {
  const today = example('today.before_calendar');
  const card = example('pace_card.delivered');
  card['status'] = 'approved';
  card['delivered_at'] = null;
  card['delivered_via'] = null;
  card['for_date'] = today['for_date'];
  today['card'] = card;
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('today/undelivered_card_shown'));
});

test("Today refuses another member's card", () => {
  const today = example('today.before_calendar');
  const card = example('pace_card.delivered');
  card['member_id'] = 'member:m_0002';
  today['card'] = card;
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('today/card_member_mismatch'));
});

test('Today never shows an empty state alongside a card', () => {
  const today = example('today.before_calendar');
  today['card'] = example('pace_card.delivered');
  today['empty_state'] = {
    known_so_far: ['You work from Brickell.'],
    waiting_for: ['One thing you want more of.'],
    shows_example_card: false,
  };
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('today/empty_state_with_card'));
});

test('an empty state cannot claim to show an example card', () => {
  const today = example('today.empty_state');
  const emptyState = today['empty_state'] as Record<string, unknown>;
  emptyState['shows_example_card'] = true;
  const result = todayStateContract.safeParse(today);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('literal/mismatch'));
});

// ---------------------------------------------------------------------------
// Pace card
// ---------------------------------------------------------------------------

test('a card whose action serves a different goal is rejected', () => {
  const card = example('pace_card.delivered');
  card['goal_ref'] = 'goal:g_ship';
  const result = paceCardContract.safeParse(card);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('pace_card/action_goal_mismatch'));
});

test('a card with a delivery time but no delivered status is rejected', () => {
  const card = example('pace_card.delivered');
  card['status'] = 'approved';
  const result = paceCardContract.safeParse(card);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('pace_card/delivery_without_status'));
});

test('a card cannot repeat the same statement id', () => {
  const card = example('pace_card.delivered');
  const parts = card['parts'] as Record<string, unknown>[];
  card['parts'] = [parts[0], parts[0], parts[3]];
  const result = paceCardContract.safeParse(card);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('pace_card/duplicate_statement'));
});

test('a draft card is valid, because generation happens before review', () => {
  const card = example('pace_card.delivered');
  card['status'] = 'draft';
  card['review_ref'] = null;
  card['delivered_at'] = null;
  card['delivered_via'] = null;
  const result = paceCardContract.safeParse(card);
  assert.ok(result.ok, JSON.stringify(codesOf(result)));
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test('a busy interval that ends before it starts is rejected', () => {
  const projection = example('calendar_projection.live');
  projection['busy'] = [{ starts_at: '2026-08-04T18:00:00Z', ends_at: '2026-08-04T13:00:00Z' }];
  const result = calendarFreeBusyProjectionContract.safeParse(projection);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('window/ends_before_starts'));
});

test('a live projection and a disconnected one are distinguishable, both with an empty busy list', () => {
  const live = example('calendar_projection.live');
  live['busy'] = [];
  const disconnected = example('calendar_projection.disconnected');

  assert.ok(calendarFreeBusyProjectionContract.safeParse(live).ok);
  assert.ok(calendarFreeBusyProjectionContract.safeParse(disconnected).ok);
  assert.notEqual(live['freshness'], disconnected['freshness']);
  assert.notEqual(live['synced_at'], disconnected['synced_at']);
});

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

test('a statement without a kind cannot be constructed', () => {
  const result = statementContract.safeParse({ statement_id: 'stmt:s_1', text: 'something' });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('union/missing_discriminant'));
});

test('a user-reported statement cannot claim to be verified', () => {
  const result = statementContract.safeParse({
    statement_id: 'stmt:s_1',
    kind: 'user_reported',
    text: 'You swam this morning.',
    source: { type: 'member_sms', ref: 'request:r_0001' },
    reported_at: '2026-08-04T12:00:00Z',
    verified: true,
  });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('literal/mismatch'));
});

// ---------------------------------------------------------------------------
// API errors
// ---------------------------------------------------------------------------

test('apiErrorFromIssues produces a valid error that names the contract and the codes', () => {
  const error = apiErrorFromIssues({
    contract: 'cedrus.pace_card',
    issues: [{ path: 'parts[0]', code: 'provenance/inference_as_known', message: 'an inference cannot be known' }],
    request_id: 'request:r_0009',
    occurred_at: '2026-08-04T18:00:00Z',
  });
  const result = apiErrorContract.safeParse(error);
  assert.ok(result.ok, JSON.stringify(codesOf(result)));
  assert.equal(error.http_status, 422);
  assert.equal(error.contract, 'cedrus.pace_card');
});

test('an error body carrying a phone number is rejected', () => {
  const error = example('api_error.contract_violation');
  error['phone'] = '17865550101';
  const result = apiErrorContract.safeParse(error);
  assert.equal(result.ok, false);
  // The shape is closed, so the unknown key fires first; the deep guard is the
  // second line of defence for payloads whose shape is not closed.
  assert.ok(codesOf(result).includes('object/unknown_key'));
});
