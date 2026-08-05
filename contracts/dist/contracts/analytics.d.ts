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
import { type Contract, type Infer, type Validator } from '../schema/core.ts';
export declare const ANALYTICS_VERSION = 1;
/** The events, one per line of the validation gate. */
export declare const ANALYTICS_EVENT_NAMES: readonly ["signup.completed", "onboarding.started", "onboarding.step_completed", "onboarding.completed", "goal.set", "context.supplied", "connection.authorized", "connection.revoked", "sms.inbound.unprompted", "sms.request.out_of_scope", "card.generated", "card.reviewed", "card.delivered", "card.outcome", "card.helped", "member.silent_window", "return.visit", "return.sms", "payment.intent_expressed"];
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
/**
 * Names that are banned rather than merely absent. Rejecting these with their
 * own code is the difference between "unknown event" and "we do not count that".
 */
export declare const VANITY_EVENT_NAMES: readonly ["pageview", "page_view", "app.open", "app_open", "session.start", "signup.count", "messages.sent", "message_sent", "tasks.completed", "streak.extended", "time_in_app"];
/**
 * Field names that may never appear on an analytics event. Message content and
 * calendar data are both listed, because both are the same failure: a payload
 * that outlives its consent in a log store.
 */
export declare const FORBIDDEN_ANALYTICS_FIELDS: readonly ["text", "request_text", "message_text", "reply_text", "raw_text", "sms_body", "body", "message", "content", "note", "transcript", "title", "summary", "description", "location", "attendees", "busy", "intervals", "starts_at", "ends_at", "phone", "email"];
export declare const analyticsEventValidators: {
    readonly 'signup.completed': Validator<{
        schema_version: 1;
        event: "signup.completed";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            contact_ref: string;
            email_consent: boolean;
            sms_consent: boolean;
        };
    }>;
    readonly 'onboarding.started': Validator<{
        schema_version: 1;
        event: "onboarding.started";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            [x: string]: unknown;
        };
    }>;
    readonly 'onboarding.step_completed': Validator<{
        schema_version: 1;
        event: "onboarding.step_completed";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            step: "people" | "name" | "work_setup" | "neighborhood" | "free_windows" | "activities" | "current_groups" | "social_prefs";
        };
    }>;
    readonly 'onboarding.completed': Validator<{
        schema_version: 1;
        event: "onboarding.completed";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            steps_completed: 8;
        };
    }>;
    readonly 'goal.set': Validator<{
        schema_version: 1;
        event: "goal.set";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            goal_ref: string;
            lane: "work" | "people" | "body" | null;
        };
    }>;
    readonly 'context.supplied': Validator<{
        schema_version: 1;
        event: "context.supplied";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            kind: "stated_windows" | "activity" | "person" | "place_preference";
            ref: string;
        };
    }>;
    readonly 'connection.authorized': Validator<{
        schema_version: 1;
        event: "connection.authorized";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            connection_ref: string;
            provider: "google_calendar";
            scope_count: 1;
        };
    }>;
    readonly 'connection.revoked': Validator<{
        schema_version: 1;
        event: "connection.revoked";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            connection_ref: string;
            initiated_by: "provider" | "operator" | "member";
        };
    }>;
    readonly 'sms.inbound.unprompted': Validator<{
        schema_version: 1;
        event: "sms.inbound.unprompted";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            request_ref: string;
        };
    }>;
    readonly 'sms.request.out_of_scope': Validator<{
        schema_version: 1;
        event: "sms.request.out_of_scope";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            request_ref: string;
            request_text: string;
        };
    }>;
    readonly 'card.generated': Validator<{
        schema_version: 1;
        event: "card.generated";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            card_ref: string;
            goal_ref: string;
        };
    }>;
    readonly 'card.reviewed': Validator<{
        schema_version: 1;
        event: "card.reviewed";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            card_ref: string;
            decision: "approved" | "edited" | "killed";
            reason_code: "wrong_place" | "wrong_goal" | "wrong_window" | "tone_off" | "overclaimed_certainty" | "not_useful" | "duplicate" | "unsafe_or_insensitive" | "other" | null;
        };
    }>;
    readonly 'card.delivered': Validator<{
        schema_version: 1;
        event: "card.delivered";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            card_ref: string;
            channel: "web" | "sms";
        };
    }>;
    readonly 'card.outcome': Validator<{
        schema_version: 1;
        event: "card.outcome";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            card_ref: string;
            outcome: "did" | "did_something_else" | "did_not" | "deferred" | "silent";
            source: "sms" | "tap" | "no_response" | "unknown";
        };
    }>;
    readonly 'card.helped': Validator<{
        schema_version: 1;
        event: "card.helped";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            card_ref: string;
            helped: boolean;
        };
    }>;
    readonly 'member.silent_window': Validator<{
        schema_version: 1;
        event: "member.silent_window";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            window_days: 7;
            observed_from: string;
        };
    }>;
    readonly 'return.visit': Validator<{
        schema_version: 1;
        event: "return.visit";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            days_since_last: "7_to_13" | "14_to_29" | "30_plus";
        };
    }>;
    readonly 'return.sms': Validator<{
        schema_version: 1;
        event: "return.sms";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            days_since_last: "7_to_13" | "14_to_29" | "30_plus";
            request_ref: string;
        };
    }>;
    readonly 'payment.intent_expressed': Validator<{
        schema_version: 1;
        event: "payment.intent_expressed";
        event_id: string;
        member_id: string | null;
        occurred_at: string;
        props: {
            surface: "web" | "sms" | "in_person";
        };
    }>;
};
export type AnalyticsEvent = {
    [K in AnalyticsEventName]: Infer<(typeof analyticsEventValidators)[K]>;
}[AnalyticsEventName];
export declare const analyticsEventValidator: Validator<AnalyticsEvent>;
export declare const analyticsEventContract: Contract<AnalyticsEvent>;
/** Kept exported so a caller can enumerate what is instrumented. */
export declare const ASSISTANT_JOB_NAMES: readonly ["find_somewhere_to_work", "suggest_for_open_window", "make_or_schedule_plan", "record_what_happened", "answer_goal_or_progress"];
export declare const analyticsEventNames: readonly ["signup.completed", "onboarding.started", "onboarding.step_completed", "onboarding.completed", "goal.set", "context.supplied", "connection.authorized", "connection.revoked", "sms.inbound.unprompted", "sms.request.out_of_scope", "card.generated", "card.reviewed", "card.delivered", "card.outcome", "card.helped", "member.silent_window", "return.visit", "return.sms", "payment.intent_expressed"];
export declare const isVanityEventName: (name: string) => boolean;
