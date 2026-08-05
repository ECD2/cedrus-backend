/**
 * API errors.
 *
 * Canon: CEDRUS.md Part II lesson 1 ("Catch → warn → continue is a disease"),
 * lesson 17 ("Opaque errors cost hours"), II.2 ("A 200 that was a swallowed
 * exception"), and reboot plan §18 ("Logs are a data store. Personal content
 * does not go into log lines").
 *
 * Three rules made mechanical:
 *   1. An error response is never a 2xx. A handler that catches its own error
 *      and returns a default looks healthy at the HTTP layer while being
 *      completely broken, and that has already cost this project real hours.
 *   2. An error names what failed specifically enough to act on: a stable code,
 *      the contract it came from when it is a validation failure, and the issue
 *      list. `internal_error` with no detail is the opaque error lesson 17 is
 *      about, so `debug_ref` is required for it.
 *   3. No personal content in an error. A deep guard rejects content-bearing
 *      fields, because an error body is a log line with extra steps.
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const API_ERROR_VERSION = 1;
export declare const API_ERROR_CODES: readonly ["contract_violation", "not_found", "not_authorized", "not_authenticated", "rate_limited", "budget_guard_tripped", "connection_required", "connection_expired", "out_of_scope", "conflict", "dependency_unavailable", "internal_error"];
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
/** Field names that may not appear in an error body. */
export declare const FORBIDDEN_ERROR_FIELDS: readonly ["phone", "email", "text", "body", "message_text", "sms_body", "title", "summary", "description", "location", "attendees", "busy", "token", "accesstoken", "refreshtoken", "stack", "query", "sql"];
export declare const apiErrorValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    http_status: number;
    code: "contract_violation" | "not_found" | "not_authorized" | "not_authenticated" | "rate_limited" | "budget_guard_tripped" | "connection_required" | "connection_expired" | "out_of_scope" | "conflict" | "dependency_unavailable" | "internal_error";
    problem: string;
    contract: string | null;
    issues: readonly {
        path: string;
        code: string;
        explanation: string;
    }[];
    retryable: boolean;
    retry_after_seconds: number | null;
    debug_ref: string | null;
    request_id: string;
    occurred_at: string;
    operator_hint?: string;
}>;
export type ApiError = Infer<typeof apiErrorValidator>;
export declare const apiErrorContract: Contract<ApiError>;
/** Builds a well-formed error from a ContractViolation's issue list. */
export declare const apiErrorFromIssues: (input: {
    readonly contract: string;
    readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
    }[];
    readonly request_id: string;
    readonly occurred_at: string;
}) => ApiError;
