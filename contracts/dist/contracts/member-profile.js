/**
 * Member profile.
 *
 * Canon: CEDRUS.md Part I §6.2 (fast member profile: only name and phone are
 * required, every screen one tap or one short answer) and reboot plan §10
 * (`/onboarding`: seven steps, each skippable except phone verification; the
 * name is asked explicitly in its own step, because inferring it from an open
 * reply once wrote "Had" from "Had dinner with...").
 */
import { arrayOf, boolean, defineContract, enumOf, literal, nullable, object, optional, refine, string, } from "../schema/core.js";
import { WORK_SETUPS, id, instant, memberId, neighborhood, phoneDigits, timezone, weekday, localTime } from "../common/primitives.js";
export const MEMBER_PROFILE_VERSION = 2;
export const ONBOARDING_STEPS = [
    'name',
    'work_setup',
    'neighborhood',
    'free_windows',
    'activities',
    'current_groups',
    'people',
    'social_prefs',
];
/**
 * A stated free window. This is what makes Today work before Calendar
 * (reboot plan §11), and it is a member-stated fact, never a known one about
 * a specific day.
 */
export const statedWindowValidator = refine(object({
    weekday: weekday(),
    starts_at_local: localTime('Local start, member timezone.'),
    ends_at_local: localTime('Local end, member timezone.'),
}), {
    code: 'window/ends_before_starts',
    message: 'ends_at_local must be after starts_at_local',
    expressedInJsonSchema: false,
    predicate: (w) => w.ends_at_local > w.starts_at_local,
});
export const memberProfileValidator = object({
    schema_version: literal(MEMBER_PROFILE_VERSION),
    member_id: memberId(),
    /** Required. Asked in its own step, never inferred from an open reply. */
    display_name: string({ minLength: 1, maxLength: 80, description: 'Name as the member typed it.' }),
    name_source: literal('member_entered'),
    /** Required. Phone verification is the identity event (reboot plan §15). */
    phone: phoneDigits(),
    phone_verified_at: nullable(instant('When the phone was verified.')),
    email: optional(string({ maxLength: 254, format: 'email', description: 'Optional. Email is not identity.' })),
    timezone: timezone(),
    /** Everything below is skippable. Absent means "not asked yet", never a default. */
    work_setup: optional(enumOf(WORK_SETUPS)),
    neighborhood: optional(neighborhood()),
    stated_free_windows: optional(arrayOf(statedWindowValidator, { maxItems: 21 })),
    activities: optional(arrayOf(string({ minLength: 1, maxLength: 60 }), { maxItems: 12 })),
    current_groups: optional(arrayOf(string({ minLength: 1, maxLength: 80 }), { maxItems: 12 })),
    /**
     * CEDRUS.md I.7 item 7: members control whether they can be recommended and
     * can turn it off at any time. Default is off, and the contract says so by
     * requiring the field rather than allowing it to be absent.
     */
    open_to_introductions: boolean(),
    recommendable: boolean(),
    onboarding_completed_steps: arrayOf(enumOf(ONBOARDING_STEPS), { maxItems: ONBOARDING_STEPS.length }),
    onboarding_completed_at: nullable(instant('When onboarding finished, if it did.')),
    created_at: instant('Record creation.'),
    updated_at: instant('Last update.'),
});
export const memberProfileContract = defineContract({
    name: 'cedrus.member_profile',
    version: MEMBER_PROFILE_VERSION,
    title: 'Member profile',
    description: 'The fast profile. Only name and phone are required; everything else is skippable and absent means not asked.',
    sources: ['CEDRUS.md I.6.2', 'CEDRUS.md I.7.7', 'reboot plan §10 /onboarding', 'reboot plan §15'],
}, memberProfileValidator);
/** v1 of the profile, kept so the migration in `migrate/` has something real to read. */
export const memberProfileV1Validator = object({
    schema_version: literal(1),
    member_id: memberId(),
    display_name: string({ minLength: 1, maxLength: 80 }),
    phone: phoneDigits(),
    phone_verified_at: nullable(instant('When the phone was verified.')),
    email: optional(string({ maxLength: 254, format: 'email' })),
    timezone: timezone(),
    work_setup: optional(enumOf(WORK_SETUPS)),
    neighborhood: optional(neighborhood()),
    interests: optional(arrayOf(string({ minLength: 1, maxLength: 60 }), { maxItems: 12 })),
    open_to_introductions: boolean(),
    created_at: instant('Record creation.'),
    updated_at: instant('Last update.'),
    legacy_ref: optional(id('Pre-reboot record reference.')),
});
