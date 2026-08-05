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
import { issue, matchesAnyWord, notAnyOfPatterns } from "../schema/core.js";
export const STATEMENT_KINDS = ['known', 'user_reported', 'inferred', 'proposed_action'];
/**
 * Hedge markers. A sentence containing one of these is an inference wearing a
 * known label, whatever the tag says.
 */
export const HEDGE_MARKERS = [
    'usually',
    'probably',
    'might',
    'maybe',
    'seems',
    'looks like',
    'likely',
    'i think',
    'i guess',
    'should be',
    'tends to',
    'often',
    'perhaps',
    'my guess',
];
/**
 * Certainty markers. A sentence containing one of these is a known claim
 * wearing an inferred label, which is the same failure pointed the other way.
 */
export const CERTAINTY_MARKERS = [
    'definitely',
    'certainly',
    'confirmed',
    'guaranteed',
    'for sure',
    'without a doubt',
    'proven',
    'verified',
];
/** Source types that can back a `known` statement. Closed on purpose. */
export const KNOWN_SOURCE_TYPES = ['calendar_freebusy', 'member_stated', 'operator_entered', 'system_record'];
/** Source types that can back a `user_reported` statement. */
export const USER_REPORTED_SOURCE_TYPES = ['member_sms', 'member_tap', 'operator_entered'];
/** Source types that can back an `inferred` statement. */
export const INFERRED_SOURCE_TYPES = ['model_inference', 'heuristic', 'statistical_prior'];
/** Check 1. The cited source type must be verifiable for a `known` statement. */
export const checkKnownSource = (sourceType, path) => {
    if (KNOWN_SOURCE_TYPES.includes(sourceType))
        return [];
    return [
        issue(path, 'provenance/inference_as_known', `a known statement may not cite "${sourceType}"; verifiable sources are: ${KNOWN_SOURCE_TYPES.join(', ')}`),
    ];
};
/** Check 2a. A `known` statement may not hedge. */
export const checkKnownLanguage = (text, path) => {
    const hit = matchesAnyWord(text, HEDGE_MARKERS);
    if (hit === null)
        return [];
    return [
        issue(path, 'provenance/hedged_known', `a known statement is phrased as a guess ("${hit}"); label it inferred or state it without the hedge`),
    ];
};
/** Check 2b. An `inferred` statement may not be phrased with certainty. */
export const checkInferredLanguage = (text, path) => {
    const hit = matchesAnyWord(text, CERTAINTY_MARKERS);
    if (hit === null)
        return [];
    return [
        issue(path, 'provenance/certain_inference', `an inferred statement is phrased as fact ("${hit}"); hedge it or promote it to known with a verifiable source`),
    ];
};
/**
 * Check 3. Provenance does not launder. A `known` statement may not be derived
 * from anything softer than itself.
 */
export const checkNoLaundering = (statements, path) => {
    const kindById = new Map();
    for (const s of statements)
        kindById.set(s.statement_id, s.kind);
    const issues = [];
    for (let i = 0; i < statements.length; i += 1) {
        const s = statements[i];
        if (s === undefined || s.kind !== 'known')
            continue;
        for (const ref of s.derived_from ?? []) {
            const parentKind = kindById.get(ref);
            if (parentKind === undefined)
                continue;
            if (parentKind === 'inferred' || parentKind === 'user_reported') {
                issues.push(issue(`${path}[${i}].derived_from`, 'provenance/laundered_known', `a known statement may not be derived from a ${parentKind} statement (${ref})`));
            }
        }
    }
    return issues;
};
/** JSON Schema fragment forbidding hedge language in a text field. */
export const noHedgeSchema = () => notAnyOfPatterns(HEDGE_MARKERS);
/** JSON Schema fragment forbidding certainty language in a text field. */
export const noCertaintySchema = () => notAnyOfPatterns(CERTAINTY_MARKERS);
