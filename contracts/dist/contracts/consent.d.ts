/**
 * Consent.
 *
 * Canon: CEDRUS.md Part I §15 "List ownership and consent" —
 *   - "Record consent at signup: timestamp, IP address, and the exact wording
 *     the person agreed to. This is the defensible record if a complaint ever
 *     arrives."
 *   - "SMS consent is a compliance requirement, not a preference. Twilio
 *     requires consent for A2P messaging to be affirmative, separate from
 *     general terms, and unchecked by default ... Bundled or preselected
 *     consent causes campaign rejection."
 *   - Reboot plan §18: "Consent is per purpose and recorded with its exact
 *     wording ... Connections join the same model."
 *   - Reboot plan §26: "Existing `consent_events` rows keep their original text
 *     and must not be rewritten — that is the point of storing the wording per
 *     row."
 *
 * Three things the contract makes mechanical:
 *   1. `exact_wording` is required and non-trivial. A consent record without the
 *      words is not a record.
 *   2. `bundled` is a const `false` and `preselected` is a const `false`. There
 *      is no legal value for either that permits the thing Twilio rejects.
 *   3. Consent is append-only: `superseded_by` may point forward, but the
 *      wording of an existing row can never be rewritten. `migrate/` asserts it.
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const CONSENT_VERSION = 1;
/** Consent is per purpose. Email and SMS are separate events, never one checkbox. */
export declare const CONSENT_CHANNELS: readonly ["email_marketing", "email_transactional", "sms_assistant", "connection"];
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export declare const consentEventValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    consent_id: string;
    member_id: string | null;
    contact_ref: string;
    channel: "email_marketing" | "email_transactional" | "sms_assistant" | "connection";
    granted: boolean;
    exact_wording: string;
    bundled: false;
    preselected: false;
    occurred_at: string;
    superseded_by: string | null;
    ip_address?: string;
    user_agent?: string;
}>;
export type ConsentEvent = Infer<typeof consentEventValidator>;
export declare const consentEventContract: Contract<ConsentEvent>;
/**
 * The current permission state, which is a projection of the append-only events
 * and never a substitute for them. Finding 10 in the reboot plan is exactly the
 * gap this closes: an unsubscribe that is recorded but unenforceable.
 */
export declare const permissionStateValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    contact_ref: string;
    email_marketing: boolean;
    sms_assistant: boolean;
    suppressed: boolean;
    suppression_reason: "hard_bounce" | "complaint" | "manual" | null;
    derived_from_consent_ids: string | null;
    computed_at: string;
}>;
export type PermissionState = Infer<typeof permissionStateValidator>;
export declare const permissionStateContract: Contract<PermissionState>;
