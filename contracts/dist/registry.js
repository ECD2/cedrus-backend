/**
 * Every contract in the package, in one list.
 *
 * This is what the JSON Schema generator walks, what the agreement test walks,
 * and what a consumer enumerates to discover what exists. A contract that is not
 * in this list has no published JSON Schema and no agreement test, which is why
 * `test/registry.test.ts` asserts that every exported contract is here.
 */
import { statementContract } from "./contracts/statement.js";
import { memberProfileContract } from "./contracts/member-profile.js";
import { goalContract, goalSetContract } from "./contracts/goals.js";
import { voicePreferenceContract } from "./contracts/voice-preference.js";
import { consentEventContract, permissionStateContract } from "./contracts/consent.js";
import { connectionAuthorizationContract } from "./contracts/connection.js";
import { availabilityContract, calendarFreeBusyProjectionContract } from "./contracts/calendar.js";
import { paceCardContract } from "./contracts/pace-card.js";
import { cardOutcomeContract, memberActivityContract } from "./contracts/card-outcome.js";
import { personContract, placeContract, placeSuggestionContract, planContract, progressionContract, } from "./contracts/pillars.js";
import { todayStateContract } from "./contracts/today.js";
import { operatorReviewContract } from "./contracts/operator-review.js";
import { agentRequestContract } from "./contracts/agent-request.js";
import { analyticsEventContract } from "./contracts/analytics.js";
import { dataEnvelopeContract } from "./contracts/envelope.js";
import { apiErrorContract } from "./contracts/api-error.js";
/**
 * Typed as `Contract<never>` deliberately: the registry is for enumeration and
 * validation, not for producing typed values. A caller who wants a typed parse
 * imports the specific contract.
 */
export const CONTRACTS = [
    statementContract,
    memberProfileContract,
    goalContract,
    goalSetContract,
    voicePreferenceContract,
    consentEventContract,
    permissionStateContract,
    connectionAuthorizationContract,
    calendarFreeBusyProjectionContract,
    availabilityContract,
    paceCardContract,
    cardOutcomeContract,
    memberActivityContract,
    placeContract,
    placeSuggestionContract,
    personContract,
    planContract,
    progressionContract,
    todayStateContract,
    operatorReviewContract,
    agentRequestContract,
    analyticsEventContract,
    dataEnvelopeContract,
    apiErrorContract,
];
const byName = new Map(CONTRACTS.map((c) => [c.name, c]));
export const contractByName = (name) => byName.get(name);
