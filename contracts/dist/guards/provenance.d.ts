/**
 * Guard: an inference may not be presented as a known fact.
 *
 * Canon:
 *   - CEDRUS.md Part I §7 item 3 (no fabricated counts) and §11 (a better day is
 *     *confirmed*, not assumed).
 *   - Reboot plan §10 `/card/$id`: the four statement kinds must be
 *     distinguishable without reading carefully.
 *   - Reboot plan §12: "usually open" becomes "open" only when the fact is
 *     known, "and the label changes with it".
 *   - Reboot plan §13: "Unverified stays unverified. Self-reported activity is a
 *     user-reported fact everywhere it is used ... It never gets promoted to a
 *     known fact."
 *   - Reboot plan §27 risk 12: a card collapsing its statement kinds is "the one
 *     unrecoverable product failure".
 *
 * This file is the mechanical form of that doctrine. Three separate checks,
 * because a single one is easy to route around:
 *
 *   1. SOURCE   — a `known` statement may only cite a verifiable source type.
 *                 `model_inference`, `heuristic`, `statistical_prior`,
 *                 `member_sms` and `member_tap` are not verifiable sources.
 *   2. LANGUAGE — a `known` statement may not be phrased with a hedge, and an
 *                 `inferred` statement may not be phrased with certainty. This
 *                 is the "presented as" half: the label can be right while the
 *                 sentence lies.
 *   3. DERIVATION — a `known` statement may not be derived from an `inferred`
 *                 or `user_reported` statement. Provenance does not launder.
 */
import { type Issue, type JsonSchema } from '../schema/core.ts';
export declare const STATEMENT_KINDS: readonly ["known", "user_reported", "inferred", "proposed_action"];
export type StatementKind = (typeof STATEMENT_KINDS)[number];
/**
 * Hedge markers. A sentence containing one of these is an inference wearing a
 * known label, whatever the tag says.
 */
export declare const HEDGE_MARKERS: readonly ["usually", "probably", "might", "maybe", "seems", "looks like", "likely", "i think", "i guess", "should be", "tends to", "often", "perhaps", "my guess"];
/**
 * Certainty markers. A sentence containing one of these is a known claim
 * wearing an inferred label, which is the same failure pointed the other way.
 */
export declare const CERTAINTY_MARKERS: readonly ["definitely", "certainly", "confirmed", "guaranteed", "for sure", "without a doubt", "proven", "verified"];
/** Source types that can back a `known` statement. Closed on purpose. */
export declare const KNOWN_SOURCE_TYPES: readonly ["calendar_freebusy", "member_stated", "operator_entered", "system_record"];
/** Source types that can back a `user_reported` statement. */
export declare const USER_REPORTED_SOURCE_TYPES: readonly ["member_sms", "member_tap", "operator_entered"];
/** Source types that can back an `inferred` statement. */
export declare const INFERRED_SOURCE_TYPES: readonly ["model_inference", "heuristic", "statistical_prior"];
export interface StatementLike {
    readonly kind: StatementKind;
    readonly text: string;
    readonly source?: {
        readonly type: string;
        readonly ref: string;
    } | undefined;
    readonly derived_from?: readonly string[] | undefined;
}
/** Check 1. The cited source type must be verifiable for a `known` statement. */
export declare const checkKnownSource: (sourceType: string, path: string) => readonly Issue[];
/** Check 2a. A `known` statement may not hedge. */
export declare const checkKnownLanguage: (text: string, path: string) => readonly Issue[];
/** Check 2b. An `inferred` statement may not be phrased with certainty. */
export declare const checkInferredLanguage: (text: string, path: string) => readonly Issue[];
/**
 * Check 3. Provenance does not launder. A `known` statement may not be derived
 * from anything softer than itself.
 */
export declare const checkNoLaundering: (statements: readonly {
    readonly kind: StatementKind;
    readonly statement_id: string;
    readonly derived_from?: readonly string[] | undefined;
}[], path: string) => readonly Issue[];
/** JSON Schema fragment forbidding hedge language in a text field. */
export declare const noHedgeSchema: () => JsonSchema;
/** JSON Schema fragment forbidding certainty language in a text field. */
export declare const noCertaintySchema: () => JsonSchema;
