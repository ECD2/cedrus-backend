/**
 * Schema migration helpers.
 *
 * Canon: CEDRUS.md Part II Law 11 ("Schema before code"), Law 8 ("Migrations run
 * through the runner ... Anything touching existing DATA shows the plan and
 * waits for Emil"), lesson 5 ("Fixing the code does not fix the data"), and
 * reboot plan §20 (the migration sequence).
 *
 * The design rule that matters more than the mechanics:
 *
 *   **A migration may not invent a value.** If an older record does not contain
 *   the information a newer version requires, the migration stops and says what
 *   is missing. It does not default, it does not guess, and it does not pick the
 *   most likely answer. Reboot plan §24: "record silence explicitly rather than
 *   inferring it from absence."
 *
 * `blocked` is therefore a first-class migration outcome, not an error case. A
 * blocked migration returns what a human needs to decide, which is exactly what
 * Law 8 requires of anything touching existing data.
 */
import type { Contract, Issue } from '../schema/core.ts';
export type MigrationOutcome<T> = {
    readonly status: 'migrated';
    readonly value: T;
    readonly applied: readonly string[];
} | {
    readonly status: 'already_current';
    readonly value: T;
    readonly applied: readonly [];
} | {
    readonly status: 'blocked';
    readonly issues: readonly Issue[];
    readonly appliedBeforeBlock: readonly string[];
} | {
    readonly status: 'invalid';
    readonly issues: readonly Issue[];
};
export type StepResult = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly ok: false;
    readonly issues: readonly Issue[];
};
export interface MigrationStep {
    readonly contract: string;
    readonly from: number;
    readonly to: number;
    /** What this step does, in one sentence. Shown when a migration is blocked. */
    readonly describe: string;
    /** Whether the step touches existing data in a way Law 8 says needs Emil. */
    readonly touchesExistingData: boolean;
    up(input: unknown): StepResult;
}
export declare class MigrationRegistry {
    #private;
    register(step: MigrationStep): this;
    stepsFor(contract: string): readonly MigrationStep[];
    /** Highest version reachable for a contract by migration. */
    latestVersion(contract: string, base: number): number;
    /** Steps that would run for a payload at `from`, in order. Useful for a plan. */
    plan(contract: string, from: number, to: number): readonly MigrationStep[];
    /**
     * Migrate a payload to the target contract's version and validate the result.
     *
     * Never throws for data reasons: a caller migrating a batch needs to know
     * which rows blocked and why, not to lose the batch on the first bad row.
     */
    migrateToLatest<T>(target: Contract<T>, payload: unknown, versionKey?: string): MigrationOutcome<T>;
}
/** Helper for a step that cannot proceed because the answer is not in the data. */
export declare const cannotFabricate: (path: string, missing: string, whoDecides: string) => StepResult;
