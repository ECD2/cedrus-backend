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
import { type Contract, type Infer } from '../schema/core.ts';
export declare const AGENT_REQUEST_VERSION = 1;
export declare const REQUEST_CHANNELS: readonly ["sms", "web"];
export declare const RESPONSE_KINDS: readonly ["answered", "honest_decline", "safety_fixed_register", "deferred_to_operator"];
/**
 * Safety and compliance registers. CEDRUS.md I.6.4: "Compliance and safety
 * responses are never tone shifted. STOP, HELP, and anything touching a person
 * in distress stay in a fixed register regardless of setting."
 */
export declare const FIXED_REGISTER_TRIGGERS: readonly ["stop", "help", "distress", "none"];
export declare const agentRequestValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    request_id: string;
    member_id: string | null;
    channel: "web" | "sms";
    text: string;
    received_at: string;
    in_scope: boolean;
    scope_job: "find_somewhere_to_work" | "suggest_for_open_window" | "make_or_schedule_plan" | "record_what_happened" | "answer_goal_or_progress" | null;
    response_kind: "answered" | "honest_decline" | "safety_fixed_register" | "deferred_to_operator";
    logged_as_request: boolean;
    fixed_register_trigger: "none" | "stop" | "help" | "distress";
    voice_applied: boolean;
    operator_note?: string;
}>;
export type AgentRequest = Infer<typeof agentRequestValidator>;
export declare const agentRequestContract: Contract<AgentRequest>;
/**
 * The assistant's promise, as data. A surface can render this rather than
 * writing its own list and drifting from the canon.
 */
export declare const assistantPromiseValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    jobs: {
        find_somewhere_to_work: true;
        suggest_for_open_window: true;
        make_or_schedule_plan: true;
        record_what_happened: true;
        answer_goal_or_progress: true;
    };
    positioned_as_general_assistant: false;
}>;
export type AssistantPromise = Infer<typeof assistantPromiseValidator>;
