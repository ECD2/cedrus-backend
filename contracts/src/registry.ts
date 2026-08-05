/**
 * Every contract in the package, in one list.
 *
 * This is what the JSON Schema generator walks, what the agreement test walks,
 * and what a consumer enumerates to discover what exists. A contract that is not
 * in this list has no published JSON Schema and no agreement test, which is why
 * `test/registry.test.ts` asserts that every exported contract is here.
 */

import type { Contract } from './schema/core.ts';
import { statementContract } from './contracts/statement.ts';
import { memberProfileContract } from './contracts/member-profile.ts';
import { goalContract, goalSetContract } from './contracts/goals.ts';
import { voicePreferenceContract } from './contracts/voice-preference.ts';
import { consentEventContract, permissionStateContract } from './contracts/consent.ts';
import { connectionAuthorizationContract } from './contracts/connection.ts';
import { availabilityContract, calendarFreeBusyProjectionContract } from './contracts/calendar.ts';
import { paceCardContract } from './contracts/pace-card.ts';
import { cardOutcomeContract, memberActivityContract } from './contracts/card-outcome.ts';
import {
  personContract,
  placeContract,
  placeSuggestionContract,
  planContract,
  progressionContract,
} from './contracts/pillars.ts';
import { todayStateContract } from './contracts/today.ts';
import { operatorReviewContract } from './contracts/operator-review.ts';
import { agentRequestContract } from './contracts/agent-request.ts';
import { analyticsEventContract } from './contracts/analytics.ts';
import { dataEnvelopeContract } from './contracts/envelope.ts';
import { apiErrorContract } from './contracts/api-error.ts';

/**
 * Typed as `Contract<never>` deliberately: the registry is for enumeration and
 * validation, not for producing typed values. A caller who wants a typed parse
 * imports the specific contract.
 */
export const CONTRACTS: readonly Contract<never>[] = [
  statementContract as unknown as Contract<never>,
  memberProfileContract as unknown as Contract<never>,
  goalContract as unknown as Contract<never>,
  goalSetContract as unknown as Contract<never>,
  voicePreferenceContract as unknown as Contract<never>,
  consentEventContract as unknown as Contract<never>,
  permissionStateContract as unknown as Contract<never>,
  connectionAuthorizationContract as unknown as Contract<never>,
  calendarFreeBusyProjectionContract as unknown as Contract<never>,
  availabilityContract as unknown as Contract<never>,
  paceCardContract as unknown as Contract<never>,
  cardOutcomeContract as unknown as Contract<never>,
  memberActivityContract as unknown as Contract<never>,
  placeContract as unknown as Contract<never>,
  placeSuggestionContract as unknown as Contract<never>,
  personContract as unknown as Contract<never>,
  planContract as unknown as Contract<never>,
  progressionContract as unknown as Contract<never>,
  todayStateContract as unknown as Contract<never>,
  operatorReviewContract as unknown as Contract<never>,
  agentRequestContract as unknown as Contract<never>,
  analyticsEventContract as unknown as Contract<never>,
  dataEnvelopeContract as unknown as Contract<never>,
  apiErrorContract as unknown as Contract<never>,
];

export type ContractName = (typeof CONTRACTS)[number]['name'];

const byName = new Map<string, Contract<never>>(CONTRACTS.map((c) => [c.name, c]));

export const contractByName = (name: string): Contract<never> | undefined => byName.get(name);
