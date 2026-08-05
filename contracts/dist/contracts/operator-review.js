/**
 * Operator review.
 *
 * Canon: reboot plan §14 step 4 — "Into a queue. Emil approves, edits, or kills.
 * Every kill and every edit is logged with a reason — that log is the training
 * signal for what to automate, and it is the single most valuable dataset the
 * founding release produces."
 *
 * And reboot plan §18: "Least privilege applies to Emil too. The review queue
 * shows what a card says and why. It should not become a window onto everything
 * the system knows about a member."
 *
 * Two rules made mechanical:
 *   1. An `edited` or `killed` decision requires a reason of real length. The
 *      reason is the dataset, so a blank one is a lost row.
 *   2. The review item carries refs, not member data. There is no field on this
 *      contract for a phone number, an email, or a calendar interval, and the
 *      contact-disclosure guard runs over it as well.
 */
import { arrayOf, defineContract, enumOf, inspect, issue, literal, nullable, object, optional, string, } from "../schema/core.js";
import { id, instant, memberId } from "../common/primitives.js";
import { findContactDisclosure } from "../guards/fabrication.js";
export const OPERATOR_REVIEW_VERSION = 1;
export const REVIEW_DECISIONS = ['approved', 'edited', 'killed'];
/**
 * Why a card was edited or killed. A closed set plus a sentence: the enum is
 * what makes the log analysable, the sentence is what makes it useful.
 */
export const REVIEW_REASON_CODES = [
    'wrong_goal',
    'wrong_window',
    'wrong_place',
    'tone_off',
    'overclaimed_certainty',
    'not_useful',
    'duplicate',
    'unsafe_or_insensitive',
    'other',
];
const reviewShape = object({
    schema_version: literal(OPERATOR_REVIEW_VERSION),
    review_id: id('Review id.'),
    card_ref: id('The card being reviewed.'),
    member_ref: memberId(),
    reviewer: literal('operator'),
    decision: enumOf(REVIEW_DECISIONS),
    reason_code: nullable(enumOf(REVIEW_REASON_CODES)),
    reason_text: nullable(string({ minLength: 8, maxLength: 500, description: 'Why, in the operator\'s words.' })),
    /** What changed, when the decision was `edited`. Statement refs, not free prose. */
    edited_statement_refs: arrayOf(id('A statement the operator changed.'), { maxItems: 8 }),
    reviewed_at: instant('When it was reviewed.'),
    /** Delivery is gated on review. Stated as a const so a consumer can assert on it. */
    delivery_gated_on_review: literal(true),
    queue_note: optional(string({ maxLength: 200 })),
});
export const operatorReviewValidator = inspect(reviewShape, {
    expressedInJsonSchema: false,
    run: (review, path) => {
        const issues = [];
        /** Every kill and every edit is logged with a reason. */
        if (review.decision === 'edited' || review.decision === 'killed') {
            if (review.reason_code === null) {
                issues.push(issue(`${path}reason_code`, 'review/missing_reason', `a ${review.decision} decision must carry a reason code; that log is the training signal`));
            }
            if (review.reason_text === null) {
                issues.push(issue(`${path}reason_text`, 'review/missing_reason', `a ${review.decision} decision must carry a written reason`));
            }
        }
        if (review.decision === 'edited' && review.edited_statement_refs.length === 0) {
            issues.push(issue(`${path}edited_statement_refs`, 'review/edit_without_change', 'an edited decision must name the statements that changed'));
        }
        if (review.decision !== 'edited' && review.edited_statement_refs.length > 0) {
            issues.push(issue(`${path}edited_statement_refs`, 'review/change_without_edit', 'only an edited decision carries changed statements'));
        }
        /** Least privilege applies to the queue too. */
        issues.push(...findContactDisclosure(review, path));
        return issues;
    },
});
export const operatorReviewContract = defineContract({
    name: 'cedrus.operator_review',
    version: OPERATOR_REVIEW_VERSION,
    title: 'Operator review',
    description: 'The review decision on one card. Edits and kills require a reason, because that log is what says which cards to automate first.',
    sources: ['reboot plan §14 step 4', 'reboot plan §18', 'reboot plan §24 card.reviewed'],
}, operatorReviewValidator);
