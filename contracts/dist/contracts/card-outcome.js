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
import { boolean, defineContract, enumOf, literal, nullable, object, optional, refine, string, } from "../schema/core.js";
import { id, instant, memberId } from "../common/primitives.js";
export const CARD_OUTCOME_VERSION = 2;
/** Reboot plan §13 and §19. Five values, and silence is one of them. */
export const CARD_OUTCOMES = ['did', 'did_something_else', 'did_not', 'deferred', 'silent'];
/**
 * Capture paths. `unknown` exists only as a migration landing spot for v1 rows
 * that predate the column: recording "we do not know" is honest, guessing `tap`
 * is not.
 */
export const OUTCOME_SOURCES = ['tap', 'sms', 'no_response', 'unknown'];
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
export const REJECTION_REASONS = ['wrong_thing', 'wrong_time', 'wrong_place', 'unspecified'];
/**
 * NEW AT VENDOR TIME (2026-08-05). Catalog item 8.
 *
 * "Not this" suppresses the strategy. "Not today" defers the card. Collapsing
 * them loses the single most useful thing a rejection can say, so the scope is
 * its own field and the engine reads it directly rather than inferring it.
 */
export const REJECTION_SCOPES = ['this_action', 'today'];
export const cardOutcomeValidator = refine(object({
    schema_version: literal(CARD_OUTCOME_VERSION),
    outcome_id: id('Outcome id.'),
    card_id: id('The card this answers.'),
    member_id: memberId(),
    outcome: enumOf(CARD_OUTCOMES),
    /** Did it help? The gate's central definition of a better day (§24, §11). */
    helped: nullable(boolean()),
    rejection_reason: nullable(enumOf(REJECTION_REASONS)),
    rejection_scope: nullable(enumOf(REJECTION_SCOPES)),
    note: optional(string({ maxLength: 500, description: 'One line of member free text.' })),
    source: enumOf(OUTCOME_SOURCES),
    /** Self-reported. Never promoted (reboot plan §13). */
    verified: literal(false),
    recorded_at: instant('When it was recorded.'),
}), {
    code: 'card_outcome/silence_source_mismatch',
    message: 'a silent outcome is recorded with source no_response, and no other outcome may use it',
    expressedInJsonSchema: false,
    predicate: (o) => (o.outcome === 'silent') === (o.source === 'no_response'),
});
export const cardOutcomeContract = defineContract({
    name: 'cedrus.card_outcome',
    version: CARD_OUTCOME_VERSION,
    title: 'Card outcome',
    description: 'What happened after a card. Silence is an explicit outcome, "I didn\'t" is as easy as "I did", and nothing here is verified.',
    sources: ['reboot plan §6', 'reboot plan §13', 'reboot plan §19', 'reboot plan §24'],
}, cardOutcomeValidator);
/** v1: before `source` existed. The migration must not guess it. */
export const cardOutcomeV1Validator = object({
    schema_version: literal(1),
    outcome_id: id('Outcome id.'),
    card_id: id('The card this answers.'),
    member_id: memberId(),
    outcome: enumOf(CARD_OUTCOMES),
    helped: nullable(boolean()),
    note: optional(string({ maxLength: 500 })),
    recorded_at: instant('When it was recorded.'),
});
/**
 * Activity reported without a card behind it. Reboot plan §19 `member_activity`,
 * and §13: fitness and activity are typed in, not integrated.
 */
export const MEMBER_ACTIVITY_VERSION = 1;
export const memberActivityValidator = object({
    schema_version: literal(MEMBER_ACTIVITY_VERSION),
    activity_id: id('Activity id.'),
    member_id: memberId(),
    goal_ref: nullable(id('The goal it relates to, if the member said.')),
    text: string({ minLength: 1, maxLength: 500, description: "What happened, in the member's words." }),
    happened_at: instant('When it happened, as reported.'),
    source: enumOf(['tap', 'sms', 'operator_entered']),
    /** Typed in, not integrated. There is no field here for a device or a provider. */
    entry_method: literal('typed'),
    verified: literal(false),
    recorded_at: instant('When it was recorded.'),
});
export const memberActivityContract = defineContract({
    name: 'cedrus.member_activity',
    version: MEMBER_ACTIVITY_VERSION,
    title: 'Member activity',
    description: 'A manual activity report not tied to a card. Typed in, never integrated, never verified.',
    sources: ['reboot plan §13', 'reboot plan §19'],
}, memberActivityValidator);
