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
// --- core ------------------------------------------------------------------
export { ContractViolation, JSON_SCHEMA_DIALECT, SCHEMA_ID_BASE, defineContract, schemaFileName, } from "./schema/core.js";
// --- guards ----------------------------------------------------------------
export { CERTAINTY_MARKERS, HEDGE_MARKERS, INFERRED_SOURCE_TYPES, KNOWN_SOURCE_TYPES, STATEMENT_KINDS, USER_REPORTED_SOURCE_TYPES, checkInferredLanguage, checkKnownLanguage, checkKnownSource, checkNoLaundering, } from "./guards/provenance.js";
export { CalendarBoundaryViolation, FORBIDDEN_CALENDAR_FIELDS, assertNoCalendarContent, findCalendarContent, } from "./guards/calendar-boundary.js";
export { FORBIDDEN_CONTACT_FIELDS, FORBIDDEN_ENGAGEMENT_FIELDS, FORBIDDEN_PROGRESS_FIELDS, PERSON_ORIGINS, checkCountIsDerived, checkPersonOrigin, findContactDisclosure, findFabricatedProgress, } from "./guards/fabrication.js";
export { ALLOWED_SCOPES, AUTHORIZATION_PURPOSES, NAMED_OUTCOMES, SCOPES_JUSTIFIED_BY_PURPOSE, VAGUE_OUTCOME_PHRASES, checkAuthorization, checkNamedOutcome, checkScopesAllowed, checkScopesJustified, } from "./guards/authorization.js";
// --- primitives ------------------------------------------------------------
export { ASSISTANT_JOBS, COUNT_BASES, GOAL_LANES, NEIGHBORHOODS, WEEKDAYS, WORK_SETUPS, countValidator, } from "./common/primitives.js";
// --- contracts -------------------------------------------------------------
export { CONFIDENCE_LEVELS, HEDGE_VOCABULARY, inferredStatementValidator, knownStatementValidator, proposedActionStatementValidator, statementContract, statementValidator, userReportedStatementValidator, } from "./contracts/statement.js";
export { MEMBER_PROFILE_VERSION, ONBOARDING_STEPS, memberProfileContract, memberProfileV1Validator, } from "./contracts/member-profile.js";
export { GOAL_ORIGINS, GOAL_STATUSES, GOAL_TEXT_MAX_CHARS, GOAL_VERSION, goalContract, goalSetContract, goalV1Validator, } from "./contracts/goals.js";
export { TONE_APPLIES_TO, TONE_PRESETS, voicePreferenceContract, } from "./contracts/voice-preference.js";
export { CONSENT_CHANNELS, consentEventContract, permissionStateContract, } from "./contracts/consent.js";
export { CONNECTION_PROVIDERS, CONNECTION_STATUSES, CONNECTION_VERSION, connectionAuthorizationContract, connectionAuthorizationV1Validator, } from "./contracts/connection.js";
export { AVAILABILITY_BASES, PROJECTION_FRESHNESS, availabilityContract, busyIntervalValidator, calendarFreeBusyProjectionContract, } from "./contracts/calendar.js";
export { PACE_CARD_CHANNELS, PACE_CARD_STATUSES, paceCardContract, } from "./contracts/pace-card.js";
export { CARD_OUTCOMES, CARD_OUTCOME_VERSION, OUTCOME_SOURCES, REJECTION_REASONS, REJECTION_SCOPES, cardOutcomeContract, cardOutcomeV1Validator, memberActivityContract, } from "./contracts/card-outcome.js";
export { INTRODUCTION_STATES, PLACE_SUITABILITY, PLAN_KINDS, personContract, placeContract, placeSuggestionContract, planContract, progressionContract, } from "./contracts/pillars.js";
export { TIMING_BASES, todayStateContract } from "./contracts/today.js";
export { REVIEW_DECISIONS, REVIEW_REASON_CODES, operatorReviewContract, } from "./contracts/operator-review.js";
export { FIXED_REGISTER_TRIGGERS, REQUEST_CHANNELS, RESPONSE_KINDS, agentRequestContract, } from "./contracts/agent-request.js";
export { ANALYTICS_EVENT_NAMES, FORBIDDEN_ANALYTICS_FIELDS, VANITY_EVENT_NAMES, analyticsEventContract, isVanityEventName, } from "./contracts/analytics.js";
export { ENVELOPE_KINDS, FORBIDDEN_ENVELOPE_FIELDS, PORTABLE_CONTRACTS, dataEnvelopeContract, } from "./contracts/envelope.js";
export { API_ERROR_CODES, FORBIDDEN_ERROR_FIELDS, apiErrorContract, apiErrorFromIssues, } from "./contracts/api-error.js";
// --- migration -------------------------------------------------------------
export { MigrationRegistry, cannotFabricate, } from "./migrate/registry.js";
export { migrationPlanSummary, registry as migrations } from "./migrate/migrations.js";
// --- the registry of every contract ---------------------------------------
export { CONTRACTS, contractByName } from "./registry.js";
