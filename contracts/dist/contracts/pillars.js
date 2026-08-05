/**
 * Places, People, Plans, Progression.
 *
 * Canon: CEDRUS.md Part I §4 (LOCKED as the product system), §7 (trust law),
 * reboot plan §7 (working detail), §19 (what is deliberately absent).
 *
 * Each pillar carries the constraint that keeps it honest:
 *
 *   Places      — operator-curated only, and a place surfaces only attached to a
 *                 window. "Quality over coverage; ten places Emil would
 *                 personally send someone to beats four hundred rows."
 *   People      — no introductions in the founding release, double opt-in when
 *                 there are, no contact details in the projection, and a person
 *                 exists because someone said so.
 *   Plans       — one action, sized to the window. Never three things.
 *   Progression — counts derived from cited outcomes, no score, no streak, and
 *                 allowed to say nothing moved.
 */
import { arrayOf, boolean, defineContract, enumOf, inspect, issue, literal, nullable, object, optional, refine, string, } from "../schema/core.js";
import { countValidator, goalLane, id, instant, localTime, memberId, neighborhood, weekday } from "../common/primitives.js";
import { PERSON_ORIGINS, checkCountIsDerived, findContactDisclosure, findFabricatedProgress } from "../guards/fabrication.js";
// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------
export const PLACE_VERSION = 1;
export const PLACE_SUITABILITY = ['calls', 'deep_work', 'either'];
export const placeValidator = object({
    schema_version: literal(PLACE_VERSION),
    place_id: id('Place id.'),
    name: string({ minLength: 1, maxLength: 120 }),
    neighborhood: neighborhood(),
    /**
     * Founding release: a small hand-curated Miami set, operator-maintained, not a
     * scraped directory. A const, so a scraper cannot write rows into this table
     * and have them pass the contract.
     */
    origin: literal('operator_curated'),
    suitable_for: arrayOf(enumOf(PLACE_SUITABILITY), { minItems: 1, maxItems: 3 }),
    /** Hours as stated by the operator who curated it. Not scraped, not inferred. */
    typical_hours: arrayOf(object({
        weekday: weekday(),
        opens_at_local: localTime('Opens.'),
        closes_at_local: localTime('Closes.'),
    }), { maxItems: 7 }),
    operator_note: optional(string({ maxLength: 300, description: 'Why Emil would send someone here.' })),
    curated_at: instant('When an operator last checked it.'),
});
export const placeContract = defineContract({
    name: 'cedrus.place',
    version: PLACE_VERSION,
    title: 'Place',
    description: 'An operator-curated Miami place. Quality over coverage; not a scraped directory.',
    sources: ['CEDRUS.md I.4 Places', 'reboot plan §7 Places'],
}, placeValidator);
/**
 * A place as it is surfaced to a member. Reboot plan §7: "A place surfaces only
 * attached to a window." The window is required here, so a bare place list has
 * no way to reach a screen.
 */
export const placeSuggestionValidator = refine(object({
    schema_version: literal(PLACE_VERSION),
    place_ref: id('The curated place.'),
    member_id: memberId(),
    window: object({ starts_at: instant('From.'), ends_at: instant('Until.') }),
    /** Why this place, for this window. Labelled as an inference, because it is one. */
    rationale_statement_ref: id('The tagged statement carrying the reasoning.'),
}), {
    code: 'window/ends_before_starts',
    message: 'ends_at must be after starts_at',
    expressedInJsonSchema: false,
    predicate: (s) => Date.parse(s.window.ends_at) > Date.parse(s.window.starts_at),
});
export const placeSuggestionContract = defineContract({
    name: 'cedrus.place_suggestion',
    version: PLACE_VERSION,
    title: 'Place suggestion',
    description: 'A curated place attached to a specific window. A place cannot be surfaced without one.',
    sources: ['reboot plan §7 Places'],
}, placeSuggestionValidator);
// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export const PERSON_VERSION = 1;
/**
 * Introduction state. CEDRUS.md I.7 items 4 and 5: introductions are double
 * opt-in, and a blanket setting at signup is not consent to a specific person
 * months later. `introduced` therefore requires two consent refs, per
 * introduction.
 */
