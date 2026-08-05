/**
 * Consent.
 *
 * Canon: CEDRUS.md Part I §15 "List ownership and consent" —
 *   - "Record consent at signup: timestamp, IP address, and the exact wording
 *     the person agreed to. This is the defensible record if a complaint ever
 *     arrives."
 *   - "SMS consent is a compliance requirement, not a preference. Twilio
 *     requires consent for A2P messaging to be affirmative, separate from
 *     general terms, and unchecked by default ... Bundled or preselected
 *     consent causes campaign rejection."
 *   - Reboot plan §18: "Consent is per purpose and recorded with its exact
 *     wording ... Connections join the same model."
 *   - Reboot plan §26: "Existing `consent_events` rows keep their original text
 *     and must not be rewritten — that is the point of storing the wording per
 *     row."
 *
 * Three things the contract makes mechanical:
 *   1. `exact_wording` is required and non-trivial. A consent record without the
 *      words is not a record.
 *   2. `bundled` is a const `false` and `preselected` is a const `false`. There
 *      is no legal value for either that permits the thing Twilio rejects.
 *   3. Consent is append-only: `superseded_by` may point forward, but the
 *      wording of an existing row can never be rewritten. `migrate/` asserts it.
 */

import {
  boolean,
  defineContract,
  enumOf,
  literal,
  nullable,
  object,
  optional,
  string,
  type Contract,
  type Infer,
} from '../schema/core.ts';
import { id, instant, memberId } from '../common/primitives.ts';

export const CONSENT_VERSION = 1;

/** Consent is per purpose. Email and SMS are separate events, never one checkbox. */
export const CONSENT_CHANNELS = ['email_marketing', 'email_transactional', 'sms_assistant', 'connection'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const consentEventValidator = object({
  schema_version: literal(CONSENT_VERSION),
  consent_id: id('Consent event id.'),
  /** Nullable: consent is captured at signup, before a member record may exist. */
  member_id: nullable(memberId()),
  contact_ref: id('The acquisition record this consent belongs to.'),

  channel: enumOf(CONSENT_CHANNELS),
  granted: boolean(),

  /**
   * The exact words the person agreed to, verbatim. 20 characters is not a
   * style rule; it is the shortest string that could plausibly be a consent
   * sentence, and it stops an empty or placeholder value being stored.
   */
  exact_wording: string({
    minLength: 20,
    maxLength: 2000,
    description: 'Verbatim wording the person agreed to. Never rewritten, ever, including by a migration.',
  }),

  /** Twilio A2P: affirmative, separate from general terms, unchecked by default. */
  bundled: literal(false),
  preselected: literal(false),

  occurred_at: instant('When consent was given or withdrawn. Note: the column is occurred_at, not created_at.'),
  ip_address: optional(string({ minLength: 3, maxLength: 45, description: 'Captured at signup for the audit trail.' })),
  user_agent: optional(string({ maxLength: 400 })),

  /** Append-only. A later event supersedes this one; it does not edit it. */
  superseded_by: nullable(id('A later consent event that supersedes this one.')),
});
export type ConsentEvent = Infer<typeof consentEventValidator>;

export const consentEventContract: Contract<ConsentEvent> = defineContract(
  {
    name: 'cedrus.consent_event',
    version: CONSENT_VERSION,
    title: 'Consent event',
    description:
      'One consent decision, per purpose, with the exact wording. Append-only: superseded, never rewritten.',
    sources: ['CEDRUS.md I.15 list ownership and consent', 'reboot plan §18', 'reboot plan §26'],
  },
  consentEventValidator,
);

/**
 * The current permission state, which is a projection of the append-only events
 * and never a substitute for them. Finding 10 in the reboot plan is exactly the
 * gap this closes: an unsubscribe that is recorded but unenforceable.
 */
export const permissionStateValidator = object({
  schema_version: literal(1),
  contact_ref: id('The acquisition record.'),
  email_marketing: boolean(),
  sms_assistant: boolean(),
  /** Suppression is permanent and separate from permission (CEDRUS.md I.15 rule 6). */
  suppressed: boolean(),
  suppression_reason: nullable(enumOf(['hard_bounce', 'complaint', 'manual'] as const)),
  derived_from_consent_ids: nullable(id('The latest consent event this state was derived from.')),
  computed_at: instant('When this projection was computed.'),
});
export type PermissionState = Infer<typeof permissionStateValidator>;

export const permissionStateContract: Contract<PermissionState> = defineContract(
  {
    name: 'cedrus.permission_state',
    version: 1,
    title: 'Permission state',
    description:
      'Current send permission, computed from consent events. Every broadcast filters against this, never against what a provider last knew.',
    sources: ['CEDRUS.md I.15 rules 1, 6, 7', 'reboot plan §22'],
  },
  permissionStateValidator,
);
