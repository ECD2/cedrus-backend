/**
 * Import and export envelopes.
 *
 * Canon: CEDRUS.md Part I §15 rule 8 — "Export the full contact and consent
 * state periodically, so a provider outage or account problem is never a data
 * loss event." And reboot plan §18: "Deletion is real ... The consent audit
 * trail is retained deliberately, because it is the legal record of a permission
 * that was granted; that retention is disclosed."
 *
 * Three rules made mechanical:
 *   1. `record_count` is a `Count` and must name what it counted, so an export
 *      cannot claim more rows than it carries. Same guard as Progression.
 *   2. Credentials never leave the system. `connection_tokens` is the one table
 *      where a mistake is a credential leak (reboot plan §20 migration 6), so a
 *      deep guard rejects any token-shaped field anywhere in the envelope.
 *   3. Every record carries its own `schema_version`, so an envelope written six
 *      months ago is readable by `migrate/` without a side channel.
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const ENVELOPE_VERSION = 1;
export declare const ENVELOPE_KINDS: readonly ["export", "import"];
/** Contracts an envelope is allowed to carry. A closed list, not "anything". */
export declare const PORTABLE_CONTRACTS: readonly ["cedrus.member_profile", "cedrus.goal", "cedrus.goal_set", "cedrus.consent_event", "cedrus.permission_state", "cedrus.pace_card", "cedrus.card_outcome", "cedrus.member_activity", "cedrus.person", "cedrus.place", "cedrus.plan", "cedrus.progression", "cedrus.connection_authorization", "cedrus.availability"];
/**
 * Field names that must never appear in an envelope, at any depth. Tokens are
 * server-side only and are not member data (reboot plan §16 item 4, §19).
 */
export declare const FORBIDDEN_ENVELOPE_FIELDS: readonly ["accesstoken", "refreshtoken", "token", "tokens", "clientsecret", "servicerolekey", "anonkey", "apikey", "password", "secret", "privatekey", "authorizationheader"];
export declare const dataEnvelopeValidator: import("../schema/core.ts").Validator<{
    envelope_version: 1;
    kind: "export" | "import";
    generated_at: string;
    member_id: string | null;
    source_system: "cedrus_backend" | "cedrus_miami" | "operator_tool";
    records: readonly {
        contract: "cedrus.member_profile" | "cedrus.goal" | "cedrus.goal_set" | "cedrus.consent_event" | "cedrus.permission_state" | "cedrus.connection_authorization" | "cedrus.availability" | "cedrus.pace_card" | "cedrus.card_outcome" | "cedrus.member_activity" | "cedrus.place" | "cedrus.person" | "cedrus.plan" | "cedrus.progression";
        schema_version: number;
        record_id: string;
        payload: {
            [key: string]: import("../schema/core.ts").JsonValue;
        };
    }[];
    integrity: {
        record_count: {
            value: number;
            basis: "observed_rows" | "operator_verified";
            source_refs: readonly string[];
        };
        checksum_sha256: string;
    };
    redactions: readonly {
        contract: "cedrus.member_profile" | "cedrus.goal" | "cedrus.goal_set" | "cedrus.consent_event" | "cedrus.permission_state" | "cedrus.connection_authorization" | "cedrus.availability" | "cedrus.pace_card" | "cedrus.card_outcome" | "cedrus.member_activity" | "cedrus.place" | "cedrus.person" | "cedrus.plan" | "cedrus.progression";
        reason: "credentials_never_exported" | "retained_legal_record" | "not_member_data";
        note?: string;
    }[];
}>;
export type DataEnvelope = Infer<typeof dataEnvelopeValidator>;
export declare const dataEnvelopeContract: Contract<DataEnvelope>;
