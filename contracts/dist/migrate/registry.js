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
import { issue } from "../schema/core.js";
const readVersion = (payload, versionKey) => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
        return null;
    const value = payload[versionKey];
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
};
export class MigrationRegistry {
    #steps = new Map();
    register(step) {
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
    stepsFor(contract) {
        return this.#steps.get(contract) ?? [];
    }
    /** Highest version reachable for a contract by migration. */
    latestVersion(contract, base) {
        const steps = this.stepsFor(contract);
        return steps.length === 0 ? base : Math.max(base, ...steps.map((s) => s.to));
    }
    /** Steps that would run for a payload at `from`, in order. Useful for a plan. */
    plan(contract, from, to) {
        const steps = this.stepsFor(contract);
        const plan = [];
        let current = from;
        while (current < to) {
            const next = steps.find((s) => s.from === current);
            if (next === undefined)
                break;
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
    migrateToLatest(target, payload, versionKey = 'schema_version') {
        const found = readVersion(payload, versionKey);
        if (found === null) {
            return {
                status: 'invalid',
                issues: [
                    issue(versionKey, 'migration/no_version', `payload does not carry an integer "${versionKey}"; a versionless record cannot be migrated safely`),
                ],
            };
        }
        if (found > target.version) {
            return {
                status: 'invalid',
                issues: [
                    issue(versionKey, 'migration/downgrade_refused', `payload is v${found} and this build knows v${target.version}; a newer record is not downgraded, it is left alone`),
                ],
            };
        }
        if (found === target.version) {
            const parsed = target.safeParse(payload);
            if (!parsed.ok)
                return { status: 'invalid', issues: parsed.issues };
            return { status: 'already_current', value: parsed.value, applied: [] };
        }
        const steps = this.plan(target.name, found, target.version);
        if (steps.length === 0 || steps[steps.length - 1]?.to !== target.version) {
            return {
                status: 'blocked',
                appliedBeforeBlock: [],
                issues: [
                    issue(versionKey, 'migration/no_path', `no registered path from ${target.name} v${found} to v${target.version}`),
                ],
            };
        }
        let current = payload;
        const applied = [];
        for (const step of steps) {
            const result = step.up(current);
            if (!result.ok) {
                return { status: 'blocked', appliedBeforeBlock: applied, issues: result.issues };
            }
            current = result.value;
            applied.push(`${step.contract} v${step.from}->v${step.to}: ${step.describe}`);
        }
        const parsed = target.safeParse(current);
        if (!parsed.ok)
            return { status: 'invalid', issues: parsed.issues };
        return { status: 'migrated', value: parsed.value, applied };
    }
}
/** Helper for a step that cannot proceed because the answer is not in the data. */
export const cannotFabricate = (path, missing, whoDecides) => ({
    ok: false,
    issues: [
        issue(path, 'migration/cannot_fabricate', `"${missing}" is not present in the older record and may not be invented; ${whoDecides}`),
    ],
});
