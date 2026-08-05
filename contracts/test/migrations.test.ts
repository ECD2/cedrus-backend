/**
 * Schema migrations.
 *
 * The behaviour that matters most is the refusal: a migration that cannot know a
 * value must stop, not default. Lesson 5 ("Fixing the code does not fix the
 * data") and Law 8 ("Anything touching existing DATA shows the plan and waits
 * for Emil") both point the same way, and the tests below are written against
 * the failure rather than the success.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { registry, migrationPlanSummary } from '../src/migrate/migrations.ts';
import { MigrationRegistry } from '../src/migrate/registry.ts';
import { goalContract } from '../src/contracts/goals.ts';
import { memberProfileContract } from '../src/contracts/member-profile.ts';
import { cardOutcomeContract } from '../src/contracts/card-outcome.ts';
import { connectionAuthorizationContract } from '../src/contracts/connection.ts';

const goalV1 = {
  schema_version: 1,
  goal_id: 'goal:g_swim',
  member_id: 'member:m_0001',
  stated_text: 'swim twice a week',
  origin: 'user_set',
  status: 'open',
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
};

const profileV1 = {
  schema_version: 1,
  member_id: 'member:m_0001',
  display_name: 'Test Member One',
  phone: '17865550101',
  phone_verified_at: '2026-07-01T12:00:00Z',
  timezone: 'America/New_York',
  work_setup: 'fully_remote',
  neighborhood: 'brickell',
  interests: ['swimming'],
  open_to_introductions: false,
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
};

const outcomeV1 = {
  schema_version: 1,
  outcome_id: 'outcome:o_0001',
  card_id: 'card:cd_0001',
  member_id: 'member:m_0001',
  outcome: 'did',
  helped: true,
  recorded_at: '2026-07-02T12:00:00Z',
};

const connectionV1 = {
  schema_version: 1,
  connection_id: 'conn:cn_0001',
  member_id: 'member:m_0001',
  provider: 'google_calendar',
  scope: 'calendar.freebusy.read',
  status: 'authorized',
  authorized_at: '2026-07-01T12:00:00Z',
  last_sync_at: null,
  revoked_at: null,
};

test('a goal migrates forward with a null lane rather than a guessed one', () => {
  const result = registry.migrateToLatest(goalContract, goalV1);
  assert.equal(result.status, 'migrated');
  if (result.status !== 'migrated') return;
  assert.equal(result.value.lane, null, 'the lane must not be inferred from the text');
  assert.equal(result.value.priority, null);
  assert.equal(result.value.stated_text, goalV1.stated_text, 'the member\'s words are preserved verbatim');
  assert.equal(result.applied.length, 1);
});

test('a profile migration carries the member\'s own answer forward instead of defaulting consent', () => {
  const result = registry.migrateToLatest(memberProfileContract, profileV1);
  assert.equal(result.status, 'migrated');
  if (result.status !== 'migrated') return;
  assert.equal(result.value.recommendable, false, 'recommendable follows what the member actually said');
  assert.equal(result.value.name_source, 'member_entered');
  assert.deepEqual(result.value.activities, ['swimming'], 'interests are carried over, not dropped');
});

test('a profile migration blocks rather than defaulting a consent field it cannot know', () => {
  const withoutAnswer: Record<string, unknown> = { ...profileV1 };
  delete withoutAnswer['open_to_introductions'];

  const result = registry.migrateToLatest(memberProfileContract, withoutAnswer);
  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['migration/cannot_fabricate'],
  );
});

test('an outcome migration records "unknown" rather than guessing how the answer arrived', () => {
  const result = registry.migrateToLatest(cardOutcomeContract, outcomeV1);
  assert.equal(result.status, 'migrated');
  if (result.status !== 'migrated') return;
  assert.equal(result.value.source, 'unknown', 'the capture path was not recorded and must not be invented');
  assert.equal(result.value.verified, false);
});

test('a silent outcome migrates to no_response, because that is a definition and not a guess', () => {
  const result = registry.migrateToLatest(cardOutcomeContract, { ...outcomeV1, outcome: 'silent', helped: null });
  assert.equal(result.status, 'migrated');
  if (result.status !== 'migrated') return;
  assert.equal(result.value.source, 'no_response');
});

test('a connection migration blocks: a named outcome and a purpose cannot be manufactured', () => {
  const result = registry.migrateToLatest(connectionAuthorizationContract, connectionV1);
  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['migration/cannot_fabricate'],
  );
  assert.match(result.issues[0]?.message ?? '', /re-authorize/);
});

test('a payload already at the current version is left alone', () => {
  const current = registry.migrateToLatest(goalContract, {
    ...goalV1,
    schema_version: 2,
    lane: 'body',
    priority: null,
  });
  assert.equal(current.status, 'already_current');
  if (current.status !== 'already_current') return;
  assert.deepEqual(current.applied, []);
});

test('a newer payload is refused rather than downgraded', () => {
  const result = registry.migrateToLatest(goalContract, { ...goalV1, schema_version: 99 });
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['migration/downgrade_refused'],
  );
});

test('a versionless payload is refused', () => {
  const withoutVersion: Record<string, unknown> = { ...goalV1 };
  delete withoutVersion['schema_version'];
  const result = registry.migrateToLatest(goalContract, withoutVersion);
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['migration/no_version'],
  );
});

test('a migrated value is validated against the target contract before it is returned', () => {
  const corrupt = { ...goalV1, stated_text: '' };
  const result = registry.migrateToLatest(goalContract, corrupt);
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.ok(result.issues.some((i) => i.code === 'string/too_short'));
});

test('the registry refuses a migration that skips a version', () => {
  assert.throws(
    () =>
      new MigrationRegistry().register({
        contract: 'cedrus.goal',
        from: 1,
        to: 3,
        describe: 'skips v2',
        touchesExistingData: false,
        up: () => ({ ok: true, value: {} }),
      }),
    /single version step/,
  );
});

test('the registry refuses two migrations from the same version', () => {
  const step = {
    contract: 'cedrus.goal',
    from: 1,
    to: 2,
    describe: 'x',
    touchesExistingData: false,
    up: () => ({ ok: true as const, value: {} }),
  };
  const local = new MigrationRegistry().register(step);
  assert.throws(() => local.register({ ...step, describe: 'y' }), /duplicate migration/);
});

test('the migration plan says which steps touch existing data', () => {
  const plan = migrationPlanSummary();
  const touching = plan.filter((s) => s.touchesExistingData).map((s) => s.contract);
  assert.deepEqual(touching, ['cedrus.member_profile', 'cedrus.connection_authorization']);
  for (const step of plan) {
    assert.ok(step.describe.length > 10, `${step.contract} needs a real description for the plan`);
  }
});
