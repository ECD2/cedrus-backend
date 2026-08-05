/**
 * Invalid counterexamples.
 *
 * Each one is a payload the product must refuse, paired with the issue code that
 * refusal has to produce. These are the tests that carry information: a valid
 * example passing proves the shape is expressible, but only a counterexample
 * being *rejected*, with the right code, proves a guard is doing anything.
 *
 * `json_schema_catches` records whether the published JSON Schema also rejects
 * the payload. It is asserted, not assumed: `test/json-schema-agreement.test.ts`
 * runs every counterexample through Ajv and fails if the recorded value is
 * wrong. That keeps the TypeScript-only coverage gap visible and stops it
 * widening quietly.
 */

import {
  inferredWindow,
  knownFromCalendar,
  proposedAction,
  VALID_EXAMPLES,
} from './valid.ts';

export interface Counterexample {
  readonly id: string;
  readonly contract: string;
  /** Which doctrine this payload violates. */
  readonly why: string;
  /** The issue code the rejection must produce. */
  readonly expected_code: string;
  /** Whether the published JSON Schema also rejects it. Asserted by the agreement test. */
  readonly json_schema_catches: boolean;
  readonly value: unknown;
}

const clone = <T>(value: T): T => structuredClone(value);

const validValue = (id: string): unknown => {
  const found = VALID_EXAMPLES.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no valid example named ${id}`);
  return clone(found.value);
};

/** Mutates a nested field on a cloned valid example. */
const withField = (id: string, path: readonly string[], value: unknown): unknown => {
  const root = validValue(id) as Record<string, unknown>;
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (key === undefined) break;
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last !== undefined) cursor[last] = value;
  return root;
};

const withoutField = (id: string, key: string): unknown => {
  const root = validValue(id) as Record<string, unknown>;
  delete root[key];
  return root;
};

export const COUNTEREXAMPLES: readonly Counterexample[] = [
  // --- an inference presented as known -------------------------------------
  {
    id: 'known.cites_model_inference',
    contract: 'cedrus.statement',
    why: 'A known statement citing a model inference is an inference wearing a known label.',
    expected_code: 'provenance/inference_as_known',
    json_schema_catches: true,
    value: { ...clone(knownFromCalendar), source: { type: 'model_inference', ref: 'run:mr_0001' } },
  },
  {
    id: 'known.cites_self_report',
    contract: 'cedrus.statement',
    why: 'Self-reported activity never gets promoted to a known fact.',
    expected_code: 'provenance/inference_as_known',
    json_schema_catches: true,
    value: { ...clone(knownFromCalendar), source: { type: 'member_sms', ref: 'request:r_0001' } },
  },
  {
    id: 'known.hedged_language',
    contract: 'cedrus.statement',
    why: 'The label can be right while the sentence lies. "Usually" is a guess.',
    expected_code: 'provenance/hedged_known',
    json_schema_catches: true,
    value: { ...clone(knownFromCalendar), text: 'You are usually clear after 2pm.' },
  },
  {
    id: 'inferred.certain_language',
    contract: 'cedrus.statement',
    why: 'The mirror failure: an inference asserting certainty.',
    expected_code: 'provenance/certain_inference',
    json_schema_catches: true,
    value: { ...clone(inferredWindow), text: 'You are definitely free on Thursday afternoon.' },
  },
  {
    id: 'inferred.no_basis',
    contract: 'cedrus.statement',
    why: 'An inference from nothing is a guess.',
    expected_code: 'array/too_few',
    json_schema_catches: true,
    value: { ...clone(inferredWindow), basis: [] },
  },
  {
    id: 'proposed_action.manufactured_urgency',
    contract: 'cedrus.statement',
    why: 'No manufactured urgency anywhere. The "invisible cap" rule, generalised.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: { ...clone(proposedAction), urgency: 'high' },
  },

  // --- pace card -----------------------------------------------------------
  {
    id: 'pace_card.laundered_known',
    contract: 'cedrus.pace_card',
    why: 'A known statement derived from an inferred one. Provenance does not launder.',
    expected_code: 'provenance/laundered_known',
    json_schema_catches: false,
    value: withField('pace_card.delivered', ['parts'], [
      { ...clone(knownFromCalendar), derived_from: ['stmt:s_inferred_1'] },
      clone(inferredWindow),
      clone(proposedAction),
    ]),
  },
  {
    id: 'pace_card.two_actions',
    contract: 'cedrus.pace_card',
    why: 'Two proposed actions means neither is the one thing.',
    expected_code: 'pace_card/not_one_action',
    json_schema_catches: false,
    value: withField('pace_card.delivered', ['parts'], [
      clone(knownFromCalendar),
      clone(proposedAction),
      { ...clone(proposedAction), statement_id: 'stmt:s_action_2' },
    ]),
  },
  {
    id: 'pace_card.all_inference',
    contract: 'cedrus.pace_card',
    why: 'A card resting on nothing known or reported is a guess with a layout.',
    expected_code: 'pace_card/no_grounded_statement',
    json_schema_catches: false,
    value: withField('pace_card.delivered', ['parts'], [clone(inferredWindow), clone(proposedAction)]),
  },
  {
    id: 'pace_card.delivered_unreviewed',
    contract: 'cedrus.pace_card',
    why: 'Every card is reviewed before delivery.',
    expected_code: 'pace_card/delivered_unreviewed',
    json_schema_catches: false,
    value: withField('pace_card.delivered', ['review_ref'], null),
  },

  // --- connector authorization --------------------------------------------
  {
    id: 'connection.scope_wider_than_freebusy',
    contract: 'cedrus.connection_authorization',
    why: 'Reading events is wider than free/busy. Widening the scope is Emil\'s decision.',
    expected_code: 'authorization/scope_not_allowed',
    json_schema_catches: true,
    value: withField('connection_authorization.google_freebusy', ['scopes'], ['calendar.events.read']),
  },
  {
    id: 'connection.no_named_outcome',
    contract: 'cedrus.connection_authorization',
    why: 'An authorization without a named outcome asks for access in exchange for nothing stated.',
    expected_code: 'object/missing_required',
    json_schema_catches: true,
    value: withoutField('connection_authorization.google_freebusy', 'named_outcome'),
  },
  {
    id: 'connection.vague_outcome',
    contract: 'cedrus.connection_authorization',
    why: 'An outcome that could be printed on any product\'s consent screen is not a named outcome.',
    expected_code: 'authorization/outcome_vague',
    json_schema_catches: true,
    value: withField(
      'connection_authorization.google_freebusy',
      ['named_outcome', 'statement'],
      'We use this to improve your experience inside Cedrus over time.',
    ),
  },
  {
    id: 'connection.purpose_not_declared',
    contract: 'cedrus.connection_authorization',
    why: 'A purpose outside the declared set is not narrow, it is unbounded.',
    expected_code: 'authorization/purpose_not_narrow',
    json_schema_catches: true,
    value: withField('connection_authorization.google_freebusy', ['purpose', 'code'], 'general_personalization'),
  },
  {
    id: 'connection.writes_to_provider',
    contract: 'cedrus.connection_authorization',
    why: 'Cedrus does not create or change events. The promise is a const, not a setting.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('connection_authorization.google_freebusy', ['writes_to_provider'], true),
  },
  {
    id: 'connection.client_side_tokens',
    contract: 'cedrus.connection_authorization',
    why: 'Tokens are server side only. Never in the client bundle, a cookie, or localStorage.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('connection_authorization.google_freebusy', ['token_storage'], 'client'),
  },

  // --- calendar boundary ---------------------------------------------------
  {
    id: 'calendar.busy_interval_with_title',
    contract: 'cedrus.calendar_freebusy_projection',
    why: 'An event title has no representation in this contract, at any depth.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: withField('calendar_projection.live', ['busy'], [
      { starts_at: '2026-08-04T13:00:00Z', ends_at: '2026-08-04T18:00:00Z', title: 'Board review' },
    ]),
  },
  {
    id: 'calendar.projection_with_attendees',
    contract: 'cedrus.calendar_freebusy_projection',
    why: 'Attendees are never requested, never stored, never logged.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: { ...(validValue('calendar_projection.live') as Record<string, unknown>), attendees: ['a@example.invalid'] },
  },
  {
    id: 'calendar.projection_with_location',
    contract: 'cedrus.calendar_freebusy_projection',
    why: 'A location would tell Cedrus where a member is, which no promise permits.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: { ...(validValue('calendar_projection.live') as Record<string, unknown>), location: '1234 Brickell Ave' },
  },
  {
    id: 'availability.stated_without_notice',
    contract: 'cedrus.availability',
    why: 'A silent fallback looks certain while guessing. Lesson 7, in product form.',
    expected_code: 'availability/basis_notice_mismatch',
    json_schema_catches: false,
    value: withField('availability.stated', ['fallback_notice'], null),
  },

  // --- Today ---------------------------------------------------------------
  {
    id: 'today.stated_timing_as_known',
    contract: 'cedrus.today_state',
    why: 'Timing derived from stated windows is an inference. "Usually open" only becomes "open" with a calendar.',
    expected_code: 'today/stated_timing_presented_as_known',
    json_schema_catches: false,
    value: withField('today.before_calendar', ['day_line'], clone(knownFromCalendar)),
  },
  {
    id: 'today.silent_fallback',
    contract: 'cedrus.today_state',
    why: 'Today fell back to stated windows and did not say so.',
    expected_code: 'today/silent_fallback',
    json_schema_catches: false,
    value: withField('today.before_calendar', ['fallback_notice'], null),
  },

  // --- fabricated counts, people and progress ------------------------------
  {
    id: 'progression.fabricated_count',
    contract: 'cedrus.progression',
    why: 'A count that cannot name what it counted. "If three people are going, it says three."',
    expected_code: 'fabrication/count_not_derived',
    json_schema_catches: false,
    value: withField('progression.moved', ['lines'], [
      {
        goal_ref: 'goal:g_swim',
        goal_stated_text: 'swim twice a week',
        lane: 'body',
        cards_suggested: { value: 3, basis: 'observed_rows', source_refs: [] },
        outcomes_recorded: { value: 2, basis: 'observed_rows', source_refs: ['outcome:o_0001', 'outcome:o_0003'] },
        confirmed_helped: { value: 1, basis: 'observed_rows', source_refs: ['outcome:o_0003'] },
        summary_text: 'You swam once and skipped once.',
      },
    ]),
  },
  {
    id: 'progression.progress_exceeds_evidence',
    contract: 'cedrus.progression',
    why: 'More confirmed help than recorded outcomes. Progress may not exceed its evidence.',
    expected_code: 'fabrication/progress_exceeds_evidence',
    json_schema_catches: false,
    value: withField('progression.moved', ['lines'], [
      {
        goal_ref: 'goal:g_swim',
        goal_stated_text: 'swim twice a week',
        lane: 'body',
        cards_suggested: { value: 1, basis: 'observed_rows', source_refs: ['card:cd_0001'] },
        outcomes_recorded: { value: 1, basis: 'observed_rows', source_refs: ['outcome:o_0001'] },
        confirmed_helped: { value: 2, basis: 'observed_rows', source_refs: ['outcome:o_0001', 'outcome:o_0003'] },
        summary_text: 'Two good ones.',
      },
    ]),
  },
  {
    id: 'progression.score_field',
    contract: 'cedrus.progression',
    why: 'An inferred score is a fabricated count wearing a chart.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: { ...(validValue('progression.moved') as Record<string, unknown>), score: 87 },
  },
  {
    id: 'progression.streak_field',
    contract: 'cedrus.progression',
    why: 'No streaks. Every abandoned habit app has one.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: { ...(validValue('progression.moved') as Record<string, unknown>), streak: 4 },
  },
  {
    id: 'progression.nothing_moved_contradicted',
    contract: 'cedrus.progression',
    why: 'The honest sentence has to agree with the numbers under it.',
    expected_code: 'fabrication/progress_contradicts_counts',
    json_schema_catches: false,
    value: withField('progression.moved', ['nothing_moved'], true),
  },
  {
    id: 'person.invented',
    contract: 'cedrus.person',
    why: 'A person exists because the member or an operator said so.',
    expected_code: 'fabrication/invented_person',
    json_schema_catches: true,
    value: withField('person.member_stated', ['origin'], 'model_inference'),
  },
  {
    id: 'person.with_phone',
    contract: 'cedrus.person',
    why: 'Phone numbers are not revealed before both people consent, per introduction.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: { ...(validValue('person.member_stated') as Record<string, unknown>), phone: '17865550102' },
  },
  {
    id: 'person.introduced_without_both_consents',
    contract: 'cedrus.person',
    why: 'Introductions are double opt-in, per introduction, from both sides.',
    expected_code: 'people/introduction_not_double_opt_in',
    json_schema_catches: false,
    value: (() => {
      const person = validValue('person.member_stated') as Record<string, unknown>;
      person['introduction_state'] = 'both_opted_in';
      person['introduction_consent_refs'] = ['consent:c_0009'];
      return person;
    })(),
  },
  {
    id: 'place.scraped',
    contract: 'cedrus.place',
    why: 'The founding place set is operator-curated, not a scraped directory.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('place.curated', ['origin'], 'scraped'),
  },
  {
    id: 'place_suggestion.without_window',
    contract: 'cedrus.place_suggestion',
    why: 'A place surfaces only attached to a window.',
    expected_code: 'object/missing_required',
    json_schema_catches: true,
    value: withoutField('place_suggestion.attached_to_window', 'window'),
  },

  // --- consent -------------------------------------------------------------
  {
    id: 'consent.bundled',
    contract: 'cedrus.consent_event',
    why: 'Bundled consent causes A2P campaign rejection, which takes the assistant offline.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('consent_event.sms', ['bundled'], true),
  },
  {
    id: 'consent.preselected',
    contract: 'cedrus.consent_event',
    why: 'Preselected consent is the same failure with a different name.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('consent_event.sms', ['preselected'], true),
  },
  {
    id: 'consent.no_wording',
    contract: 'cedrus.consent_event',
    why: 'A consent record without the words is not a record.',
    expected_code: 'string/too_short',
    json_schema_catches: true,
    value: withField('consent_event.sms', ['exact_wording'], ''),
  },

  // --- voice, requests, review --------------------------------------------
  {
    id: 'voice.applies_to_safety',
    contract: 'cedrus.voice_preference',
    why: 'STOP, HELP and distress replies stay in a fixed register regardless of setting.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('voice_preference.preset', ['applies_to'], ['assistant_replies', 'safety']),
  },
  {
    id: 'agent_request.out_of_scope_answered',
    contract: 'cedrus.agent_request',
    why: 'Anything outside the narrow promise gets an honest answer, not a confident one.',
    expected_code: 'agent_request/out_of_scope_answered_as_in_scope',
    json_schema_catches: false,
    value: withField('agent_request.out_of_scope', ['response_kind'], 'answered'),
  },
  {
    id: 'agent_request.out_of_scope_unlogged',
    contract: 'cedrus.agent_request',
    why: 'The out-of-scope log is the roadmap. An unlogged request is a lost one.',
    expected_code: 'agent_request/out_of_scope_not_logged',
    json_schema_catches: false,
    value: withField('agent_request.out_of_scope', ['logged_as_request'], false),
  },
  {
    id: 'agent_request.tone_shifted_stop',
    contract: 'cedrus.agent_request',
    why: 'A STOP reply may not be tone shifted.',
    expected_code: 'agent_request/tone_shifted_safety_reply',
    json_schema_catches: false,
    value: withField('agent_request.stop', ['voice_applied'], true),
  },
  {
    id: 'operator_review.kill_without_reason',
    contract: 'cedrus.operator_review',
    why: 'Every kill and every edit is logged with a reason. That log is the training signal.',
    expected_code: 'review/missing_reason',
    json_schema_catches: false,
    value: withField('operator_review.killed_with_reason', ['reason_code'], null),
  },

  // --- analytics -----------------------------------------------------------
  {
    id: 'analytics.vanity_pageview',
    contract: 'cedrus.analytics_event',
    why: 'No vanity metrics. Cedrus instruments the loop, not the pageviews.',
    expected_code: 'analytics/vanity_metric',
    json_schema_catches: true,
    value: {
      schema_version: 1,
      event: 'pageview',
      event_id: 'event:ev_0004',
      member_id: 'member:m_0001',
      occurred_at: '2026-08-04T18:00:00Z',
      props: {},
    },
  },
  {
    id: 'analytics.text_on_wrong_event',
    contract: 'cedrus.analytics_event',
    why: 'Analytics carry ids and enums. The one text-bearing event is the only one.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: {
      schema_version: 1,
      event: 'card.generated',
      event_id: 'event:ev_0005',
      member_id: 'member:m_0001',
      occurred_at: '2026-08-04T18:00:00Z',
      props: { card_ref: 'card:cd_0001', goal_ref: 'goal:g_swim', request_text: 'swim at 4' },
    },
  },

  // --- envelopes and errors ------------------------------------------------
  {
    id: 'envelope.credential_in_payload',
    contract: 'cedrus.data_envelope',
    why: 'Tokens are server-side only. connection_tokens is the one table where a mistake is a credential leak.',
    expected_code: 'envelope/credential_leak',
    json_schema_catches: false,
    value: withField('data_envelope.member_export', ['records'], [
      {
        contract: 'cedrus.connection_authorization',
        schema_version: 2,
        record_id: 'conn:cn_0001',
        payload: { provider: 'google_calendar', refresh_token: 'synthetic-not-a-real-token' },
      },
    ]),
  },
  {
    id: 'envelope.count_mismatch',
    contract: 'cedrus.data_envelope',
    why: 'An export cannot claim more rows than it carries.',
    expected_code: 'envelope/count_mismatch',
    json_schema_catches: false,
    value: withField('data_envelope.member_export', ['integrity'], {
      record_count: { value: 3, basis: 'observed_rows', source_refs: ['goal:g_swim', 'goal:g_ship', 'goal:g_gone'] },
      checksum_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
  },
  {
    id: 'api_error.success_status',
    contract: 'cedrus.api_error',
    why: 'A handler that returns 200 on failure looks healthy while being completely broken.',
    expected_code: 'number/too_small',
    json_schema_catches: true,
    value: withField('api_error.contract_violation', ['http_status'], 200),
  },
  {
    id: 'api_error.opaque_internal',
    contract: 'cedrus.api_error',
    why: 'Opaque errors cost hours. An internal error must at least be traceable.',
    expected_code: 'api_error/opaque_internal_error',
    json_schema_catches: false,
    value: withField('api_error.internal_with_debug_ref', ['debug_ref'], null),
  },

  // --- profile, goals, outcomes -------------------------------------------
  {
    id: 'member_profile.name_inferred',
    contract: 'cedrus.member_profile',
    why: 'The name is asked in its own step. Inferring it once wrote "Had" from "Had dinner with...".',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('member_profile.minimal', ['name_source'], 'inferred_from_reply'),
  },
  {
    id: 'goal_set.four_goals',
    contract: 'cedrus.goal_set',
    why: 'Three is a ceiling.',
    expected_code: 'array/too_many',
    json_schema_catches: true,
    value: (() => {
      const set = validValue('goal_set.empty') as Record<string, unknown>;
      const goal = validValue('goal.with_lane') as Record<string, unknown>;
      set['goals'] = [1, 2, 3, 4].map((n) => ({ ...clone(goal), goal_id: `goal:g_${n}` }));
      return set;
    })(),
  },
  {
    id: 'card_outcome.silence_from_a_tap',
    contract: 'cedrus.card_outcome',
    why: 'Silence is recorded as silence. It cannot arrive by tap.',
    expected_code: 'card_outcome/silence_source_mismatch',
    json_schema_catches: false,
    value: withField('card_outcome.silent', ['source'], 'tap'),
  },
  {
    id: 'member_activity.integrated',
    contract: 'cedrus.member_activity',
    why: 'Fitness and activity are typed in, not integrated. Manual entry is the design, not a gap.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('member_activity.typed', ['entry_method'], 'device_sync'),
  },
  {
    id: 'card_outcome.verified_self_report',
    contract: 'cedrus.card_outcome',
    why: 'Unverified stays unverified. Self-reported activity is never promoted.',
    expected_code: 'literal/mismatch',
    json_schema_catches: true,
    value: withField('card_outcome.did_not', ['verified'], true),
  },

  // ── vendor-time amendments, 2026-08-05 ────────────────────────────────────
  // The refusing half of each amendment. Three of these (goal.status_active,
  // agent_request.retired_job_*) are values the LAB copy ACCEPTS, so they only
  // pass here because the amendment landed. The rest prove the amended domains
  // are still closed rather than merely widened.
  {
    id: 'goal.status_active',
    contract: 'cedrus.goal',
    why: 'The deployed user_goals_status_check does not admit "active". A contract that accepts it describes no database.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('goal.with_lane', ['status'], 'active'),
  },
  {
    id: 'goal.status_invented',
    contract: 'cedrus.goal',
    why: '"Stale" is a derived property, not a status. A goal does not stop being open by being ignored.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('goal.with_lane', ['status'], 'stale'),
  },
  {
    id: 'goal.origin_invented',
    contract: 'cedrus.goal',
    why: 'The origin domain widened to three values, not to anything. Origin is the live partition key in both directions.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('goal.with_lane', ['origin'], 'imported'),
  },
  {
    id: 'goal.text_over_the_cap',
    contract: 'cedrus.goal',
    why: 'The cap moved from 200 to 280 to match the deployed service. It is still a cap, and it rejects rather than truncating.',
    expected_code: 'string/too_long',
    json_schema_catches: true,
    value: withField('goal.with_lane', ['stated_text'], 'x'.repeat(281)),
  },
  {
    id: 'card_outcome.old_field_name',
    contract: 'cedrus.card_outcome',
    why: 'not_this_reason was renamed to rejection_reason. The object is closed, so a caller still sending the old name fails loudly instead of having its answer silently dropped.',
    expected_code: 'object/unknown_key',
    json_schema_catches: true,
    value: (() => {
      const outcome = validValue('card_outcome.did_not') as Record<string, unknown>;
      delete outcome['rejection_reason'];
      outcome['not_this_reason'] = 'wrong_time';
      return outcome;
    })(),
  },
  {
    id: 'card_outcome.rejection_scope_invented',
    contract: 'cedrus.card_outcome',
    why: 'Scope is exactly this_action or today. "Tomorrow" is a deferral the product does not model, and guessing which one it meant is how "not this" and "not today" collapse back together.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('card_outcome.not_today', ['rejection_scope'], 'tomorrow'),
  },
  {
    id: 'card_outcome.rejection_reason_invented',
    contract: 'cedrus.card_outcome',
    why: 'The reason list gained unspecified, not free text. A written-in reason is a note, and there is a field for that.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('card_outcome.not_today', ['rejection_reason'], 'wrong_vibe'),
  },
  {
    id: 'connection_authorization.half_connected',
    contract: 'cedrus.connection_authorization',
    why: 'The status union gained disconnected. It did not gain a state that means "partly working", which is the state this product refuses to have.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('connection_authorization.google_freebusy', ['status'], 'half_connected'),
  },
  {
    id: 'agent_request.retired_job_local_activity',
    contract: 'cedrus.agent_request',
    why: 'Reboot §6.4 removed "find Cedrus workdays and local activity" as a named reliable job. A request filed under it is filed under a promise the product no longer makes.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('agent_request.record_what_happened', ['scope_job'], 'find_local_activity'),
  },
  {
    id: 'agent_request.retired_job_calendar_of_events',
    contract: 'cedrus.agent_request',
    why: 'The community-calendar job went with the event sequence. Event questions get an honest answer and a logged request, like anything else out of scope.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('agent_request.record_what_happened', ['scope_job'], 'answer_calendar_of_events'),
  },
  {
    id: 'agent_request.retired_job_connect_with_member',
    contract: 'cedrus.agent_request',
    why: 'Not in §6.4, and §4 is explicit that Cedrus introduces nobody to anybody in the founding release. A named job the product refuses to do is a promise it cannot keep.',
    expected_code: 'enum/not_allowed',
    json_schema_catches: true,
    value: withField('agent_request.record_what_happened', ['scope_job'], 'connect_with_member'),
  },
];

export const counterexamplesFor = (contract: string): readonly Counterexample[] =>
  COUNTEREXAMPLES.filter((e) => e.contract === contract);
