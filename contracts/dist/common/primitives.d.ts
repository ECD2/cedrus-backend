/**
 * Shared primitive shapes. Everything a Cedrus contract can hold is built from
 * these, so a rule written once (an id shape, a timestamp shape, a counted
 * value) holds everywhere.
 */
import { type Infer, type Validator } from '../schema/core.ts';
/** Opaque ids. Deliberately not UUID-only: the backend uses several id shapes. */
export declare const ID_PATTERN = "^[a-z][a-z0-9_]{1,31}:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$";
export declare const id: (description: string) => Validator<string>;
export declare const memberId: () => Validator<string>;
/** ISO-8601 instant in UTC. Local wall time is a different type, on purpose. */
export declare const ISO_INSTANT_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$";
export declare const instant: (description: string) => Validator<string>;
export declare const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
export declare const localDate: (description: string) => Validator<string>;
export declare const LOCAL_TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";
export declare const localTime: (description: string) => Validator<string>;
/**
 * Digits-only phone, matching `app_users.phone` (`normalizePhone`). The reboot
 * plan (§15) is explicit that this format must not be loosened to E.164,
 * because it is matched against Twilio's `From` on every inbound message.
 */
export declare const PHONE_DIGITS_PATTERN = "^[1-9]\\d{9,14}$";
export declare const phoneDigits: () => Validator<string>;
export declare const TIMEZONE_PATTERN = "^[A-Za-z]+/[A-Za-z_+-]+$";
export declare const timezone: () => Validator<string>;
export declare const GOAL_LANES: readonly ["work", "people", "body"];
export declare const goalLane: () => Validator<(typeof GOAL_LANES)[number]>;
export declare const NEIGHBORHOODS: readonly ["brickell", "wynwood", "little_havana", "edgewater", "coconut_grove", "downtown", "miami_beach", "coral_gables", "design_district", "key_biscayne", "other_miami_dade"];
export declare const neighborhood: () => Validator<(typeof NEIGHBORHOODS)[number]>;
export declare const WORK_SETUPS: readonly ["fully_remote", "hybrid", "flexible_other"];
export declare const WEEKDAYS: readonly ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export declare const weekday: () => Validator<(typeof WEEKDAYS)[number]>;
/**
 * The five narrow assistant jobs. Anything outside these is out of scope and
 * must be answered honestly and logged (CEDRUS.md Part I §6.4, §15).
 *
 * RE-DERIVED AT VENDOR TIME (2026-08-05) from reboot canon §6.4, per catalog
 * item 14. The lab was built against the pre-reboot list, which §6.4 has since
 * changed:
 *
 *   dropped  find_local_activity        §6.4: "Removed from this list
 *                                        2026-08-04: 'find Cedrus workdays and
 *                                        local activity' as a named reliable
 *                                        job." There is no recurring hosted
 *                                        workday to find.
 *   dropped  answer_calendar_of_events  §6.4: the fifth job added by §15 is
 *                                        removed with the event sequence.
 *   dropped  connect_with_member        Not in §6.4's list at all, and §4 is
 *                                        explicit that "Cedrus does not
 *                                        introduce anyone to anyone in the
 *                                        founding release." A named reliable
 *                                        job the product refuses to do is a
 *                                        promise it cannot keep.
 *   kept     find_somewhere_to_work
 *   kept     make_or_schedule_plan      §6.4 "help make or schedule a simple plan"
 *   added    suggest_for_open_window    §6.4 "suggest what to do with an open window"
 *   added    record_what_happened       §6.4 "record what actually happened"
 *   added    answer_goal_or_progress    §6.4 "answer questions about the user's
 *                                        own goals and progress"
 *
 * A dropped job does not become unanswerable. It becomes out of scope, which
 * means an honest answer and a logged request, which is what the out-of-scope
 * log is for.
 */
export declare const ASSISTANT_JOBS: readonly ["find_somewhere_to_work", "suggest_for_open_window", "make_or_schedule_plan", "record_what_happened", "answer_goal_or_progress"];
export declare const assistantJob: () => Validator<(typeof ASSISTANT_JOBS)[number]>;
/**
 * A count that cannot be fabricated.
 *
 * Trust law 3: "No fabricated activity counts, ever. If three people are going,
 * it says three." A bare `number` cannot honour that, because nothing in a bare
 * number says where it came from. Every count in Cedrus therefore carries the
 * refs it was derived from, and `guards/fabrication.ts` checks that the value
 * equals the number of refs.
 */
export declare const COUNT_BASES: readonly ["observed_rows", "operator_verified"];
export declare const countValidator: Validator<{
    value: number;
    basis: "observed_rows" | "operator_verified";
    source_refs: readonly string[];
}>;
export type Count = Infer<typeof countValidator>;
/**
 * Where a claim came from. Split into verifiable sources and inference, because
 * the split is the whole point: `guards/provenance.ts` refuses to let an
 * inference source back a `known` statement.
 */
export declare const VERIFIABLE_SOURCE_TYPES: readonly ["calendar_freebusy", "member_stated", "operator_entered", "system_record"];
export declare const SELF_REPORT_SOURCE_TYPES: readonly ["member_sms", "member_tap", "operator_entered"];
export declare const INFERENCE_SOURCE_TYPES: readonly ["model_inference", "heuristic", "statistical_prior"];
export declare const ALL_SOURCE_TYPES: readonly ["calendar_freebusy", "member_stated", "operator_entered", "system_record", ...("operator_entered" | "member_sms" | "member_tap")[], "model_inference", "heuristic", "statistical_prior"];
export declare const sourceRef: (allowed: readonly string[]) => Validator<{
    type: string;
    ref: string;
}>;
export declare const windowValidator: Validator<{
    starts_at: string;
    ends_at: string;
}>;
export type TimeWindow = Infer<typeof windowValidator>;
export declare const durationMinutes: () => Validator<number>;
/**
 * Every contract payload carries its own version. Version-in-the-payload is
 * what makes `migrate/` possible without a side channel, and what makes an
 * import envelope from six months ago readable.
 */
export declare const schemaVersionField: (version: number) => Validator<number>;
export declare const optionalNote: () => Validator<string | undefined>;
