/**
 * Connector authorization.
 *
 * Canon: reboot plan §16 (authorization flow), §17 (data boundaries), §18
 * (least privilege), §19 (`connections`, `connection_tokens`), §27 risk 13
 * (scope creep is a trust promise, not a feature flag).
 *
 * The rule the work pack asks for: reject a connector authorization without a
 * named outcome and a narrow purpose. Enforced four ways, in
 * `guards/authorization.ts` and wired here:
 *
 *   1. `scopes` is a closed allowlist containing exactly the free/busy scope.
 *   2. `purpose` is one entry from a closed set, with a stated sentence.
 *   3. `named_outcome` is required, from a closed set, and may not be vague.
 *   4. every scope must be justified by the declared purpose.
 *
 * Plus the storage promises, as consts a code path cannot weaken:
 * `token_storage: 'server_only'`, `revocable: true`, `writes_to_provider: false`.
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const CONNECTION_VERSION = 2;
export declare const CONNECTION_PROVIDERS: readonly ["google_calendar"];
/**
 * Connection status. `half_connected` is deliberately absent: reboot plan §16
 * item 7, "Half-connected is not a state that exists."
 */
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 6.
 *
 * `disconnected` added. A member turning a connection off and a provider
 * revoking a token are different events with different obligations: the member
 * chose it and expects the derived data gone, the provider did it to us and the
 * member may not know yet. Recording both as `revoked` erases the distinction
 * that trust law item 10 and connector doctrine rule 10 rest on.
 *
 * `half_connected` stays deliberately absent, unchanged from the lab.
 *
 * Lab original: `['authorized', 'expired', 'revoked', 'failed']`.
 */
export declare const CONNECTION_STATUSES: readonly ["authorized", "expired", "revoked", "disconnected", "failed"];
export declare const connectionAuthorizationValidator: import("../schema/core.ts").Validator<{
    schema_version: 2;
    connection_id: string;
    member_id: string;
    provider: "google_calendar";
    scopes: readonly "calendar.freebusy.read"[];
    purpose: {
        code: "place_suggestions_in_open_time";
        statement: string;
    };
    named_outcome: {
        code: "suggestions_land_in_time_you_actually_have" | "today_stops_guessing_at_your_timing";
        statement: string;
    };
    disclosure: {
        reads: string;
        does_not_read: string;
        will_do: string;
        does_not_do: string;
    };
    consent_ref: string;
    status: "authorized" | "expired" | "revoked" | "disconnected" | "failed";
    authorized_at: string;
    last_sync_at: string | null;
    revoked_at: string | null;
    token_storage: "server_only";
    revocable: true;
    writes_to_provider: false;
    state_validated: boolean;
}>;
export type ConnectionAuthorization = Infer<typeof connectionAuthorizationValidator>;
export declare const connectionAuthorizationContract: Contract<ConnectionAuthorization>;
/**
 * v1: what a pre-reboot connection row looked like. A single `scope` string, no
 * purpose, no named outcome. It exists so the migration has something honest to
 * fail on: v1 cannot be upgraded automatically, because the missing fields are
 * a member's decision and inventing them would be the fabrication this whole
 * package is built to prevent.
 */
export declare const connectionAuthorizationV1Validator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    connection_id: string;
    member_id: string;
    provider: "google_calendar";
    scope: string;
    status: "authorized" | "expired" | "revoked" | "disconnected" | "failed";
    authorized_at: string;
    last_sync_at: string | null;
    revoked_at: string | null;
    consent_ref?: string;
}>;
export type ConnectionAuthorizationV1 = Infer<typeof connectionAuthorizationV1Validator>;
