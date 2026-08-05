/**
 * Today state.
 *
 * Canon: CEDRUS.md Part I §6.3, reboot plan §10 (`/today`), §11 (Today before
 * Calendar), §12 (Today after Calendar), §8 ("Unfinished is labelled, never
 * mocked ... No placeholder data, ever").
 *
 * The rule this contract exists to make mechanical:
 *
 *   "Always says which one it is." Zone 1 of Today is the state of the day, and
 *   it is either derived from stated schedule (an inference) or from a live
 *   calendar projection (a known fact). Reboot plan §12: "'Usually open' becomes
 *   'open.' Inference becomes known fact, and the label changes with it."
 *
 * So: when `timing_basis` is `stated`, the day line must be an `inferred`
 * statement. It cannot be `known`. That is the single most likely place in the
 * product for an inference to be presented as a known fact, and it is a type
 * error here.
 *
 * And the degradation rule (reboot plan §12, Lesson 7): when the connection is
 * stale, revoked, or absent, Today falls back and *says so*. `fallback_notice`
 * is required in that state, which is what distinguishes "checked and fine"
 * from "did not run".
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const TODAY_VERSION = 1;
export declare const TIMING_BASES: readonly ["stated", "calendar"];
export declare const todayStateValidator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    member_id: string;
    for_date: string;
    timing_basis: "calendar" | "stated";
    day_line: import("./statement.ts").Statement;
    fallback_notice: "using_your_usual_windows" | "calendar_disconnected" | "calendar_stale" | null;
    card: {
        schema_version: 1;
        card_id: string;
        member_id: string;
        goal_ref: string;
        for_date: string;
        parts: readonly import("./statement.ts").Statement[];
        window: {
            starts_at: string;
            ends_at: string;
        };
        status: "draft" | "approved" | "edited" | "killed" | "delivered";
        review_ref: string | null;
        created_at: string;
        delivered_at: string | null;
        delivered_via: "web" | "sms" | null;
        voice_ref?: string;
    } | null;
    goals: readonly {
        goal_ref: string;
        stated_text: string;
        status_statement: import("./statement.ts").Statement;
        can_report_outcome: boolean;
    }[];
    empty_state: {
        known_so_far: readonly string[];
        waiting_for: readonly string[];
        shows_example_card: false;
    } | null;
    sms_handoff: {
        cedrus_number: string;
        prefilled_text?: string;
    };
    computed_at: string;
}>;
export type TodayState = Infer<typeof todayStateValidator>;
export declare const todayStateContract: Contract<TodayState>;
/**
 * The pace card as Today renders it. Kept as a named re-export so a surface can
 * depend on the card contract without importing the whole Today shape.
 */
export { paceCardContract } from './pace-card.ts';
