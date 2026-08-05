/**
 * Guard: a connector authorization needs a named outcome and a narrow purpose.
 *
 * Canon:
 *   - Reboot plan §10 (`/settings/connections`): "an informed yes or no, and a
 *     reversible one" — what Cedrus will read, what it will not read, what it
 *     will do with it, what it does not do.
 *   - Reboot plan §16: "Request the narrowest calendar scope that returns
 *     free/busy and no more."
 *   - Reboot plan §18: "Nothing is collected without a shipped feature consuming
 *     it. If no screen and no card reads a field, it is not stored." and
 *     "Consent is per purpose and recorded with its exact wording."
 *   - Reboot plan §27 risk 13: "Calendar scope creep ... Widening the scope
 *     requires Emil."
 *
 * Four checks:
 *   1. SCOPE      — every requested scope must be on the allowlist.
 *   2. PURPOSE    — exactly one purpose, from a closed set, stated in words.
 *   3. OUTCOME    — a named outcome the member receives, and not a generic one.
 *   4. NARROWNESS — every requested scope must be justified by the purpose. A
 *                   scope nothing consumes is scope creep with a form filled in.
 */
import { type Issue } from '../schema/core.ts';
/**
 * The only scopes Cedrus v0 may request. Widening this list is Emil's decision,
 * not a code review's, so the list itself is the gate.
 */
export declare const ALLOWED_SCOPES: readonly ["calendar.freebusy.read"];
export type AllowedScope = (typeof ALLOWED_SCOPES)[number];
/** Purposes a connection may serve. One connection, one purpose. */
export declare const AUTHORIZATION_PURPOSES: readonly ["place_suggestions_in_open_time"];
export type AuthorizationPurpose = (typeof AUTHORIZATION_PURPOSES)[number];
/**
 * What the member gets. Named, singular, and in the product's own terms. This is
 * the "what it will do with it" line from the pre-consent screen, as data.
 */
export declare const NAMED_OUTCOMES: readonly ["suggestions_land_in_time_you_actually_have", "today_stops_guessing_at_your_timing"];
export type NamedOutcome = (typeof NAMED_OUTCOMES)[number];
/**
 * Which scopes each purpose can justify. A scope not listed under the declared
 * purpose is unjustified, and unjustified is rejected.
 */
export declare const SCOPES_JUSTIFIED_BY_PURPOSE: Readonly<Record<AuthorizationPurpose, readonly AllowedScope[]>>;
/**
 * Outcome wording that says nothing. A named outcome that could be printed on
 * any product's consent screen is not a named outcome.
 */
export declare const VAGUE_OUTCOME_PHRASES: readonly ["improve your experience", "better service", "serve you better", "personalization", "personalisation", "analytics", "product improvement", "to help us", "enhance", "optimize", "optimise"];
export interface AuthorizationLike {
    readonly scopes: readonly string[];
    readonly purpose: {
        readonly code: string;
        readonly statement: string;
    };
    readonly named_outcome: {
        readonly code: string;
        readonly statement: string;
    };
}
/** Check 1. Scope allowlist. */
export declare const checkScopesAllowed: (scopes: readonly string[], path: string) => readonly Issue[];
/** Check 3. The named outcome must be named, and must say something. */
export declare const checkNamedOutcome: (outcome: {
    readonly code: string;
    readonly statement: string;
}, path: string) => readonly Issue[];
/** Check 4. Every scope must be justified by the declared purpose. */
export declare const checkScopesJustified: (auth: AuthorizationLike, path: string) => readonly Issue[];
/** All four checks, for use at the authorization boundary. */
export declare const checkAuthorization: (auth: AuthorizationLike, path?: string) => readonly Issue[];
