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
import { issue } from '../schema/core.ts';

export type MigrationOutcome<T> =
  | { readonly status: 'migrated'; readonly value: T; readonly applied: readonly string[] }
  | { readonly status: 'already_current'; readonly value: T; readonly applied: readonly [] }
  | { readonly status: 'blocked'; readonly issues: readonly Issue[]; readonly appliedBeforeBlock: readonly string[] }
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] };

export type StepResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly Issue[] };

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

const readVersion = (payload: unknown, versionKey: string): number | null => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[versionKey];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

export class MigrationRegistry {
  readonly #steps = new Map<string, MigrationStep[]>();

  register(step: MigrationStep): this {
    if (step.to !== step.from + 1) {
      throw new Error(`migration ${step.contract} ${step.from}->${step.to} must be a single version step`);
    }
    const existing = this.#steps.get(step.contract) ?? [];
    if (existing.some((s) => s.from === step.from)) {
      throw new Error(`duplicate migration for ${step.contract} from v${step.from}`);
    }
    existing.push(step);
    existing.sort((a, b) => a.from - b.from);
    this.#steps.set(step.contract, existing);
    return this;
  }

  stepsFor(contract: string): readonly MigrationStep[] {
    return this.#steps.get(contract) ?? [];
  }

  /** Highest version reachable for a contract by migration. */
  latestVersion(contract: string, base: number): number {
    const steps = this.stepsFor(contract);
    return steps.length === 0 ? base : Math.max(base, ...steps.map((s) => s.to));
  }

  /** Steps that would run for a payload at `from`, in order. Useful for a plan. */
  plan(contract: string, from: number, to: number): readonly MigrationStep[] {
    const steps = this.stepsFor(contract);
    const plan: MigrationStep[] = [];
    let current = from;
    while (current < to) {
      const next = steps.find((s) => s.from === current);
      if (next === undefined) break;
      plan.push(next);
      current = next.to;
    }
    return plan;
  }

  /**
   * Migrate a payload to the target contract's version and validate the result.
   *
   * Never throws for data reasons: a caller migrating a batch needs to know
   * which rows blocked and why, not to lose the batch on the first bad row.
   */
  migrateToLatest<T>(target: Contract<T>, payload: unknown, versionKey = 'schema_version'): MigrationOutcome<T> {
    const found = readVersion(payload, versionKey);
    if (found === null) {
      return {
        status: 'invalid',
        issues: [
          issue(
            versionKey,
            'migration/no_version',
            `payload does not carry an integer "${versionKey}"; a versionless record cannot be migrated safely`,
          ),
        ],
      };
    }

    if (found > target.version) {
      return {
        status: 'invalid',
        issues: [
          issue(
            versionKey,
            'migration/downgrade_refused',
            `payload is v${found} and this build knows v${target.version}; a newer record is not downgraded, it is left alone`,
          ),
        ],
      };
    }

    if (found === target.version) {
      const parsed = target.safeParse(payload);
      if (!parsed.ok) return { status: 'invalid', issues: parsed.issues };
      return { status: 'already_current', value: parsed.value, applied: [] };
    }

    const steps = this.plan(target.name, found, target.version);
    if (steps.length === 0 || steps[steps.length - 1]?.to !== target.version) {
      return {
        status: 'blocked',
        appliedBeforeBlock: [],
        issues: [
          issue(
            versionKey,
            'migration/no_path',
            `no registered path from ${target.name} v${found} to v${target.version}`,
          ),
        ],
      };
    }

    let current: unknown = payload;
    const applied: string[] = [];
    for (const step of steps) {
      const result = step.up(current);
      if (!result.ok) {
        return { status: 'blocked', appliedBeforeBlock: applied, issues: result.issues };
      }
      current = result.value;
      applied.push(`${step.contract} v${step.from}->v${step.to}: ${step.describe}`);
    }

    const parsed = target.safeParse(current);
    if (!parsed.ok) return { status: 'invalid', issues: parsed.issues };
    return { status: 'migrated', value: parsed.value, applied };
  }
}

/** Helper for a step that cannot proceed because the answer is not in the data. */
export const cannotFabricate = (path: string, missing: string, whoDecides: string): StepResult => ({
  ok: false,
  issues: [
    issue(
      path,
      'migration/cannot_fabricate',
      `"${missing}" is not present in the older record and may not be invented; ${whoDecides}`,
    ),
  ],
});
