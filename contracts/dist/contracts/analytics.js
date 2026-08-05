/**
 * Analytics events.
 *
 * Canon: reboot plan §24 — "Instrument the loop, not the pageviews. Each event
 * below maps to a line in the validation gate."
 *
 * The rules, verbatim, and how they are enforced:
 *   - "No vanity metrics on any dashboard: not signups, not pageviews, not
 *     messages sent, not app opens."  → the event name is a closed set, and the
 *     known vanity names are rejected with a named code rather than an unknown-
 *     enum error, so the rejection teaches.
 *   - "Analytics carry ids and enums, never message content or calendar data."
 *     → a deep guard rejects content-bearing and calendar-bearing fields on
 *     every event except the one event that exists to carry text.
 *   - "A member who does nothing is a data point, not a gap — record silence
 *     explicitly rather than inferring it from absence." → `card.outcome`
 *     accepts `silent`, and `member.silent_window` exists as its own event.
 */
import { boolean, defineContract, discriminatedUnion, enumOf, inspect, issue, literal, nullable, object, string, } from "../schema/core.js";
import { goalLane, id, instant, memberId } from "../common/primitives.js";
import { CARD_OUTCOMES } from "./card-outcome.js";
import { REVIEW_DECISIONS, REVIEW_REASON_CODES } from "./operator-review.js";
import { ASSISTANT_JOBS } from "../common/primitives.js";
import { walk } from "../schema/core.js";
export const ANALYTICS_VERSION = 1;
/** The events, one per line of the validation gate. */
export const ANALYTICS_EVENT_NAMES = [
    'signup.completed',
    'onboarding.started',
    'onboarding.step_completed',
    'onboarding.completed',
    'goal.set',
    'context.supplied',
    'connection.authorized',
    'connection.revoked',
    'sms.inbound.unprompted',
    'sms.request.out_of_scope',
    'card.generated',
    'card.reviewed',
    'card.delivered',
    'card.outcome',
    'card.helped',
    'member.silent_window',
    'return.visit',
    'return.sms',
    'payment.intent_expressed',
];
/**
 * Names that are banned rather than merely absent. Rejecting these with their
 * own code is the difference between "unknown event" and "we do not count that".
 */
export const VANITY_EVENT_NAMES = [
    'pageview',
    'page_view',
    'app.open',
    'app_open',
    'session.start',
    'signup.count',
    'messages.sent',
    'message_sent',
    'tasks.completed',
    'streak.extended',
    'time_in_app',
];
/**
 * Field names that may never appear on an analytics event. Message content and
 * calendar data are both listed, because both are the same failure: a payload
 * that outlives its consent in a log store.
 */
export const FORBIDDEN_ANALYTICS_FIELDS = [
    'text',
    'request_text',
    'message_text',
    'reply_text',
    'raw_text',
    'sms_body',
    'body',
    'message',
    'content',
    'note',
    'transcript',
    'title',
    'summary',
    'description',
    'location',
    'attendees',
    'busy',
    'intervals',
    'starts_at',
    'ends_at',
    'phone',
    'email',
];
const normaliseKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN_ANALYTICS_FIELDS.map(normaliseKey));
/**
 * The one exception, and it is deliberate. Reboot plan §24: `sms.request.
 * out_of_scope` (with text) is "the roadmap. What they want that we do not do."
 * The exception is a single named field on a single named event, so it cannot
 * spread.
 */
