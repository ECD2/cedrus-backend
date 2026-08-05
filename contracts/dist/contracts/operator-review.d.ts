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
import { type Contract, type Infer } from '../schema/core.ts';
export declare const OPERATOR_REVIEW_VERSION = 1;
export declare const REVIEW_DECISIONS: readonly ["approved", "edited", "killed"];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
/**
 * Why a card was edited or killed. A closed set plus a sentence: the enum is
 * what makes the log analysable, the sentence is what makes it useful.
 */
export declare const REVIEW_REASON_CODES: readonly ["wrong_goal", "wrong_window", "wrong_place", "tone_off", "overclaimed_certainty", "not_useful", "duplicate", "unsafe_or_insensitive", "other"];
export declare const operatorReviewValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    review_id: string;
    card_ref: string;
    member_ref: string;
    reviewer: "operator";
    decision: "approved" | "edited" | "killed";
    reason_code: "wrong_place" | "wrong_goal" | "wrong_window" | "tone_off" | "overclaimed_certainty" | "not_useful" | "duplicate" | "unsafe_or_insensitive" | "other" | null;
    reason_text: string | null;
    edited_statement_refs: readonly string[];
    reviewed_at: string;
    delivery_gated_on_review: true;
    queue_note?: string;
}>;
export type OperatorReview = Infer<typeof operatorReviewValidator>;
export declare const operatorReviewContract: Contract<OperatorReview>;
