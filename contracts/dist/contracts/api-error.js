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
import { arrayOf, boolean, defineContract, enumOf, inspect, integer, issue, literal, nullable, object, optional, string, walk, } from "../schema/core.js";
import { id, instant } from "../common/primitives.js";
export const API_ERROR_VERSION = 1;
export const API_ERROR_CODES = [
    'contract_violation',
    'not_found',
    'not_authorized',
    'not_authenticated',
    'rate_limited',
    'budget_guard_tripped',
    'connection_required',
    'connection_expired',
    'out_of_scope',
    'conflict',
    'dependency_unavailable',
    'internal_error',
];
/** Field names that may not appear in an error body. */
export const FORBIDDEN_ERROR_FIELDS = [
    'phone',
    'email',
    'text',
    'body',
    'message_text',
    'sms_body',
    'title',
    'summary',
    'description',
    'location',
    'attendees',
    'busy',
    'token',
    'accesstoken',
    'refreshtoken',
    'stack',
    'query',
    'sql',
];
const normaliseKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN_ERROR_FIELDS.map(normaliseKey));
const issueValidator = object({
    path: string({ maxLength: 200, description: 'Dotted path into the payload. Never a value.' }),
    code: string({ minLength: 3, maxLength: 80 }),
    /** A short explanation of the rule, not an echo of the offending value. */
    explanation: string({ minLength: 3, maxLength: 300 }),
});
const apiErrorShape = object({
    schema_version: literal(API_ERROR_VERSION),
    /** Never 2xx. The contract will not hold a success status on an error. */
    http_status: integer({ minimum: 400, maximum: 599 }),
    code: enumOf(API_ERROR_CODES),
    /**
     * Human-readable, and safe to show. Named `problem` rather than `summary`
     * because `summary` is a calendar field name and the guard below rejects it
     * anywhere in an error body; a contract should not need an exemption from its
     * own rule.
     */
    problem: string({ minLength: 3, maxLength: 200 }),
    /** Which contract rejected the payload, when the code is contract_violation. */
    contract: nullable(string({ minLength: 3, maxLength: 80 })),
    issues: arrayOf(issueValidator, { maxItems: 50 }),
    retryable: boolean(),
    retry_after_seconds: nullable(integer({ minimum: 1, maximum: 86400 })),
    /** Lesson 17: an opaque error must at least be traceable. */
    debug_ref: nullable(id('A reference an operator can follow into the logs.')),
    request_id: id('Request id.'),
    occurred_at: instant('When it happened.'),
    operator_hint: optional(string({ maxLength: 300 })),
});
export const apiErrorValidator = inspect(apiErrorShape, {
    expressedInJsonSchema: false,
    run: (error, path) => {
        const issues = [];
        if (error.code === 'contract_violation') {
            if (error.contract === null) {
                issues.push(issue(`${path}contract`, 'api_error/violation_without_contract', 'a contract violation names the contract it violated'));
            }
            if (error.issues.length === 0) {
                issues.push(issue(`${path}issues`, 'api_error/violation_without_issues', 'a contract violation lists what failed'));
            }
        }
        if (error.code === 'internal_error' && error.debug_ref === null) {
            issues.push(issue(`${path}debug_ref`, 'api_error/opaque_internal_error', 'an internal error must carry a debug reference; opaque errors cost hours'));
        }
        if (error.retryable && error.retry_after_seconds === null) {
            issues.push(issue(`${path}retry_after_seconds`, 'api_error/retryable_without_delay', 'a retryable error says when to retry'));
        }
        if (!error.retryable && error.retry_after_seconds !== null) {
            issues.push(issue(`${path}retry_after_seconds`, 'api_error/delay_without_retryable', 'a non-retryable error has no retry delay'));
        }
        walk(error, path, (node) => {
            if (node.key === null)
                return;
            if (FORBIDDEN_SET.has(normaliseKey(node.key))) {
                issues.push(issue(node.path, 'api_error/content_in_error', `"${node.key}" would put member or calendar content in an error body; an error body is a log line`));
            }
        });
        return issues;
    },
});
export const apiErrorContract = defineContract({
    name: 'cedrus.api_error',
    version: API_ERROR_VERSION,
    title: 'API error',
    description: 'A failure response. Never a 2xx, always specific enough to act on, never carrying member or calendar content.',
    sources: ['CEDRUS.md II.2', 'CEDRUS.md II.4 lessons 1 and 17', 'reboot plan §18'],
}, apiErrorValidator);
/** Builds a well-formed error from a ContractViolation's issue list. */
export const apiErrorFromIssues = (input) => ({
    schema_version: API_ERROR_VERSION,
    http_status: 422,
    code: 'contract_violation',
    problem: `${input.contract} rejected the payload`,
    contract: input.contract,
    issues: input.issues.map((i) => ({ path: i.path, code: i.code, explanation: i.message })),
    retryable: false,
    retry_after_seconds: null,
    debug_ref: null,
    request_id: input.request_id,
    occurred_at: input.occurred_at,
});
