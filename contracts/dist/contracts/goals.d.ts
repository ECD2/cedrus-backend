/**
 * Goals, and the optional goal lanes.
 *
 * Canon: reboot plan §10 (`/goals`) — up to three goals, in the member's own
 * words, three optional lanes (work / people / body), free text with ghost-text
 * examples rather than a picker, "one is enough" stated explicitly, and an
 * optional cadence stored as text rather than parsed into a schedule.
 *
 * Two rules the contract enforces that a form cannot:
 *   - the member's words are stored verbatim and separately from any normalised
 *     form, because the pace card has to quote them back;
 *   - the lane is nullable with no default. A goal we could not sort is
 *     unsorted, not guessed into "work".
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const GOAL_VERSION = 2;
export declare const GOAL_SET_VERSION = 2;
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2: "goal_text: verbatim
 * member words, 280-char cap, reject-not-truncate."
 *
 * The lab capped at 200. The deployed service caps at 280
 * (`services/goals.js` MAX_GOAL_TEXT_CHARS) and rejects rather than truncates,
 * which is the same discipline at a different number. Leaving the contract at
 * 200 would make every legitimate 201-to-280 character goal a logged violation,
 * which is how a validation log becomes noise and then gets ignored.
 *
 * The floor of 3 is NOT relaxed to match the service, which accepts any
 * non-empty string. That difference is deliberate and is the first thing this
 * wiring actually catches.
 *
 * Lab original: 200.
 */
export declare const GOAL_TEXT_MAX_CHARS = 280;
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2.
 *
 * `cedrus_inferred` is added because it is the live partition key. `user_goals`
 * holds two populations kept apart by `origin`: what a member deliberately wrote
 * (`user_set`) and what the pipeline captured from chat (`cedrus_inferred`). A
 * contract that cannot represent the second one cannot describe the table.
 * `operator_entered` is the Slice 2 addition for operator-created context.
 *
 * Only `user_set` and `operator_entered` goals may headline a pace card;
 * `cedrus_inferred` never does. That is an engine rule, not a shape rule, so it
 * is not enforced here.
 *
 * Lab original: `['user_set', 'operator_entered']`.
 */
export declare const GOAL_ORIGINS: readonly ["user_set", "cedrus_inferred", "operator_entered"];
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2.
 *
 * The deployed `user_goals_status_check` wins. It admits exactly these four
 * values (CEDRUS.md II.5, Data model), and changing a live CHECK constraint is a
 * data migration nobody needs yet. The lab's `active | paused | retired` was a
 * clean design that no database agrees with.
 *
 * "Stale" is deliberately not a status: it is a derived property
 * (`days_since_movement`), because a goal does not stop being open by being
 * ignored.
 *
 * Lab original: `['active', 'paused', 'retired']`.
 */
export declare const GOAL_STATUSES: readonly ["open", "completed", "missed", "canceled"];
export declare const goalValidator: import("../schema/core.ts").Validator<{
    schema_version: 2;
    goal_id: string;
    member_id: string;
    stated_text: string;
    lane: "work" | "people" | "body" | null;
    origin: "operator_entered" | "user_set" | "cedrus_inferred";
    status: "open" | "completed" | "missed" | "canceled";
    priority: number | null;
    created_at: string;
    updated_at: string;
    cadence_text?: string;
}>;
export type Goal = Infer<typeof goalValidator>;
export declare const goalContract: Contract<Goal>;
/**
 * The goal set. Three is a ceiling, one is enough, zero is a valid state for a
 * member who has not answered yet.
 */
export declare const goalSetValidator: import("../schema/core.ts").Validator<{
    schema_version: 2;
    member_id: string;
    goals: readonly {
        schema_version: 2;
        goal_id: string;
        member_id: string;
        stated_text: string;
        lane: "work" | "people" | "body" | null;
        origin: "operator_entered" | "user_set" | "cedrus_inferred";
        status: "open" | "completed" | "missed" | "canceled";
        priority: number | null;
        created_at: string;
        updated_at: string;
        cadence_text?: string;
    }[];
    one_is_enough_shown: boolean;
    updated_at: string;
}>;
export type GoalSet = Infer<typeof goalSetValidator>;
export declare const goalSetContract: Contract<GoalSet>;
/** v1: before lanes existed (migration sequence #2, `user_goals.lane`). */
export declare const goalV1Validator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    goal_id: string;
    member_id: string;
    stated_text: string;
    origin: "operator_entered" | "user_set" | "cedrus_inferred";
    status: "open" | "completed" | "missed" | "canceled";
    created_at: string;
    updated_at: string;
}>;
export type GoalV1 = Infer<typeof goalV1Validator>;
