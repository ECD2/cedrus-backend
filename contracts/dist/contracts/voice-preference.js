/**
 * Voice preference.
 *
 * Canon: CEDRUS.md Part I §6.4 — "Configurable tone (LOCKED as intent, TEST as
 * implementation). The intent is free form ... The week two implementation is
 * three presets to produce evidence quickly. Free form is the destination, not
 * the presets."
 *
 * And the rule that is not a preference: "Compliance and safety responses are
 * never tone shifted. STOP, HELP, and anything touching a person in distress
 * stay in a fixed register regardless of setting."
 *
 * The contract encodes that by making `applies_to` a closed set that does not
 * contain the safety registers at all, plus a const acknowledging the exclusion.
 * A surface cannot opt a member's tone into a STOP reply, because there is no
 * value it could put in the field.
 */
import { arrayOf, defineContract, discriminatedUnion, enumOf, literal, object, string, } from "../schema/core.js";
import { instant, memberId } from "../common/primitives.js";
export const VOICE_PREFERENCE_VERSION = 1;
export const TONE_PRESETS = ['casual', 'direct', 'warm'];
/**
 * The registers a tone preference may touch. Safety, compliance, STOP and HELP
 * are absent by construction.
 */
export const TONE_APPLIES_TO = ['assistant_replies', 'pace_cards', 'nudges'];
const appliesTo = () => arrayOf(enumOf(TONE_APPLIES_TO), {
    minItems: 1,
    maxItems: TONE_APPLIES_TO.length,
    description: 'Registers the tone applies to. Safety and compliance registers are not members of this set.',
});
export const presetVoicePreferenceValidator = object({
    schema_version: literal(VOICE_PREFERENCE_VERSION),
    member_id: memberId(),
    mode: literal('preset'),
    preset: enumOf(TONE_PRESETS),
    applies_to: appliesTo(),
    /** The exclusion, restated as data so a consumer can assert on it. */
    safety_register_fixed: literal(true),
    updated_at: instant('Updated.'),
});
export const freeFormVoicePreferenceValidator = object({
    schema_version: literal(VOICE_PREFERENCE_VERSION),
    member_id: memberId(),
    mode: literal('free_form'),
    /** The member's own words about how Cedrus should talk to them. */
    instruction_text: string({ minLength: 3, maxLength: 300, description: "How to talk to me, in the member's words." }),
    applies_to: appliesTo(),
    safety_register_fixed: literal(true),
    updated_at: instant('Updated.'),
});
export const voicePreferenceValidator = discriminatedUnion('mode', [
    { tag: 'preset', validator: presetVoicePreferenceValidator },
    { tag: 'free_form', validator: freeFormVoicePreferenceValidator },
]);
export const voicePreferenceContract = defineContract({
    name: 'cedrus.voice_preference',
    version: VOICE_PREFERENCE_VERSION,
    title: 'Voice preference',
    description: 'How Cedrus talks to a member. Presets now, free form as the destination. Safety and compliance registers are outside its reach.',
    sources: ['CEDRUS.md I.6.4', 'CEDRUS.md I.10 week 2'],
}, voicePreferenceValidator);
