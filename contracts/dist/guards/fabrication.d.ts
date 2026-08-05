/**
 * Guard: no fabricated people, counts, or progress.
 *
 * Canon:
 *   - CEDRUS.md Part I §7 item 3: "No fabricated activity counts, ever. If three
 *     people are going, it says three."
 *   - CEDRUS.md Part I §4: Progression "explicitly does not count: opening
 *     Cedrus, completing tasks, app streaks, messages sent, or arbitrary
 *     wellness goals."
 *   - Reboot plan §8: "Unfinished is labelled, never mocked. No placeholder
 *     data, ever (this is a trust-law adjacent rule: fabricated content and
 *     fabricated counts are the same failure)."
 *   - Reboot plan §13: "No streaks and no scores derived from it ... an inferred
 *     score is a fabricated count wearing a chart."
 *   - Reboot plan §19: "What is deliberately absent: any score, streak, points,
 *     level, or health metric."
 *
 * Three checks:
 *   1. COUNTS   — a count's value must equal the number of records it cites.
 *   2. SCORES   — no score, streak, points, level, rank, or wellness metric may
 *                 appear anywhere in a progression payload.
 *   3. PEOPLE   — a person may only exist because the member or the operator
 *                 said so, and a person projection may not carry contact
 *                 details.
 */
import { type Issue } from '../schema/core.ts';
export interface CountLike {
    readonly value: number;
    readonly basis: string;
    readonly source_refs: readonly string[];
}
/**
 * Check 1. A count must be able to name every thing it counted.
 *
 * This is the mechanical form of "if three people are going, it says three":
 * a `value` of 3 needs 3 refs. A count with a value and no refs is the exact
 * shape of a fabricated count, and it is rejected.
 */
export declare const checkCountIsDerived: (count: CountLike, path: string) => readonly Issue[];
/**
 * Field names banned from progression and from anything a member is shown as
 * "how it is going". Normalised the same way as the calendar guard.
 */
export declare const FORBIDDEN_PROGRESS_FIELDS: readonly ["score", "streak", "streaks", "points", "level", "rank", "xp", "badge", "badges", "healthscore", "wellnessscore", "consistencyscore", "grade", "percentcomplete", "completionrate", "multiplier", "combo"];
/**
 * Metrics Cedrus refuses to count even when they are real, because counting
 * them makes the product about itself (CEDRUS.md Part I §4).
 */
export declare const FORBIDDEN_ENGAGEMENT_FIELDS: readonly ["appopens", "opens", "sessions", "pageviews", "messagessent", "taskscompleted", "loginstreak", "timeinapp"];
/** Check 2. No score, streak, or engagement metric anywhere in the payload. */
export declare const findFabricatedProgress: (payload: unknown, path?: string) => readonly Issue[];
/**
 * Check 3a. Origins a person record may have. A person exists because someone
 * said so. `model_inference` and `generated` are not origins.
 */
export declare const PERSON_ORIGINS: readonly ["member_stated", "operator_entered"];
export declare const checkPersonOrigin: (origin: string, path: string) => readonly Issue[];
/**
 * Check 3b. Contact details never appear in a people projection.
 * CEDRUS.md Part I §7 item 5: phone numbers are not revealed before both people
 * consent, per introduction. The safe form is that the projection has no field
 * that could carry one.
 */
export declare const FORBIDDEN_CONTACT_FIELDS: readonly ["phone", "phonee164", "phonenumber", "mobile", "email", "emailaddress", "instagram", "handle", "address", "homeaddress"];
export declare const findContactDisclosure: (payload: unknown, path?: string) => readonly Issue[];
export declare const forbiddenProgressPropertyNamesSchema: () => {
    [key: string]: unknown;
};
