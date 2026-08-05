/**
 * Member profile.
 *
 * Canon: CEDRUS.md Part I §6.2 (fast member profile: only name and phone are
 * required, every screen one tap or one short answer) and reboot plan §10
 * (`/onboarding`: seven steps, each skippable except phone verification; the
 * name is asked explicitly in its own step, because inferring it from an open
 * reply once wrote "Had" from "Had dinner with...").
 */
import { type Contract, type Infer } from '../schema/core.ts';
export declare const MEMBER_PROFILE_VERSION = 2;
export declare const ONBOARDING_STEPS: readonly ["name", "work_setup", "neighborhood", "free_windows", "activities", "current_groups", "people", "social_prefs"];
/**
 * A stated free window. This is what makes Today work before Calendar
 * (reboot plan §11), and it is a member-stated fact, never a known one about
 * a specific day.
 */
export declare const statedWindowValidator: import("../schema/core.ts").Validator<{
    weekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
    starts_at_local: string;
    ends_at_local: string;
}>;
export type StatedWindow = Infer<typeof statedWindowValidator>;
export declare const memberProfileValidator: import("../schema/core.ts").Validator<{
    schema_version: 2;
    member_id: string;
    display_name: string;
    name_source: "member_entered";
    phone: string;
    phone_verified_at: string | null;
    timezone: string;
    open_to_introductions: boolean;
    recommendable: boolean;
    onboarding_completed_steps: readonly ("people" | "name" | "work_setup" | "neighborhood" | "free_windows" | "activities" | "current_groups" | "social_prefs")[];
    onboarding_completed_at: string | null;
    created_at: string;
    updated_at: string;
    email?: string;
    work_setup?: "fully_remote" | "hybrid" | "flexible_other";
    neighborhood?: "brickell" | "wynwood" | "little_havana" | "edgewater" | "coconut_grove" | "downtown" | "miami_beach" | "coral_gables" | "design_district" | "key_biscayne" | "other_miami_dade";
    stated_free_windows?: readonly {
        weekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
        starts_at_local: string;
        ends_at_local: string;
    }[];
    activities?: readonly string[];
    current_groups?: readonly string[];
}>;
export type MemberProfile = Infer<typeof memberProfileValidator>;
export declare const memberProfileContract: Contract<MemberProfile>;
/** v1 of the profile, kept so the migration in `migrate/` has something real to read. */
export declare const memberProfileV1Validator: import("../schema/core.ts").Validator<{
    schema_version: 1;
    member_id: string;
    display_name: string;
    phone: string;
    phone_verified_at: string | null;
    timezone: string;
    open_to_introductions: boolean;
    created_at: string;
    updated_at: string;
    email?: string;
    work_setup?: "fully_remote" | "hybrid" | "flexible_other";
    neighborhood?: "brickell" | "wynwood" | "little_havana" | "edgewater" | "coconut_grove" | "downtown" | "miami_beach" | "coral_gables" | "design_district" | "key_biscayne" | "other_miami_dade";
    interests?: readonly string[];
    legacy_ref?: string;
}>;
export type MemberProfileV1 = Infer<typeof memberProfileV1Validator>;
