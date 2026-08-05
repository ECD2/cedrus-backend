/**
 * The registered migrations.
 *
 * These follow the reboot plan §20 sequence. Each one is additive, each one
 * declares whether it touches existing data (Law 8), and none of them invents a
 * value that only a member or an operator could supply.
 */
import { MigrationRegistry, type MigrationStep } from './registry.ts';
/**
 * Goal v1 -> v2. Reboot plan §20 migration 2: `user_goals.lane` (nullable, no
 * default).
 *
 * The lane is set to `null`, not guessed. A goal we could not sort is unsorted.
 * Guessing "work" from the text would be the same failure as onboarding writing
 * "Had" from "Had dinner with..." (flag 8), one layer down.
 */
export declare const goalV1ToV2: MigrationStep;
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
export declare const memberProfileV1ToV2: MigrationStep;
/**
 * Card outcome v1 -> v2. Adds `source` (tap / sms / no_response / unknown).
 *
 * v1 rows do not record how the outcome arrived. The migration writes `unknown`,
 * which is an explicit enum member meaning "not recorded", rather than picking
 * the more common value. A guessed `tap` would be indistinguishable from a real
 * one forever after.
 */
export declare const cardOutcomeV1ToV2: MigrationStep;
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
export declare const connectionV1ToV2: MigrationStep;
export declare const registry: MigrationRegistry;
/** The plan a session would show before running anything (Law 8). */
export declare const migrationPlanSummary: () => readonly {
    readonly contract: string;
    readonly from: number;
    readonly to: number;
    readonly describe: string;
    readonly touchesExistingData: boolean;
}[];
