/**
 * The guards, exercised directly.
 *
 * The contracts wrap these, but the guards are also exported for use at
 * boundaries the contracts do not cover: a sync job holding a raw provider
 * response, an OAuth handler assembling a scope list before any record exists.
 * Reboot plan §17 is explicit that the calendar enforcement point is the fetch,
 * which is upstream of every contract in this package, so the fetch-time guard
 * needs its own tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CalendarBoundaryViolation,
  assertNoCalendarContent,
  findCalendarContent,
} from '../src/guards/calendar-boundary.ts';
import {
  checkCountIsDerived,
  checkPersonOrigin,
  findContactDisclosure,
  findFabricatedProgress,
} from '../src/guards/fabrication.ts';
import {
  checkInferredLanguage,
  checkKnownLanguage,
  checkKnownSource,
  checkNoLaundering,
} from '../src/guards/provenance.ts';
import {
  checkAuthorization,
  checkNamedOutcome,
  checkScopesAllowed,
  checkScopesJustified,
} from '../src/guards/authorization.ts';

const codes = (issues: readonly { readonly code: string }[]): readonly string[] => issues.map((i) => i.code);

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test('a known statement may not cite an inference source', () => {
  assert.deepEqual(codes(checkKnownSource('calendar_freebusy', 'source.type')), []);
  assert.deepEqual(codes(checkKnownSource('member_stated', 'source.type')), []);
  assert.deepEqual(codes(checkKnownSource('model_inference', 'source.type')), ['provenance/inference_as_known']);
  assert.deepEqual(codes(checkKnownSource('heuristic', 'source.type')), ['provenance/inference_as_known']);
  assert.deepEqual(codes(checkKnownSource('statistical_prior', 'source.type')), ['provenance/inference_as_known']);
});

test('a known statement may not cite a self-report', () => {
  assert.deepEqual(codes(checkKnownSource('member_sms', 'source.type')), ['provenance/inference_as_known']);
  assert.deepEqual(codes(checkKnownSource('member_tap', 'source.type')), ['provenance/inference_as_known']);
});

test('hedge language in a known statement is rejected, in any casing', () => {
  assert.deepEqual(codes(checkKnownLanguage('You are clear after 2pm.', 'text')), []);
  assert.deepEqual(codes(checkKnownLanguage('You are usually clear after 2pm.', 'text')), ['provenance/hedged_known']);
  assert.deepEqual(codes(checkKnownLanguage('USUALLY clear.', 'text')), ['provenance/hedged_known']);
  assert.deepEqual(codes(checkKnownLanguage('It might be open.', 'text')), ['provenance/hedged_known']);
  assert.deepEqual(codes(checkKnownLanguage('Looks like a quiet afternoon.', 'text')), ['provenance/hedged_known']);
});

test('a hedge word inside a longer word is not a false positive', () => {
  // "oftentimes" contains "often"; the boundaries in the pattern must stop it
  // matching a different word, or the guard becomes noise and gets disabled.
  assert.deepEqual(codes(checkKnownLanguage('The mightiest swim of the week.', 'text')), []);
});

test('certainty language in an inferred statement is rejected', () => {
  assert.deepEqual(codes(checkInferredLanguage('Thursday is usually open.', 'text')), []);
  assert.deepEqual(codes(checkInferredLanguage('You are definitely free.', 'text')), ['provenance/certain_inference']);
  assert.deepEqual(codes(checkInferredLanguage('Confirmed: you are free.', 'text')), ['provenance/certain_inference']);
});

test('a known statement may not be derived from a softer one', () => {
  const statements = [
    { kind: 'inferred' as const, statement_id: 'stmt:a' },
    { kind: 'user_reported' as const, statement_id: 'stmt:b' },
    { kind: 'known' as const, statement_id: 'stmt:c', derived_from: ['stmt:a'] },
    { kind: 'known' as const, statement_id: 'stmt:d', derived_from: ['stmt:b'] },
  ];
  assert.deepEqual(codes(checkNoLaundering(statements, 'parts')), [
    'provenance/laundered_known',
    'provenance/laundered_known',
  ]);
});

test('a known statement derived from another known statement is fine', () => {
  const statements = [
    { kind: 'known' as const, statement_id: 'stmt:a' },
    { kind: 'known' as const, statement_id: 'stmt:b', derived_from: ['stmt:a'] },
  ];
  assert.deepEqual(codes(checkNoLaundering(statements, 'parts')), []);
});

// ---------------------------------------------------------------------------
// Calendar boundary
// ---------------------------------------------------------------------------

test('the calendar guard finds forbidden fields at any depth', () => {
  const providerResponse = {
    calendars: {
      primary: {
        busy: [{ start: '2026-08-04T13:00:00Z', end: '2026-08-04T18:00:00Z', summary: 'Board review' }],
      },
    },
  };
  const found = findCalendarContent(providerResponse);
  assert.deepEqual(codes(found), ['calendar/forbidden_field']);
  assert.match(found[0]?.path ?? '', /summary/);
});

test('the calendar guard normalises casing, separators and provider prefixes', () => {
  for (const key of ['title', 'Title', 'TITLE', 'event_title', 'eventTitle', 'EVENT-TITLE', 'meeting_location', 'calendarSummary']) {
    assert.deepEqual(
      codes(findCalendarContent({ [key]: 'x' })),
      ['calendar/forbidden_field'],
      `${key} should be rejected`,
    );
  }
});

test('the calendar guard does not fire on words that merely contain a forbidden one', () => {
  /**
   * A noisy guard gets turned off, which is the failure mode this test exists to
   * prevent. `allocation` contains `location`; `subtitle` contains `title`.
   */
  for (const key of ['allocation', 'subtitle', 'relocation_pending', 'summarised_at']) {
    assert.deepEqual(codes(findCalendarContent({ [key]: 'x' })), [], `${key} should not be rejected`);
  }
});

