/**
 * Today state.
 *
 * Canon: CEDRUS.md Part I §6.3, reboot plan §10 (`/today`), §11 (Today before
 * Calendar), §12 (Today after Calendar), §8 ("Unfinished is labelled, never
 * mocked ... No placeholder data, ever").
 *
 * The rule this contract exists to make mechanical:
 *
 *   "Always says which one it is." Zone 1 of Today is the state of the day, and
 *   it is either derived from stated schedule (an inference) or from a live
 *   calendar projection (a known fact). Reboot plan §12: "'Usually open' becomes
 *   'open.' Inference becomes known fact, and the label changes with it."
 *
 * So: when `timing_basis` is `stated`, the day line must be an `inferred`
 * statement. It cannot be `known`. That is the single most likely place in the
 * product for an inference to be presented as a known fact, and it is a type
 * error here.
 *
 * And the degradation rule (reboot plan §12, Lesson 7): when the connection is
 * stale, revoked, or absent, Today falls back and *says so*. `fallback_notice`
 * is required in that state, which is what distinguishes "checked and fine"
 * from "did not run".
 */
import { arrayOf, boolean, defineContract, enumOf, inspect, issue, literal, nullable, object, optional, string, } from "../schema/core.js";
import { id, instant, localDate, memberId, phoneDigits } from "../common/primitives.js";
import { paceCardValidator } from "./pace-card.js";
import { statementValidator } from "./statement.js";
export const TODAY_VERSION = 1;
export const TIMING_BASES = ['stated', 'calendar'];
/** One goal, with a one-line status a member can tap to report against. */
const goalStatusLineValidator = object({
    goal_ref: id('The goal.'),
    stated_text: string({ minLength: 3, maxLength: 200, description: "Quoted in the member's words." }),
    /** The status is a tagged statement, so its certainty is labelled like everything else. */
    status_statement: statementValidator,
    can_report_outcome: boolean(),
});
const todayShape = object({
    schema_version: literal(TODAY_VERSION),
    member_id: memberId(),
    for_date: localDate('The member-local day.'),
    /** Zone 1: the day. */
    timing_basis: enumOf(TIMING_BASES),
    day_line: statementValidator,
    fallback_notice: nullable(enumOf(['using_your_usual_windows', 'calendar_disconnected', 'calendar_stale'])),
    /** Zone 2: the card. One or none. Never a teaser, never an example. */
    card: nullable(paceCardValidator),
    /** Zone 3: goals. Zero to three. */
    goals: arrayOf(goalStatusLineValidator, { maxItems: 3 }),
    /**
     * The empty state is designed, not derived. Reboot plan §10: honest, specific,
     * actionable, and "It never shows an example card."
     */
    empty_state: nullable(object({
        known_so_far: arrayOf(string({ minLength: 3, maxLength: 160 }), { maxItems: 5 }),
        waiting_for: arrayOf(string({ minLength: 3, maxLength: 160 }), { maxItems: 5 }),
        shows_example_card: literal(false),
    })),
    /** SMS handoff. The web keeps handing off to the channel the product lives in. */
    sms_handoff: object({
        cedrus_number: phoneDigits(),
        prefilled_text: optional(string({ maxLength: 160 })),
    }),
    computed_at: instant('When this state was computed.'),
});
export const todayStateValidator = inspect(todayShape, {
    expressedInJsonSchema: false,
    run: (today, path) => {
        const issues = [];
        /**
         * The rule. Stated timing is an inference and must be labelled as one.
         * Calendar timing may be a known fact, and only then.
         */
        if (today.timing_basis === 'stated' && today.day_line.kind !== 'inferred') {
            issues.push(issue(`${path}day_line.kind`, 'today/stated_timing_presented_as_known', `timing derived from stated windows is an inference; day_line.kind was "${today.day_line.kind}"`));
        }
        if (today.timing_basis === 'calendar' && today.day_line.kind === 'user_reported') {
            issues.push(issue(`${path}day_line.kind`, 'today/calendar_timing_mislabelled', 'calendar-derived timing is known or inferred, never user_reported'));
        }
        /** A known day line must cite the calendar projection it came from. */
        if (today.day_line.kind === 'known' && today.day_line.source.type !== 'calendar_freebusy') {
            issues.push(issue(`${path}day_line.source.type`, 'today/known_day_line_without_calendar', 'a known statement about today\'s timing must come from the free/busy projection'));
        }
        /** Degradation is announced, never silent. */
        const needsNotice = today.timing_basis === 'stated';
        if (needsNotice && today.fallback_notice === null) {
            issues.push(issue(`${path}fallback_notice`, 'today/silent_fallback', 'Today fell back to stated windows and must say so; a silent fallback looks certain while guessing'));
        }
        if (!needsNotice && today.fallback_notice !== null) {
            issues.push(issue(`${path}fallback_notice`, 'today/notice_without_fallback', 'a fallback notice without a fallback is misleading'));
        }
        /** The card belongs to this member and this day. One per member per day. */
        if (today.card !== null) {
            if (today.card.member_id !== today.member_id) {
                issues.push(issue(`${path}card.member_id`, 'today/card_member_mismatch', "Today may only show this member's card"));
            }
            if (today.card.for_date !== today.for_date) {
                issues.push(issue(`${path}card.for_date`, 'today/card_date_mismatch', 'the card must be for the day being shown'));
            }
            if (today.card.status !== 'delivered') {
                issues.push(issue(`${path}card.status`, 'today/undelivered_card_shown', 'Today shows delivered cards only; a draft has not been reviewed'));
            }
        }
        /** An empty state and a card are mutually exclusive. */
        if (today.card !== null && today.empty_state !== null) {
            issues.push(issue(`${path}empty_state`, 'today/empty_state_with_card', 'an empty state cannot accompany a card'));
        }
        return issues;
    },
});
export const todayStateContract = defineContract({
    name: 'cedrus.today_state',
    version: TODAY_VERSION,
    title: 'Today state',
    description: 'The state of the day and the one next thing. Timing derived from stated windows is always labelled an inference, and a fallback always says so.',
    sources: ['CEDRUS.md I.6.3', 'reboot plan §10 /today', 'reboot plan §11', 'reboot plan §12', 'CEDRUS.md II.4 lesson 7'],
}, todayStateValidator);
/**
 * The pace card as Today renders it. Kept as a named re-export so a surface can
 * depend on the card contract without importing the whole Today shape.
 */
export { paceCardContract } from "./pace-card.js";