export const INTRODUCTION_STATES = ['none', 'requested', 'both_opted_in', 'declined'];
const personShape = object({
    schema_version: literal(PERSON_VERSION),
    person_id: id('Person id.'),
    member_id: memberId(),
    /** The name the member used. Not looked up, not enriched. */
    display_name: string({ minLength: 1, maxLength: 80 }),
    origin: enumOf(PERSON_ORIGINS, {
        code: 'fabrication/invented_person',
        message: `a person exists because someone said so; allowed origins are: ${PERSON_ORIGINS.join(', ')}`,
    }),
    relationship_text: optional(string({ maxLength: 120, description: "In the member's words." })),
    /** Founding release: no introductions. The default and the only shipped value is `none`. */
    introduction_state: enumOf(INTRODUCTION_STATES),
    /** Per introduction, both sides. Empty unless the state is both_opted_in. */
    introduction_consent_refs: arrayOf(id('A consent event for this specific introduction.'), { maxItems: 2 }),
    last_mentioned_at: nullable(instant('When the member last mentioned them.')),
    created_at: instant('Created.'),
});
export const personValidator = inspect(personShape, {
    expressedInJsonSchema: false,
    run: (person, path) => {
        const issues = [];
        if (person.introduction_state === 'both_opted_in' && person.introduction_consent_refs.length !== 2) {
            issues.push(issue(`${path}introduction_consent_refs`, 'people/introduction_not_double_opt_in', 'an introduction requires a consent event from each side, for this introduction'));
        }
        if (person.introduction_state !== 'both_opted_in' && person.introduction_consent_refs.length > 0) {
            issues.push(issue(`${path}introduction_consent_refs`, 'people/consent_without_introduction', 'consent refs may only exist on a completed double opt-in'));
        }
        /** No contact details in a person projection, at any depth. */
        issues.push(...findContactDisclosure(person, path));
        return issues;
    },
});
export const personContract = defineContract({
    name: 'cedrus.person',
    version: PERSON_VERSION,
    title: 'Person',
    description: "Someone the member told Cedrus about. Never invented, never enriched, never carrying contact details.",
    sources: ['CEDRUS.md I.4 People', 'CEDRUS.md I.7 items 4, 5, 8', 'reboot plan §7 People'],
}, personValidator);
// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
export const PLAN_VERSION = 1;
export const PLAN_KINDS = ['suggestion', 'prepared', 'help_scheduling'];
export const planValidator = refine(object({
    schema_version: literal(PLAN_VERSION),
    plan_id: id('Plan id.'),
    member_id: memberId(),
    goal_ref: id('The goal this plan serves.'),
    kind: enumOf(PLAN_KINDS),
    /** One action. "Never three things." The type is singular, not an array. */
    action_statement_ref: id('The proposed_action statement.'),
    window: object({ starts_at: instant('From.'), ends_at: instant('Until.') }),
    place_ref: nullable(id('A curated place, if the plan has one.')),
    person_refs: arrayOf(id('A member-stated person.'), { maxItems: 4 }),
    created_at: instant('Created.'),
}), {
    code: 'window/ends_before_starts',
    message: 'ends_at must be after starts_at',
    expressedInJsonSchema: false,
    predicate: (p) => Date.parse(p.window.ends_at) > Date.parse(p.window.starts_at),
});
export const planContract = defineContract({
    name: 'cedrus.plan',
    version: PLAN_VERSION,
    title: 'Plan',
    description: 'The next realistic action, sized to a window. One action, never three.',
    sources: ['CEDRUS.md I.4 Plans', 'reboot plan §7 Plans'],
}, planValidator);
// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------
export const PROGRESSION_VERSION = 1;
/**
 * Per goal: a plain record of suggestions made, actions taken, and outcomes
 * confirmed. Every number is a `Count`, so every number can name what it
 * counted. No score, no streak, no ring, no garden.
 */
const progressionLineShape = object({
    goal_ref: id('The goal.'),
    goal_stated_text: string({ minLength: 3, maxLength: 200, description: "Quoted back in the member's words." }),
    lane: nullable(goalLane()),
    cards_suggested: countValidator,
    outcomes_recorded: countValidator,
    confirmed_helped: countValidator,
    /**
     * The honest sentence. Allowed, and expected, to say nothing moved. Reboot
     * plan §10: "Allowed to say 'nothing moved on this one.' That honesty is the
     * feature."
     */
    summary_text: string({ minLength: 3, maxLength: 300 }),
});
const progressionShape = object({
    schema_version: literal(PROGRESSION_VERSION),
    member_id: memberId(),
    window: object({ starts_at: instant('From.'), ends_at: instant('Until.') }),
    lines: arrayOf(progressionLineShape, { maxItems: 3 }),
    /** A member with nothing to show is a valid state, and it says so. */
    nothing_moved: boolean(),
    computed_at: instant('When it was computed.'),
});
export const progressionValidator = inspect(progressionShape, {
    expressedInJsonSchema: false,
    run: (progression, path) => {
        const issues = [];
        for (let i = 0; i < progression.lines.length; i += 1) {
            const line = progression.lines[i];
            if (line === undefined)
                continue;
            const base = `${path}lines[${i}]`;
            issues.push(...checkCountIsDerived(line.cards_suggested, `${base}.cards_suggested`));
            issues.push(...checkCountIsDerived(line.outcomes_recorded, `${base}.outcomes_recorded`));
            issues.push(...checkCountIsDerived(line.confirmed_helped, `${base}.confirmed_helped`));
            /** You cannot have confirmed more help than you recorded outcomes. */
            if (line.confirmed_helped.value > line.outcomes_recorded.value) {
                issues.push(issue(`${base}.confirmed_helped`, 'fabrication/progress_exceeds_evidence', 'more confirmed-helped than recorded outcomes; progress may not exceed its evidence'));
            }
        }
        /** `nothing_moved` must agree with the counts it summarises. */
        const totalOutcomes = progression.lines.reduce((sum, line) => sum + line.outcomes_recorded.value, 0);
        if (progression.nothing_moved && totalOutcomes > 0) {
            issues.push(issue(`${path}nothing_moved`, 'fabrication/progress_contradicts_counts', 'nothing_moved contradicts recorded outcomes'));
        }
        if (!progression.nothing_moved && totalOutcomes === 0) {
            issues.push(issue(`${path}nothing_moved`, 'fabrication/progress_contradicts_counts', 'no outcomes were recorded, so the honest answer is nothing_moved'));
        }
        /** No score, streak, or engagement metric anywhere in the payload. */
        issues.push(...findFabricatedProgress(progression, path));
        return issues;
    },
});
export const progressionContract = defineContract({
    name: 'cedrus.progression',
    version: PROGRESSION_VERSION,
    title: 'Progression',
    description: 'Per goal: suggestions, outcomes and confirmed help, each counted from cited records. No score, no streak, and allowed to say nothing moved.',
    sources: ['CEDRUS.md I.4 Progression', 'CEDRUS.md I.7.3', 'reboot plan §7', 'reboot plan §10 /progress', 'reboot plan §19'],
}, progressionValidator);
