/**
 * Pace card.
 *
 * Canon: reboot plan §3 ("the unit of output ... a pace card: goal + what
 * happened + available time + one realistic action, with certainty labelled"),
 * §10 (`/card/$id`, the four blocks and their order), §14 (generation pipeline
 * and its hard constraints), §27 risk 12.
 *
 * The hard constraints from §14, as contract rules:
 *   - "No card without a goal to hang it on."   → `goal_ref` is required.
 *   - "A card that cannot label its own certainty does not ship." → every part
 *     is a tagged statement; there is no untagged text field on the card.
 *   - "One card per member per day, maximum."   → Today holds one card or none,
 *     and the card carries the day it belongs to so a second one collides.
 *   - "Every card is reviewed by Emil before delivery." → `delivered` requires
 *     a review decision of `approved` or `edited`.
 *
 * Plus the four-block requirement: exactly one proposed action, and at least one
 * grounded statement behind it. A card that is all inference is a guess with a
 * layout.
 */
import { type Contract, type Infer } from '../schema/core.ts';
import { type Statement } from './statement.ts';
export declare const PACE_CARD_VERSION = 1;
/** Reboot plan §19 `pace_cards.status`. `delivered` is the only terminal state. */
export declare const PACE_CARD_STATUSES: readonly ["draft", "approved", "edited", "killed", "delivered"];
export type PaceCardStatus = (typeof PACE_CARD_STATUSES)[number];
export declare const PACE_CARD_CHANNELS: readonly ["web", "sms"];
export declare const paceCardValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    card_id: string;
    member_id: string;
    goal_ref: string;
    for_date: string;
    parts: readonly Statement[];
    window: {
        starts_at: string;
        ends_at: string;
    };
    status: "draft" | "approved" | "edited" | "killed" | "delivered";
    review_ref: string | null;
    created_at: string;
    delivered_at: string | null;
    delivered_via: "web" | "sms" | null;
    voice_ref?: string;
}>;
export type PaceCard = Infer<typeof paceCardValidator>;
export declare const paceCardContract: Contract<PaceCard>;
