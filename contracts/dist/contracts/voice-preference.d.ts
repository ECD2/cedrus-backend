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
import { type Contract, type Infer, type Validator } from '../schema/core.ts';
export declare const VOICE_PREFERENCE_VERSION = 1;
export declare const TONE_PRESETS: readonly ["casual", "direct", "warm"];
export type TonePreset = (typeof TONE_PRESETS)[number];
/**
 * The registers a tone preference may touch. Safety, compliance, STOP and HELP
 * are absent by construction.
 */
export declare const TONE_APPLIES_TO: readonly ["assistant_replies", "pace_cards", "nudges"];
export declare const presetVoicePreferenceValidator: Validator<{
    schema_version: 1;
    member_id: string;
    mode: "preset";
    preset: "casual" | "direct" | "warm";
    applies_to: readonly ("assistant_replies" | "pace_cards" | "nudges")[];
    safety_register_fixed: true;
    updated_at: string;
}>;
export type PresetVoicePreference = Infer<typeof presetVoicePreferenceValidator>;
export declare const freeFormVoicePreferenceValidator: Validator<{
    schema_version: 1;
    member_id: string;
    mode: "free_form";
    instruction_text: string;
    applies_to: readonly ("assistant_replies" | "pace_cards" | "nudges")[];
    safety_register_fixed: true;
    updated_at: string;
}>;
export type FreeFormVoicePreference = Infer<typeof freeFormVoicePreferenceValidator>;
export type VoicePreference = PresetVoicePreference | FreeFormVoicePreference;
export declare const voicePreferenceValidator: Validator<VoicePreference>;
export declare const voicePreferenceContract: Contract<VoicePreference>;
