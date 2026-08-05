/**
 * Card outcomes, and manual member activity.
 *
 * Canon: reboot plan §6 ("the loop's weakest link is RECORD"), §13 (manual
 * user-reported activity and outcomes), §19 (`card_outcomes`, `member_activity`),
 * §24 (`card.outcome`, `card.helped`).
 *
 * Design rules from §13, as contract rules:
 *   - "'I didn't' is exactly as easy as 'I did.'" → `did_not` is a first-class
 *     member of the outcome set, not an absence.
 *   - "Never ask twice. One prompt per card. Silence is a valid answer and gets
 *     recorded as silence, not retried." → `silent` is an explicit outcome with
 *     a source of `no_response`, so a member who says nothing is a data point
 *     rather than a gap (§24).
 *   - "Unverified stays unverified." → an outcome is always a user-reported
 *     fact. `verified` is a const `false`.
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const CARD_OUTCOME_VERSION = 2;
/** Reboot plan §13 and §19. Five values, and silence is one of them. */
export declare const CARD_OUTCOMES: readonly ["did", "did_something_else", "did_not", "deferred", "silent"];
export type CardOutcomeValue = (typeof CARD_OUTCOMES)[number];
/**
 * Capture paths. `unknown` exists only as a migration landing spot for v1 rows
 * that predate the column: recording "we do not know" is honest, guessing `tap`
 * is not.
 */
export declare const OUTCOME_SOURCES: readonly ["tap", "sms", "no_response", "unknown"];
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 8, and CEDRUS.md Part I §22,
 * "the pace card outcome vocabulary is fixed", approved by Emil 2026-08-05.
 *
 * Renamed from `NOT_THIS_REASONS`, and `unspecified` added. The rename is not
 * cosmetic: the old name tied the field to one rejection scope ("not this"),
 * and the amendment separates scope from reason so that "not this" and "not
 * today" stop being the same record. `unspecified` exists so that a member who
 * rejects without saying why produces a row rather than a null that could also
 * mean "we never asked".
 *
 * Lab original: `NOT_THIS_REASONS = ['wrong_thing', 'wrong_time', 'wrong_place']`.
 */
export declare const REJECTION_REASONS: readonly ["wrong_thing", "wrong_time", "wrong_place", "unspecified"];
/**
 * NEW AT VENDOR TIME (2026-08-05). Catalog item 8.
 *
 * "Not this" suppresses the strategy. "Not today" defers the card. Collapsing
 * them loses the single most useful thing a rejection can say, so the scope is
 * its own field and the engine reads it directly rather than inferring it.
 */
export declare const REJECTION_SCOPES: readonly ["this_action", "today"];
export declare const cardOutcomeValidator: import("../schema/core.ts").Validator<{
    schema_version: 2;
    outcome_id: string;
    card_id: string;
    member_id: string;
    outcome: "did" | "did_something_else" | "did_not" | "deferred" | "silent";
    helped: boolean | null;
    rejection_reason: "wrong_thing" | "wrong_time" | "wrong_place" | "unspecified" | null;
    rejection_scope: "this_action" | "today" | null;
    source: "sms" | "tap" | "no_response" | "unknown";
    verified: false;
    recorded_at: string;
    note?: string;
}>;
export type CardOutcome = Infer<typeof cardOutcomeValidator>;
export declare const cardOutcomeContract: Contract<CardOutcome>;
/** v1: before `source` existed. The migration must not guess it. */
export declare const cardOutcomeV1Validator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    outcome_id: string;
    card_id: string;
    member_id: string;
    outcome: "did" | "did_something_else" | "did_not" | "deferred" | "silent";
    helped: boolean | null;
    recorded_at: string;
    note?: string;
}>;
export type CardOutcomeV1 = Infer<typeof cardOutcomeV1Validator>;
/**
 * Activity reported without a card behind it. Reboot plan §19 `member_activity`,
 * and §13: fitness and activity are typed in, not integrated.
 */
export declare const MEMBER_ACTIVITY_VERSION = 1;
export declare const memberActivityValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    activity_id: string;
    member_id: string;
    goal_ref: string | null;
    text: string;
    happened_at: string;
    source: "operator_entered" | "sms" | "tap";
    entry_method: "typed";
    verified: false;
    recorded_at: string;
}>;
export type MemberActivity = Infer<typeof memberActivityValidator>;
export declare const memberActivityContract: Contract<MemberActivity>;