test('the calendar guard passes a clean free/busy payload', () => {
  const clean = { busy: [{ starts_at: '2026-08-04T13:00:00Z', ends_at: '2026-08-04T18:00:00Z' }] };
  assert.deepEqual(codes(findCalendarContent(clean)), []);
});

test('assertNoCalendarContent throws at the fetch boundary', () => {
  assert.throws(
    () => assertNoCalendarContent({ items: [{ description: 'quarterly planning' }] }),
    (error: unknown) => error instanceof CalendarBoundaryViolation,
  );
  assert.doesNotThrow(() => assertNoCalendarContent({ busy: [] }));
});

test('every field named in reboot plan §17 is on the forbidden list', () => {
  const namedInDoctrine = [
    'title',
    'description',
    'location',
    'attendees',
    'organizer',
    'conferenceData',
    'hangoutLink',
    'recurrence',
    'colorId',
    'calendarName',
  ];
  for (const field of namedInDoctrine) {
    assert.deepEqual(
      codes(findCalendarContent({ [field]: 'x' })),
      ['calendar/forbidden_field'],
      `${field} is named in the doctrine but is not rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// Fabrication
// ---------------------------------------------------------------------------

test('a count must name every record it counted', () => {
  assert.deepEqual(
    codes(checkCountIsDerived({ value: 3, basis: 'observed_rows', source_refs: ['a', 'b', 'c'] }, 'count')),
    [],
  );
  assert.deepEqual(
    codes(checkCountIsDerived({ value: 3, basis: 'observed_rows', source_refs: [] }, 'count')),
    ['fabrication/count_not_derived'],
  );
  assert.deepEqual(
    codes(checkCountIsDerived({ value: 1, basis: 'observed_rows', source_refs: ['a', 'b'] }, 'count')),
    ['fabrication/count_not_derived'],
  );
});

test('a count may not cite the same record twice to inflate itself', () => {
  assert.deepEqual(
    codes(checkCountIsDerived({ value: 2, basis: 'observed_rows', source_refs: ['a', 'a'] }, 'count')),
    ['fabrication/count_duplicate_refs'],
  );
});

test('scores, streaks and engagement metrics are rejected at any depth', () => {
  for (const key of ['score', 'streak', 'points', 'level', 'wellness_score', 'app_opens', 'messages_sent']) {
    assert.deepEqual(
      codes(findFabricatedProgress({ progress: { [key]: 1 } })),
      ['fabrication/derived_score'],
      `${key} should be rejected`,
    );
  }
  assert.deepEqual(codes(findFabricatedProgress({ outcomes_recorded: { value: 2 } })), []);
});

test('a person may not originate from a model', () => {
  assert.deepEqual(codes(checkPersonOrigin('member_stated', 'origin')), []);
  assert.deepEqual(codes(checkPersonOrigin('operator_entered', 'origin')), []);
  assert.deepEqual(codes(checkPersonOrigin('model_inference', 'origin')), ['fabrication/invented_person']);
  assert.deepEqual(codes(checkPersonOrigin('generated', 'origin')), ['fabrication/invented_person']);
});

test('contact details are rejected wherever they appear', () => {
  for (const key of ['phone', 'phone_e164', 'email', 'instagram', 'home_address']) {
    assert.deepEqual(
      codes(findContactDisclosure({ person: { [key]: 'x' } })),
      ['fabrication/contact_disclosure'],
      `${key} should be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

const goodAuth = {
  scopes: ['calendar.freebusy.read'],
  purpose: {
    code: 'place_suggestions_in_open_time',
    statement: 'Place suggestions in time that is actually open on your calendar.',
  },
  named_outcome: {
    code: 'suggestions_land_in_time_you_actually_have',
    statement: 'Suggestions land in time you actually have, instead of on top of a meeting.',
  },
};

test('a well-formed authorization passes every check', () => {
  assert.deepEqual(codes(checkAuthorization(goodAuth)), []);
});

test('scopes wider than free/busy are rejected', () => {
  assert.deepEqual(codes(checkScopesAllowed(['calendar.events.read'], 'scopes')), ['authorization/scope_not_allowed']);
  assert.deepEqual(codes(checkScopesAllowed(['calendar.readonly'], 'scopes')), ['authorization/scope_not_allowed']);
  assert.deepEqual(codes(checkScopesAllowed(['https://www.googleapis.com/auth/calendar'], 'scopes')), [
    'authorization/scope_not_allowed',
  ]);
});

test('an authorization with no scope at all is rejected', () => {
  assert.deepEqual(codes(checkScopesAllowed([], 'scopes')), ['authorization/no_scope']);
});

test('an unnamed or vague outcome is rejected', () => {
  assert.deepEqual(
    codes(checkNamedOutcome({ code: 'something_else', statement: 'A specific, checkable thing.' }, 'named_outcome')),
    ['authorization/outcome_not_named'],
  );
  assert.deepEqual(
    codes(
      checkNamedOutcome(
        { code: 'suggestions_land_in_time_you_actually_have', statement: 'To improve your experience.' },
        'named_outcome',
      ),
    ),
    ['authorization/outcome_vague'],
  );
});

test('a scope the declared purpose does not consume is rejected', () => {
  /**
   * Nothing is collected without a shipped feature consuming it. This is the
   * check that catches a scope added "while we are in there", which is how
   * scope creep actually happens.
   */
  const unjustified = { ...goodAuth, scopes: ['calendar.freebusy.read', 'contacts.read'] };
  assert.deepEqual(codes(checkScopesJustified(unjustified, '')), ['authorization/scope_unjustified']);
});

test('an undeclared purpose is not narrow', () => {
  const undeclared = { ...goodAuth, purpose: { code: 'general_personalization', statement: 'Because it helps.' } };
  assert.deepEqual(codes(checkScopesJustified(undeclared, '')), ['authorization/purpose_not_narrow']);
});
