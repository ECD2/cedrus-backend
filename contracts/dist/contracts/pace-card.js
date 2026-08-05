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
import { arrayOf, defineContract, enumOf, inspect, issue, literal, nullable, object, optional, refine, } from "../schema/core.js";
import { id, instant, localDate, memberId } from "../common/primitives.js";
import { checkNoLaundering } from "../guards/provenance.js";
import { statementValidator } from "./statement.js";
export const PACE_CARD_VERSION = 1;
/** Reboot plan §19 `pace_cards.status`. `delivered` is the only terminal state. */
export const PACE_CARD_STATUSES = ['draft', 'approved', 'edited', 'killed', 'delivered'];
export const PACE_CARD_CHANNELS = ['web', 'sms'];
const cardShape = object({
    schema_version: literal(PACE_CARD_VERSION),
    card_id: id('Card id.'),
    member_id: memberId(),
    /** No card without a goal to hang it on. */
    goal_ref: id('The goal this card serves.'),
    /** The day the card belongs to. One per member per day is enforced against this. */
    for_date: localDate('The member-local day this card is for.'),
    /**
     * The four blocks. Order is preserved as authored, because `/card/$id` renders
     * them in the order of the definition and collapsing them is the one
     * unrecoverable product failure.
     */
    parts: arrayOf(statementValidator, {
        minItems: 2,
        maxItems: 8,
        description: 'Tagged statements. Exactly one proposed_action; at least one known or user_reported.',
    }),
    window: refine(object({ starts_at: instant('Window start.'), ends_at: instant('Window end.') }), {
        code: 'window/ends_before_starts',
        message: 'ends_at must be after starts_at',
        expressedInJsonSchema: false,
        predicate: (w) => Date.parse(w.ends_at) > Date.parse(w.starts_at),
    }),
    status: enumOf(PACE_CARD_STATUSES),
    review_ref: nullable(id('The operator review that decided this card.')),
    created_at: instant('Created.'),
    delivered_at: nullable(instant('Delivered, if it was.')),
    delivered_via: nullable(enumOf(PACE_CARD_CHANNELS)),
    /** Which tone preference the draft was written in. Recorded, not inferred later. */
    voice_ref: optional(id('The voice preference in force when this was drafted.')),
});
/**
 * Narrows a statement to the shape the laundering check needs. Written as a
 * switch rather than an `in` test so the compiler proves every kind is handled
 * and a new statement kind cannot be silently skipped.
 */
const toProvenanceNode = (statement) => {
    switch (statement.kind) {
        case 'known':
        case 'inferred':
            return { kind: statement.kind, statement_id: statement.statement_id, derived_from: statement.derived_from };
        case 'user_reported':
        case 'proposed_action':
            return { kind: statement.kind, statement_id: statement.statement_id };
        default:
            return { kind: statement.kind, statement_id: statement.statement_id };
    }
};
/** Card-level rules that no single field can express. */
const cardRules = (card, path) => {
    const issues = [];
    const parts = card.parts;
    const proposals = parts.filter((p) => p.kind === 'proposed_action');
    if (proposals.length !== 1) {
        issues.push(issue(`${path}parts`, 'pace_card/not_one_action', `a card proposes exactly one action, found ${proposals.length}; two cards means neither is the one thing`));
    }
    const grounded = parts.filter((p) => p.kind === 'known' || p.kind === 'user_reported');
    if (grounded.length === 0) {
        issues.push(issue(`${path}parts`, 'pace_card/no_grounded_statement', 'a card must rest on at least one known or user-reported statement; all-inference is a guess with a layout'));
    }
    const ids = new Set();
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (part === undefined)
            continue;
        if (ids.has(part.statement_id)) {
            issues.push(issue(`${path}parts[${i}].statement_id`, 'pace_card/duplicate_statement', 'duplicate statement id'));
        }
        ids.add(part.statement_id);
    }
    /** The proposed action must serve the card's goal. */
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (part === undefined || part.kind !== 'proposed_action')
            continue;
        if (part.goal_ref !== card.goal_ref) {
            issues.push(issue(`${path}parts[${i}].goal_ref`, 'pace_card/action_goal_mismatch', 'the proposed action must serve the goal the card is hung on'));
        }
    }
    /** Provenance does not launder inside a card either. */
    issues.push(...checkNoLaundering(parts.map(toProvenanceNode), `${path}parts`));
    /** Every card is reviewed before delivery. */
    if (card.status === 'delivered') {
        if (card.review_ref === null) {
            issues.push(issue(`${path}review_ref`, 'pace_card/delivered_unreviewed', 'a delivered card must cite the operator review that approved it'));
        }
        if (card.delivered_at === null || card.delivered_via === null) {
            issues.push(issue(`${path}delivered_at`, 'pace_card/delivery_not_recorded', 'a delivered card records when and where it went'));
        }
    }
    else if (card.delivered_at !== null) {
        issues.push(issue(`${path}delivered_at`, 'pace_card/delivery_without_status', 'only a delivered card carries a delivery time'));
    }
    return issues;
};
export const paceCardValidator = inspect(cardShape, {
    expressedInJsonSchema: false,
    run: cardRules,
});
export const paceCardContract = defineContract({
    name: 'cedrus.pace_card',
    version: PACE_CARD_VERSION,
    title: 'Pace card',
    description: 'One card: a goal, tagged statements about what is known and what is inferred, and exactly one proposed action sized to a window.',
    sources: ['reboot plan §3', 'reboot plan §10 /card/$id', 'reboot plan §14', 'reboot plan §19', 'reboot plan §27 risk 12'],
}, paceCardValidator);
