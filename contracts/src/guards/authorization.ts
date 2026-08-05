/**
 * Guard: a connector authorization needs a named outcome and a narrow purpose.
 *
 * Canon:
 *   - Reboot plan §10 (`/settings/connections`): "an informed yes or no, and a
 *     reversible one" — what Cedrus will read, what it will not read, what it
 *     will do with it, what it does not do.
 *   - Reboot plan §16: "Request the narrowest calendar scope that returns
 *     free/busy and no more."
 *   - Reboot plan §18: "Nothing is collected without a shipped feature consuming
 *     it. If no screen and no card reads a field, it is not stored." and
 *     "Consent is per purpose and recorded with its exact wording."
 *   - Reboot plan §27 risk 13: "Calendar scope creep ... Widening the scope
 *     requires Emil."
 *
 * Four checks:
 *   1. SCOPE      — every requested scope must be on the allowlist.
 *   2. PURPOSE    — exactly one purpose, from a closed set, stated in words.
 *   3. OUTCOME    — a named outcome the member receives, and not a generic one.
 *   4. NARROWNESS — every requested scope must be justified by the purpose. A
 *                   scope nothing consumes is scope creep with a form filled in.
 */

import { issue, matchesAnyWord, type Issue } from '../schema/core.ts';

/**
 * The only scopes Cedrus v0 may request. Widening this list is Emil's decision,
 * not a code review's, so the list itself is the gate.
 */
export const ALLOWED_SCOPES = ['calendar.freebusy.read'] as const;
export type AllowedScope = (typeof ALLOWED_SCOPES)[number];

/** Purposes a connection may serve. One connection, one purpose. */
export const AUTHORIZATION_PURPOSES = ['place_suggestions_in_open_time'] as const;
export type AuthorizationPurpose = (typeof AUTHORIZATION_PURPOSES)[number];

/**
 * What the member gets. Named, singular, and in the product's own terms. This is
 * the "what it will do with it" line from the pre-consent screen, as data.
 */
export const NAMED_OUTCOMES = [
  'suggestions_land_in_time_you_actually_have',
  'today_stops_guessing_at_your_timing',
] as const;
export type NamedOutcome = (typeof NAMED_OUTCOMES)[number];

/**
 * Which scopes each purpose can justify. A scope not listed under the declared
 * purpose is unjustified, and unjustified is rejected.
 */
export const SCOPES_JUSTIFIED_BY_PURPOSE: Readonly<Record<AuthorizationPurpose, readonly AllowedScope[]>> = {
  place_suggestions_in_open_time: ['calendar.freebusy.read'],
};

/**
 * Outcome wording that says nothing. A named outcome that could be printed on
 * any product's consent screen is not a named outcome.
 */
export const VAGUE_OUTCOME_PHRASES = [
  'improve your experience',
  'better service',
  'serve you better',
  'personalization',
  'personalisation',
  'analytics',
  'product improvement',
  'to help us',
  'enhance',
  'optimize',
  'optimise',
] as const;

export interface AuthorizationLike {
  readonly scopes: readonly string[];
  readonly purpose: { readonly code: string; readonly statement: string };
  readonly named_outcome: { readonly code: string; readonly statement: string };
}

/** Check 1. Scope allowlist. */
export const checkScopesAllowed = (scopes: readonly string[], path: string): readonly Issue[] => {
  const issues: Issue[] = [];
  if (scopes.length === 0) {
    issues.push(issue(path, 'authorization/no_scope', 'an authorization must request at least one scope'));
  }
  for (let i = 0; i < scopes.length; i += 1) {
    const scope = scopes[i];
    if (scope === undefined) continue;
    if (!(ALLOWED_SCOPES as readonly string[]).includes(scope)) {
      issues.push(
        issue(
          `${path}[${i}]`,
          'authorization/scope_not_allowed',
          `"${scope}" is wider than free/busy; allowed scopes are: ${ALLOWED_SCOPES.join(', ')}`,
        ),
      );
    }
  }
  return issues;
};

/** Check 3. The named outcome must be named, and must say something. */
export const checkNamedOutcome = (
  outcome: { readonly code: string; readonly statement: string },
  path: string,
): readonly Issue[] => {
  const issues: Issue[] = [];
  if (!(NAMED_OUTCOMES as readonly string[]).includes(outcome.code)) {
    issues.push(
      issue(
        `${path}.code`,
        'authorization/outcome_not_named',
        `"${outcome.code}" is not a named outcome; allowed outcomes are: ${NAMED_OUTCOMES.join(', ')}`,
      ),
    );
  }
  const vague = matchesAnyWord(outcome.statement, VAGUE_OUTCOME_PHRASES);
  if (vague !== null) {
    issues.push(
      issue(
        `${path}.statement`,
        'authorization/outcome_vague',
        `"${vague}" is not an outcome a member can check; say what they get`,
      ),
    );
  }
  return issues;
};

/** Check 4. Every scope must be justified by the declared purpose. */
export const checkScopesJustified = (auth: AuthorizationLike, path: string): readonly Issue[] => {
  const justified = SCOPES_JUSTIFIED_BY_PURPOSE[auth.purpose.code as AuthorizationPurpose];
  if (justified === undefined) {
    return [
      issue(
        `${path}.purpose.code`,
        'authorization/purpose_not_narrow',
        `"${auth.purpose.code}" is not a declared purpose; allowed purposes are: ${AUTHORIZATION_PURPOSES.join(', ')}`,
      ),
    ];
  }
  const issues: Issue[] = [];
  for (let i = 0; i < auth.scopes.length; i += 1) {
    const scope = auth.scopes[i];
    if (scope === undefined) continue;
    if (!justified.includes(scope as AllowedScope)) {
      issues.push(
        issue(
          `${path}.scopes[${i}]`,
          'authorization/scope_unjustified',
          `"${scope}" is not consumed by purpose "${auth.purpose.code}"; nothing is collected without a feature consuming it`,
        ),
      );
    }
  }
  return issues;
};

/** All four checks, for use at the authorization boundary. */
export const checkAuthorization = (auth: AuthorizationLike, path = ''): readonly Issue[] => [
  ...checkScopesAllowed(auth.scopes, `${path}scopes`),
  ...checkNamedOutcome(auth.named_outcome, `${path}named_outcome`),
  ...checkScopesJustified(auth, path === '' ? '' : path.replace(/\.$/, '')),
];
