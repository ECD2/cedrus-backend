/**
 * Agent requests.
 *
 * Canon: CEDRUS.md Part I §6.4 — "Open input, narrow promise. Accepts any text.
 * Reliably handles a small set of jobs ... Anything outside that gets an honest
 * answer and a logged request. It is never positioned as a general assistant."
 *
 * AMENDED AT VENDOR TIME (2026-08-05). The lab was written against the
 * pre-reboot §6.4 and against §15's community-calendar job. Reboot canon removed
 * both the local-activity job and the calendar-of-events job, so the promise
 * below is re-derived from the current §6.4. The full mapping, with the reason
 * for each drop, is on `ASSISTANT_JOBS` in `common/primitives.ts`.
 *
 * Reboot plan §10 (SMS handoff): "Anything outside the promise gets an honest
 * answer and a logged request. The log of those requests is the roadmap."
 *
 * The mechanical rule: an out-of-scope request must be recorded as out of scope,
 * logged, and answered honestly. There is no state where `in_scope` is false and
 * the assistant answered as though it were in scope, because the contract will
 * not hold it.
 */
import { boolean, defineContract, enumOf, inspect, issue, literal, nullable, object, optional, refine, string, } from "../schema/core.js";
import { assistantJob, id, instant, memberId } from "../common/primitives.js";
export const AGENT_REQUEST_VERSION = 1;
export const REQUEST_CHANNELS = ['sms', 'web'];
export const RESPONSE_KINDS = ['answered', 'honest_decline', 'safety_fixed_register', 'deferred_to_operator'];
/**
 * Safety and compliance registers. CEDRUS.md I.6.4: "Compliance and safety
 * responses are never tone shifted. STOP, HELP, and anything touching a person
 * in distress stay in a fixed register regardless of setting."
 */
export const FIXED_REGISTER_TRIGGERS = ['stop', 'help', 'distress', 'none'];
const requestShape = object({
    schema_version: literal(AGENT_REQUEST_VERSION),
    request_id: id('Request id.'),
    member_id: nullable(memberId()),
    channel: enumOf(REQUEST_CHANNELS),
    /**
     * The member's text. This is the one place raw member language is retained,
     * because §24 makes it the roadmap. It is not copied into analytics except on
     * the one event that exists for it.
     */
    text: string({ minLength: 1, maxLength: 1600 }),
    received_at: instant('When it arrived.'),
    in_scope: boolean(),
    /** The job it maps to, when it is in scope. Null otherwise, never guessed. */
    scope_job: nullable(assistantJob()),
    response_kind: enumOf(RESPONSE_KINDS),
    /** Out-of-scope requests are logged. The log is the roadmap. */
    logged_as_request: boolean(),
    fixed_register_trigger: enumOf(FIXED_REGISTER_TRIGGERS),
    /** Tone is not applied to a fixed-register reply. */
    voice_applied: boolean(),
    operator_note: optional(string({ maxLength: 300 })),
});
export const agentRequestValidator = inspect(requestShape, {
    expressedInJsonSchema: false,
    run: (request, path) => {
        const issues = [];
        if (request.in_scope) {
            if (request.scope_job === null) {
                issues.push(issue(`${path}scope_job`, 'agent_request/in_scope_without_job', 'an in-scope request must name which job it is'));
            }
        }
        else {
            if (request.scope_job !== null) {
                issues.push(issue(`${path}scope_job`, 'agent_request/out_of_scope_with_job', 'an out-of-scope request may not be filed under a job it does not belong to'));
            }
            if (!request.logged_as_request) {
                issues.push(issue(`${path}logged_as_request`, 'agent_request/out_of_scope_not_logged', 'an out-of-scope request must be logged; that log is the roadmap'));
            }
            if (request.response_kind === 'answered') {
                issues.push(issue(`${path}response_kind`, 'agent_request/out_of_scope_answered_as_in_scope', 'anything outside the narrow promise gets an honest answer, not a confident one'));
            }
        }
        /** A fixed-register reply is never tone shifted. */
        if (request.fixed_register_trigger !== 'none') {
            if (request.voice_applied) {
                issues.push(issue(`${path}voice_applied`, 'agent_request/tone_shifted_safety_reply', 'STOP, HELP and distress replies stay in a fixed register regardless of the voice preference'));
            }
            if (request.response_kind !== 'safety_fixed_register') {
                issues.push(issue(`${path}response_kind`, 'agent_request/safety_trigger_wrong_response', 'a fixed-register trigger must be answered in the fixed register'));
            }
        }
        return issues;
    },
});
export const agentRequestContract = defineContract({
    name: 'cedrus.agent_request',
    version: AGENT_REQUEST_VERSION,
    title: 'Agent request',
    description: 'One inbound request. Open input, narrow promise: out of scope is recorded as out of scope, logged, and answered honestly.',
    sources: ['CEDRUS.md I.6.4', 'CEDRUS.md I.15 requirement this creates', 'reboot plan §10 SMS handoff', 'reboot plan §24'],
}, agentRequestValidator);
/**
 * The assistant's promise, as data. A surface can render this rather than
 * writing its own list and drifting from the canon.
 */
export const assistantPromiseValidator = refine(object({
    schema_version: literal(1),
    // Re-derived from reboot canon §6.4 at vendor time (2026-08-05). The object
    // is closed, so a surface still rendering `find_local_activity` or
    // `answer_calendar_of_events` fails to parse rather than quietly promising
    // a job the product retired.
    jobs: object({
        find_somewhere_to_work: literal(true),
        suggest_for_open_window: literal(true),
        make_or_schedule_plan: literal(true),
        record_what_happened: literal(true),
        answer_goal_or_progress: literal(true),
    }),
    positioned_as_general_assistant: literal(false),
}), {
    code: 'assistant_promise/shape',
    message: 'the promise is fixed',
    expressedInJsonSchema: true,
    predicate: () => true,
});
