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
import { type Contract, type Infer } from '../schema/core.ts';
export declare const PLACE_VERSION = 1;
export declare const PLACE_SUITABILITY: readonly ["calls", "deep_work", "either"];
export declare const placeValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    place_id: string;
    name: string;
    neighborhood: "brickell" | "wynwood" | "little_havana" | "edgewater" | "coconut_grove" | "downtown" | "miami_beach" | "coral_gables" | "design_district" | "key_biscayne" | "other_miami_dade";
    origin: "operator_curated";
    suitable_for: readonly ("calls" | "deep_work" | "either")[];
    typical_hours: readonly {
        weekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
        opens_at_local: string;
        closes_at_local: string;
    }[];
    curated_at: string;
    operator_note?: string;
}>;
export type Place = Infer<typeof placeValidator>;
export declare const placeContract: Contract<Place>;
/**
 * A place as it is surfaced to a member. Reboot plan §7: "A place surfaces only
 * attached to a window." The window is required here, so a bare place list has
 * no way to reach a screen.
 */
export declare const placeSuggestionValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    place_ref: string;
    member_id: string;
    window: {
        starts_at: string;
        ends_at: string;
    };
    rationale_statement_ref: string;
}>;
export type PlaceSuggestion = Infer<typeof placeSuggestionValidator>;
export declare const placeSuggestionContract: Contract<PlaceSuggestion>;
export declare const PERSON_VERSION = 1;
/**
 * Introduction state. CEDRUS.md I.7 items 4 and 5: introductions are double
 * opt-in, and a blanket setting at signup is not consent to a specific person
 * months later. `introduced` therefore requires two consent refs, per
 * introduction.
 */
export declare const INTRODUCTION_STATES: readonly ["none", "requested", "both_opted_in", "declined"];
export declare const personValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    person_id: string;
    member_id: string;
    display_name: string;
    origin: "member_stated" | "operator_entered";
    introduction_state: "none" | "requested" | "both_opted_in" | "declined";
    introduction_consent_refs: readonly string[];
    last_mentioned_at: string | null;
    created_at: string;
    relationship_text?: string;
}>;
export type Person = Infer<typeof personValidator>;
export declare const personContract: Contract<Person>;
export declare const PLAN_VERSION = 1;
export declare const PLAN_KINDS: readonly ["suggestion", "prepared", "help_scheduling"];
export declare const planValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    plan_id: string;
    member_id: string;
    goal_ref: string;
    kind: "suggestion" | "prepared" | "help_scheduling";
    action_statement_ref: string;
    window: {
        starts_at: string;
        ends_at: string;
    };
    place_ref: string | null;
    person_refs: readonly string[];
    created_at: string;
}>;
export type Plan = Infer<typeof planValidator>;
export declare const planContract: Contract<Plan>;
export declare const PROGRESSION_VERSION = 1;
export declare const progressionValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    member_id: string;
    window: {
        starts_at: string;
        ends_at: string;
    };
    lines: readonly {
        goal_ref: string;
        goal_stated_text: string;
        lane: "work" | "people" | "body" | null;
        cards_suggested: {
            value: number;
            basis: "observed_rows" | "operator_verified";
            source_refs: readonly string[];
        };
        outcomes_recorded: {
            value: number;
            basis: "observed_rows" | "operator_verified";
            source_refs: readonly string[];
        };
        confirmed_helped: {
            value: number;
            basis: "observed_rows" | "operator_verified";
            source_refs: readonly string[];
        };
        summary_text: string;
    }[];
    nothing_moved: boolean;
    computed_at: string;
}>;
export type Progression = Infer<typeof progressionValidator>;
export declare const progressionContract: Contract<Progression>;
