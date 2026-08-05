/**
 * Cedrus Contracts v0.
 *
 * The shared product contracts for Cedrus surfaces and services. Read
 * README_FIRST.md before using any of this, and docs/INTEGRATION_GUIDE.md
 * before wiring it into a repo.
 *
 * Nothing in this package talks to a network, a database, or a provider. It is
 * shapes, validators, guards, and the JSON Schemas that mirror them.
 */
export { ContractViolation, JSON_SCHEMA_DIALECT, SCHEMA_ID_BASE, defineContract, schemaFileName, type CheckResult, type Contract, type ContractMeta, type Infer, type Issue, type JsonSchema, type JsonValue, type Validator, } from './schema/core.ts';
export { CERTAINTY_MARKERS, HEDGE_MARKERS, INFERRED_SOURCE_TYPES, KNOWN_SOURCE_TYPES, STATEMENT_KINDS, USER_REPORTED_SOURCE_TYPES, checkInferredLanguage, checkKnownLanguage, checkKnownSource, checkNoLaundering, type StatementKind, } from './guards/provenance.ts';
export { CalendarBoundaryViolation, FORBIDDEN_CALENDAR_FIELDS, assertNoCalendarContent, findCalendarContent, } from './guards/calendar-boundary.ts';
export { FORBIDDEN_CONTACT_FIELDS, FORBIDDEN_ENGAGEMENT_FIELDS, FORBIDDEN_PROGRESS_FIELDS, PERSON_ORIGINS, checkCountIsDerived, checkPersonOrigin, findContactDisclosure, findFabricatedProgress, type CountLike, } from './guards/fabrication.ts';
export { ALLOWED_SCOPES, AUTHORIZATION_PURPOSES, NAMED_OUTCOMES, SCOPES_JUSTIFIED_BY_PURPOSE, VAGUE_OUTCOME_PHRASES, checkAuthorization, checkNamedOutcome, checkScopesAllowed, checkScopesJustified, type AllowedScope, type AuthorizationPurpose, type NamedOutcome, } from './guards/authorization.ts';
export { ASSISTANT_JOBS, COUNT_BASES, GOAL_LANES, NEIGHBORHOODS, WEEKDAYS, WORK_SETUPS, countValidator, type Count, type TimeWindow, } from './common/primitives.ts';
export { CONFIDENCE_LEVELS, HEDGE_VOCABULARY, inferredStatementValidator, knownStatementValidator, proposedActionStatementValidator, statementContract, statementValidator, userReportedStatementValidator, type InferredStatement, type KnownStatement, type ProposedActionStatement, type Statement, type UserReportedStatement, } from './contracts/statement.ts';
export { MEMBER_PROFILE_VERSION, ONBOARDING_STEPS, memberProfileContract, memberProfileV1Validator, type MemberProfile, type MemberProfileV1, type StatedWindow, } from './contracts/member-profile.ts';
export { GOAL_ORIGINS, GOAL_STATUSES, GOAL_TEXT_MAX_CHARS, GOAL_VERSION, goalContract, goalSetContract, goalV1Validator, type Goal, type GoalSet, type GoalV1, } from './contracts/goals.ts';
export { TONE_APPLIES_TO, TONE_PRESETS, voicePreferenceContract, type FreeFormVoicePreference, type PresetVoicePreference, type TonePreset, type VoicePreference, } from './contracts/voice-preference.ts';
export { CONSENT_CHANNELS, consentEventContract, permissionStateContract, type ConsentChannel, type ConsentEvent, type PermissionState, } from './contracts/consent.ts';
export { CONNECTION_PROVIDERS, CONNECTION_STATUSES, CONNECTION_VERSION, connectionAuthorizationContract, connectionAuthorizationV1Validator, type ConnectionAuthorization, type ConnectionAuthorizationV1, } from './contracts/connection.ts';
export { AVAILABILITY_BASES, PROJECTION_FRESHNESS, availabilityContract, busyIntervalValidator, calendarFreeBusyProjectionContract, type Availability, type BusyInterval, type CalendarFreeBusyProjection, } from './contracts/calendar.ts';
export { PACE_CARD_CHANNELS, PACE_CARD_STATUSES, paceCardContract, type PaceCard, type PaceCardStatus, } from './contracts/pace-card.ts';
export { CARD_OUTCOMES, CARD_OUTCOME_VERSION, OUTCOME_SOURCES, REJECTION_REASONS, REJECTION_SCOPES, cardOutcomeContract, cardOutcomeV1Validator, memberActivityContract, type CardOutcome, type CardOutcomeV1, type CardOutcomeValue, type MemberActivity, } from './contracts/card-outcome.ts';
export { INTRODUCTION_STATES, PLACE_SUITABILITY, PLAN_KINDS, personContract, placeContract, placeSuggestionContract, planContract, progressionContract, type Person, type Place, type PlaceSuggestion, type Plan, type Progression, } from './contracts/pillars.ts';
export { TIMING_BASES, todayStateContract, type TodayState } from './contracts/today.ts';
export { REVIEW_DECISIONS, REVIEW_REASON_CODES, operatorReviewContract, type OperatorReview, type ReviewDecision, } from './contracts/operator-review.ts';
export { FIXED_REGISTER_TRIGGERS, REQUEST_CHANNELS, RESPONSE_KINDS, agentRequestContract, type AgentRequest, } from './contracts/agent-request.ts';
export { ANALYTICS_EVENT_NAMES, FORBIDDEN_ANALYTICS_FIELDS, VANITY_EVENT_NAMES, analyticsEventContract, isVanityEventName, type AnalyticsEvent, type AnalyticsEventName, } from './contracts/analytics.ts';
export { ENVELOPE_KINDS, FORBIDDEN_ENVELOPE_FIELDS, PORTABLE_CONTRACTS, dataEnvelopeContract, type DataEnvelope, } from './contracts/envelope.ts';
export { API_ERROR_CODES, FORBIDDEN_ERROR_FIELDS, apiErrorContract, apiErrorFromIssues, type ApiError, type ApiErrorCode, } from './contracts/api-error.ts';
export { MigrationRegistry, cannotFabricate, type MigrationOutcome, type MigrationStep, type StepResult, } from './migrate/registry.ts';
export { migrationPlanSummary, registry as migrations } from './migrate/migrations.ts';
export { CONTRACTS, contractByName, type ContractName } from './registry.ts';