const TEXT_BEARING_EVENT = 'sms.request.out_of_scope';
const TEXT_BEARING_FIELD = 'request_text';
const envelope = (name, props) => object({
    schema_version: literal(ANALYTICS_VERSION),
    event: literal(name),
    event_id: id('Event id.'),
    member_id: nullable(memberId()),
    occurred_at: instant('When it happened.'),
    props: object(props),
});
const noProps = {};
export const analyticsEventValidators = {
    'signup.completed': envelope('signup.completed', {
        contact_ref: id('The acquisition record.'),
        email_consent: boolean(),
        sms_consent: boolean(),
    }),
    'onboarding.started': envelope('onboarding.started', noProps),
    'onboarding.step_completed': envelope('onboarding.step_completed', {
        step: enumOf(['name', 'work_setup', 'neighborhood', 'free_windows', 'activities', 'current_groups', 'people', 'social_prefs']),
    }),
    'onboarding.completed': envelope('onboarding.completed', {
        steps_completed: literal(8),
    }),
    'goal.set': envelope('goal.set', {
        goal_ref: id('The goal.'),
        lane: nullable(goalLane()),
    }),
    'context.supplied': envelope('context.supplied', {
        kind: enumOf(['stated_windows', 'activity', 'person', 'place_preference']),
        ref: id('The record supplied.'),
    }),
    'connection.authorized': envelope('connection.authorized', {
        connection_ref: id('The connection.'),
        provider: literal('google_calendar'),
        scope_count: literal(1),
    }),
    'connection.revoked': envelope('connection.revoked', {
        connection_ref: id('The connection.'),
        initiated_by: enumOf(['member', 'provider', 'operator']),
    }),
    'sms.inbound.unprompted': envelope('sms.inbound.unprompted', {
        request_ref: id('The agent request.'),
    }),
    'sms.request.out_of_scope': envelope('sms.request.out_of_scope', {
        request_ref: id('The agent request.'),
        /** The single deliberate exception. See §24: this log is the roadmap. */
        request_text: string({ minLength: 1, maxLength: 1600 }),
    }),
    'card.generated': envelope('card.generated', {
        card_ref: id('The card.'),
        goal_ref: id('The goal it hangs on.'),
    }),
    'card.reviewed': envelope('card.reviewed', {
        card_ref: id('The card.'),
        decision: enumOf(REVIEW_DECISIONS),
        reason_code: nullable(enumOf(REVIEW_REASON_CODES)),
    }),
    'card.delivered': envelope('card.delivered', {
        card_ref: id('The card.'),
        channel: enumOf(['web', 'sms']),
    }),
    'card.outcome': envelope('card.outcome', {
        card_ref: id('The card.'),
        outcome: enumOf(CARD_OUTCOMES),
        source: enumOf(['tap', 'sms', 'no_response', 'unknown']),
    }),
    'card.helped': envelope('card.helped', {
        card_ref: id('The card.'),
        helped: boolean(),
    }),
    'member.silent_window': envelope('member.silent_window', {
        /** Silence recorded explicitly, with the window it was observed over. */
        window_days: literal(7),
        observed_from: instant('Start of the observation window.'),
    }),
    'return.visit': envelope('return.visit', {
        days_since_last: enumOf(['7_to_13', '14_to_29', '30_plus']),
    }),
    'return.sms': envelope('return.sms', {
        days_since_last: enumOf(['7_to_13', '14_to_29', '30_plus']),
        request_ref: id('The agent request.'),
    }),
    'payment.intent_expressed': envelope('payment.intent_expressed', {
        surface: enumOf(['sms', 'web', 'in_person']),
    }),
};
const unionMembers = ANALYTICS_EVENT_NAMES.map((name) => ({
    tag: name,
    validator: analyticsEventValidators[name],
}));
const baseUnion = discriminatedUnion('event', unionMembers);
/** Vanity names get their own rejection, so the error explains the doctrine. */
const vanityAware = {
    kind: 'analytics-union',
    schema: baseUnion.schema,
    fullyExpressedInJsonSchema: baseUnion.fullyExpressedInJsonSchema,
    check(input, path) {
        if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
            const name = input['event'];
            if (typeof name === 'string' && VANITY_EVENT_NAMES.includes(name)) {
                return [
                    issue(path === '' ? 'event' : `${path}.event`, 'analytics/vanity_metric', `"${name}" is a vanity metric; Cedrus instruments the loop, not the pageviews`),
                ];
            }
        }
        return baseUnion.check(input, path);
    },
};
export const analyticsEventValidator = inspect(vanityAware, {
    expressedInJsonSchema: false,
    run: (event, path) => {
        const issues = [];
        walk(event, path, (node) => {
            if (node.key === null)
                return;
            const normalised = normaliseKey(node.key);
            if (!FORBIDDEN_SET.has(normalised))
                return;
            if (event.event === TEXT_BEARING_EVENT && node.key === TEXT_BEARING_FIELD)
                return;
            issues.push(issue(node.path, 'analytics/content_in_event', `"${node.key}" carries message or calendar content; analytics carry ids and enums`));
        });
        return issues;
    },
});
export const analyticsEventContract = defineContract({
    name: 'cedrus.analytics_event',
    version: ANALYTICS_VERSION,
    title: 'Analytics event',
    description: 'One instrumented event from the loop. Ids and enums only, with one named exception for the out-of-scope request log.',
    sources: ['reboot plan §24', 'CEDRUS.md I.11', 'CEDRUS.md I.4'],
}, analyticsEventValidator);
/** Kept exported so a caller can enumerate what is instrumented. */
export const ASSISTANT_JOB_NAMES = ASSISTANT_JOBS;
export const analyticsEventNames = ANALYTICS_EVENT_NAMES;
export const isVanityEventName = (name) => VANITY_EVENT_NAMES.includes(name);
