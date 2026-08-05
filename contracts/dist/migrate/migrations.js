/**
 * The registered migrations.
 *
 * These follow the reboot plan §20 sequence. Each one is additive, each one
 * declares whether it touches existing data (Law 8), and none of them invents a
 * value that only a member or an operator could supply.
 */
import { MigrationRegistry, cannotFabricate } from "./registry.js";
import { GOAL_VERSION } from "../contracts/goals.js";
import { MEMBER_PROFILE_VERSION } from "../contracts/member-profile.js";
import { CARD_OUTCOME_VERSION } from "../contracts/card-outcome.js";
import { CONNECTION_VERSION } from "../contracts/connection.js";
import { issue } from "../schema/core.js";
const asRecord = (input) => typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...input } : null;
const notAnObject = (contract) => ({
    ok: false,
    issues: [issue('', 'migration/not_an_object', `${contract} migration expected an object`)],
});
/**
 * Goal v1 -> v2. Reboot plan §20 migration 2: `user_goals.lane` (nullable, no
 * default).
 *
 * The lane is set to `null`, not guessed. A goal we could not sort is unsorted.
 * Guessing "work" from the text would be the same failure as onboarding writing
 * "Had" from "Had dinner with..." (flag 8), one layer down.
 */
export const goalV1ToV2 = {
    contract: 'cedrus.goal',
    from: 1,
    to: GOAL_VERSION,
    describe: 'add lane (null, never guessed), priority (null) and cadence_text (absent)',
    touchesExistingData: false,
    up(input) {
        const record = asRecord(input);
        if (record === null)
            return notAnObject('cedrus.goal');
        return {
            ok: true,
            value: {
                ...record,
                schema_version: GOAL_VERSION,
                lane: null,
                priority: null,
            },
        };
    },
};
/**
 * Member profile v1 -> v2.
 *
 * `interests` becomes `activities` (a rename, information preserved), and the
 * new required fields are filled only where the answer is genuinely derivable:
 *   - `name_source` is `member_entered`, which is true by construction because
 *     v1 had no other way to set a name;
 *   - `recommendable` is NOT defaulted to true. CEDRUS.md I.7 item 7 gives the
 *     member control, and a migration that opts everyone in has made a consent
 *     decision on their behalf. It is derived from `open_to_introductions`,
 *     which is the closest thing the member actually said, and only when that
 *     value is present.
 */
export const memberProfileV1ToV2 = {
    contract: 'cedrus.member_profile',
    from: 1,
    to: MEMBER_PROFILE_VERSION,
    describe: 'rename interests to activities, add name_source, derive recommendable from the member\'s own answer',
    touchesExistingData: true,
    up(input) {
        const record = asRecord(input);
        if (record === null)
            return notAnObject('cedrus.member_profile');
        const openToIntroductions = record['open_to_introductions'];
        if (typeof openToIntroductions !== 'boolean') {
            return cannotFabricate('open_to_introductions', 'recommendable', 'the member controls whether they can be recommended (CEDRUS.md I.7 item 7); ask, do not default');
        }
        const interests = record['interests'];
        const next = {
            ...record,
            schema_version: MEMBER_PROFILE_VERSION,
            name_source: 'member_entered',
            recommendable: openToIntroductions,
            onboarding_completed_steps: [],
            onboarding_completed_at: null,
        };
        delete next['interests'];
        delete next['legacy_ref'];
        if (Array.isArray(interests))
            next['activities'] = interests;
        return { ok: true, value: next };
    },
};
/**
 * Card outcome v1 -> v2. Adds `source` (tap / sms / no_response / unknown).
 *
 * v1 rows do not record how the outcome arrived. The migration writes `unknown`,
 * which is an explicit enum member meaning "not recorded", rather than picking
 * the more common value. A guessed `tap` would be indistinguishable from a real
 * one forever after.
 */
export const cardOutcomeV1ToV2 = {
    contract: 'cedrus.card_outcome',
    from: 1,
    to: CARD_OUTCOME_VERSION,
    describe: 'add source as "unknown" (explicitly not recorded), and verified as false',
    touchesExistingData: false,
    up(input) {
        const record = asRecord(input);
        if (record === null)
            return notAnObject('cedrus.card_outcome');
        const outcome = record['outcome'];
        /**
         * One exception where the value IS derivable: a `silent` outcome can only
         * have come from no response. That is not a guess, it is the definition.
         */
        const source = outcome === 'silent' ? 'no_response' : 'unknown';
        return {
            ok: true,
            value: {
                ...record,
                schema_version: CARD_OUTCOME_VERSION,
                source,
                helped: record['helped'] ?? null,
                // Amended at vendor time (2026-08-05) with the rename and the new scope
                // field. Both land null for the same reason `source` lands `unknown`: a
                // v1 row was never asked, and "not asked" must not become "asked and
                // said nothing in particular" (which is what `unspecified` means).
                rejection_reason: null,
                rejection_scope: null,
                verified: false,
            },
        };
    },
};
/**
 * Connection authorization v1 -> v2.
 *
 * This one is expected to block, and blocking is the point. v2 requires a named
 * outcome and a narrow purpose, which are things the member was shown and
 * agreed to. A v1 row has neither. Manufacturing them would produce a consent
 * record for a disclosure that never happened, which is worse than no row.
 *
 * The correct operational answer is to re-ask, so the migration says so.
 */
export const connectionV1ToV2 = {
    contract: 'cedrus.connection_authorization',
    from: 1,
    to: CONNECTION_VERSION,
    describe: 'requires a named outcome and a narrow purpose; blocks unless the member re-authorized under the new disclosure',
    touchesExistingData: true,
    up(input) {
        const record = asRecord(input);
        if (record === null)
            return notAnObject('cedrus.connection_authorization');
        const purpose = record['purpose'];
        const namedOutcome = record['named_outcome'];
        const disclosure = record['disclosure'];
        if (purpose === undefined || namedOutcome === undefined || disclosure === undefined) {
            return cannotFabricate('named_outcome', 'named_outcome, purpose and disclosure', 'these record what the member was shown and agreed to; re-authorize under the new pre-consent screen instead');
        }
        const scope = record['scope'];
        const next = {
            ...record,
            schema_version: CONNECTION_VERSION,
            scopes: typeof scope === 'string' ? [scope] : [],
            token_storage: 'server_only',
            revocable: true,
            writes_to_provider: false,
            state_validated: true,
        };
        delete next['scope'];
        return { ok: true, value: next };
    },
};
export const registry = new MigrationRegistry()
    .register(goalV1ToV2)
    .register(memberProfileV1ToV2)
    .register(cardOutcomeV1ToV2)
    .register(connectionV1ToV2);
/** The plan a session would show before running anything (Law 8). */
export const migrationPlanSummary = () => [goalV1ToV2, memberProfileV1ToV2, cardOutcomeV1ToV2, connectionV1ToV2].map((step) => ({
    contract: step.contract,
    from: step.from,
    to: step.to,
    describe: step.describe,
    touchesExistingData: step.touchesExistingData,
}));
