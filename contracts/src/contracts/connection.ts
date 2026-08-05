/**
 * Connector authorization.
 *
 * Canon: reboot plan §16 (authorization flow), §17 (data boundaries), §18
 * (least privilege), §19 (`connections`, `connection_tokens`), §27 risk 13
 * (scope creep is a trust promise, not a feature flag).
 *
 * The rule the work pack asks for: reject a connector authorization without a
 * named outcome and a narrow purpose. Enforced four ways, in
 * `guards/authorization.ts` and wired here:
 *
 *   1. `scopes` is a closed allowlist containing exactly the free/busy scope.
 *   2. `purpose` is one entry from a closed set, with a stated sentence.
 *   3. `named_outcome` is required, from a closed set, and may not be vague.
 *   4. every scope must be justified by the declared purpose.
 *
 * Plus the storage promises, as consts a code path cannot weaken:
 * `token_storage: 'server_only'`, `revocable: true`, `writes_to_provider: false`.
 */

import {
  arrayOf,
  boolean,
  defineContract,
  enumOf,
  inspect,
  literal,
  nullable,
  object,
  optional,
  string,
  type Contract,
  type Infer,
} from '../schema/core.ts';
import { id, instant, memberId } from '../common/primitives.ts';
import {
  ALLOWED_SCOPES,
  AUTHORIZATION_PURPOSES,
  NAMED_OUTCOMES,
  VAGUE_OUTCOME_PHRASES,
  checkScopesJustified,
} from '../guards/authorization.ts';
import { matchesAnyWord, refine } from '../schema/core.ts';
import { notAnyOfPatterns } from '../schema/core.ts';

export const CONNECTION_VERSION = 2;

export const CONNECTION_PROVIDERS = ['google_calendar'] as const;

/**
 * Connection status. `half_connected` is deliberately absent: reboot plan §16
 * item 7, "Half-connected is not a state that exists."
 */
/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 6.
 *
 * `disconnected` added. A member turning a connection off and a provider
 * revoking a token are different events with different obligations: the member
 * chose it and expects the derived data gone, the provider did it to us and the
 * member may not know yet. Recording both as `revoked` erases the distinction
 * that trust law item 10 and connector doctrine rule 10 rest on.
 *
 * `half_connected` stays deliberately absent, unchanged from the lab.
 *
 * Lab original: `['authorized', 'expired', 'revoked', 'failed']`.
 */
export const CONNECTION_STATUSES = ['authorized', 'expired', 'revoked', 'disconnected', 'failed'] as const;

const outcomeStatement = () =>
  refine(string({ minLength: 20, maxLength: 300, description: 'What the member gets, in checkable words.' }), {
    code: 'authorization/outcome_vague',
    message: `a named outcome may not be generic (${VAGUE_OUTCOME_PHRASES.join(', ')})`,
    expressedInJsonSchema: true,
    schema: notAnyOfPatterns(VAGUE_OUTCOME_PHRASES),
    predicate: (text) => matchesAnyWord(text, VAGUE_OUTCOME_PHRASES) === null,
  });

export const connectionAuthorizationValidator = inspect(
  object({
    schema_version: literal(CONNECTION_VERSION),
    connection_id: id('Connection id.'),
    member_id: memberId(),
    provider: enumOf(CONNECTION_PROVIDERS),

    /** 1. Closed allowlist. Widening it is Emil's decision, not a code review's. */
    scopes: arrayOf(
      enumOf(ALLOWED_SCOPES, {
        code: 'authorization/scope_not_allowed',
        message: `scope is wider than free/busy; allowed scopes are: ${ALLOWED_SCOPES.join(', ')}`,
      }),
      { minItems: 1, maxItems: ALLOWED_SCOPES.length },
    ),

    /** 2. Exactly one purpose, from a closed set, stated in words. */
    purpose: object({
      code: enumOf(AUTHORIZATION_PURPOSES, {
        code: 'authorization/purpose_not_narrow',
        message: `purpose must be one of: ${AUTHORIZATION_PURPOSES.join(', ')}`,
      }),
      statement: string({ minLength: 20, maxLength: 300, description: 'The purpose, as shown on the pre-consent screen.' }),
    }),

    /** 3. A named outcome the member receives. */
    named_outcome: object({
      code: enumOf(NAMED_OUTCOMES, {
        code: 'authorization/outcome_not_named',
        message: `named outcome must be one of: ${NAMED_OUTCOMES.join(', ')}`,
      }),
      statement: outcomeStatement(),
    }),

    /** The pre-consent screen, as data. All four lines are required. */
    disclosure: object({
      reads: string({ minLength: 10, maxLength: 300 }),
      does_not_read: string({ minLength: 10, maxLength: 300 }),
      will_do: string({ minLength: 10, maxLength: 300 }),
      does_not_do: string({ minLength: 10, maxLength: 300 }),
    }),

    /** Consent is per purpose and recorded with its exact wording (reboot plan §18). */
    consent_ref: id('The consent event recording this authorization.'),

    status: enumOf(CONNECTION_STATUSES),
    authorized_at: instant('When the member authorized.'),
    last_sync_at: nullable(instant('Last successful free/busy read.')),
    revoked_at: nullable(instant('When it was revoked.')),

    /** Storage and behaviour promises, as consts. */
    token_storage: literal('server_only'),
    revocable: literal(true),
    writes_to_provider: literal(false),
    /** Reboot plan §16 item 5: the callback validates state before doing anything else. */
    state_validated: boolean(),
  }),
  {
    /**
     * 4. Cross-field: each scope must be justified by the declared purpose.
     * JSON Schema could express this as a conditional per purpose, but the
     * mapping is data and would drift; the agreement test records the gap.
     */
    expressedInJsonSchema: false,
    run: (auth, path) => checkScopesJustified(auth, path === '' ? '' : path.replace(/\.$/, '')),
  },
);
export type ConnectionAuthorization = Infer<typeof connectionAuthorizationValidator>;

export const connectionAuthorizationContract: Contract<ConnectionAuthorization> = defineContract(
  {
    name: 'cedrus.connection_authorization',
    version: CONNECTION_VERSION,
    title: 'Connector authorization',
    description:
      'One authorized connection. Requires a named outcome, one narrow purpose, and a scope allowlist that only covers free/busy.',
    sources: ['reboot plan §16', 'reboot plan §17', 'reboot plan §18', 'reboot plan §19', 'reboot plan §27 risk 13'],
  },
  connectionAuthorizationValidator,
);

/**
 * v1: what a pre-reboot connection row looked like. A single `scope` string, no
 * purpose, no named outcome. It exists so the migration has something honest to
 * fail on: v1 cannot be upgraded automatically, because the missing fields are
 * a member's decision and inventing them would be the fabrication this whole
 * package is built to prevent.
 */
export const connectionAuthorizationV1Validator = object({
  schema_version: literal(1),
  connection_id: id('Connection id.'),
  member_id: memberId(),
  provider: enumOf(CONNECTION_PROVIDERS),
  scope: string({ minLength: 3, maxLength: 200, description: 'Single scope string, pre-reboot shape.' }),
  status: enumOf(CONNECTION_STATUSES),
  authorized_at: instant('When the member authorized.'),
  last_sync_at: nullable(instant('Last sync.')),
  revoked_at: nullable(instant('Revoked at.')),
  consent_ref: optional(id('Consent event, if one was recorded.')),
});
export type ConnectionAuthorizationV1 = Infer<typeof connectionAuthorizationV1Validator>;
