/**
 * Statement kinds: known / user_reported / inferred / proposed_action.
 *
 * This is the load-bearing contract of the whole package. Reboot plan §19:
 * "Why `pace_card_parts` is a table and not a JSON blob. The provenance tag is
 * load-bearing ... this is the field whose loss is unrecoverable."
 *
 * The tag is modelled as the discriminant of a union, so it is structurally
 * impossible to hold a statement without holding its kind. The rules that make
 * the tag mean something live in `guards/provenance.ts`.
 */

import {
  arrayOf,
  defineContract,
  discriminatedUnion,
  enumOf,
  literal,
  object,
  optional,
  refine,
  string,
  type Contract,
  type Infer,
  type Validator,
} from '../schema/core.ts';
import { id, instant } from '../common/primitives.ts';
import {
  CERTAINTY_MARKERS,
  HEDGE_MARKERS,
  INFERRED_SOURCE_TYPES,
  KNOWN_SOURCE_TYPES,
  USER_REPORTED_SOURCE_TYPES,
  noCertaintySchema,
  noHedgeSchema,
} from '../guards/provenance.ts';
import { matchesAnyWord } from '../schema/core.ts';

const statementText = () =>
  string({ minLength: 3, maxLength: 400, description: 'One statement, in plain language.' });

/**
 * A known statement's text may not hedge. The label being right is not enough;
 * "you are usually free at 4" tagged `known` is an inference presented as known.
 */
const knownText = (): Validator<string> =>
  refine(statementText(), {
    code: 'provenance/hedged_known',
    message: `a known statement may not hedge (${HEDGE_MARKERS.join(', ')})`,
    expressedInJsonSchema: true,
    schema: noHedgeSchema(),
    predicate: (text) => matchesAnyWord(text, HEDGE_MARKERS) === null,
  });

/** An inferred statement's text may not assert certainty. The mirror rule. */
const inferredText = (): Validator<string> =>
  refine(statementText(), {
    code: 'provenance/certain_inference',
    message: `an inferred statement may not assert certainty (${CERTAINTY_MARKERS.join(', ')})`,
    expressedInJsonSchema: true,
    schema: noCertaintySchema(),
    predicate: (text) => matchesAnyWord(text, CERTAINTY_MARKERS) === null,
  });

export const HEDGE_VOCABULARY = ['usually', 'often', 'probably', 'looks like', 'might'] as const;
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export const knownStatementValidator = object({
  statement_id: id('Statement id.'),
  kind: literal('known'),
  text: knownText(),
  source: object({
    /**
     * Closed to verifiable sources. `model_inference` is absent by construction,
     * which is what makes "an inference presented as known" a type error and not
     * a review comment.
     */
    type: enumOf(KNOWN_SOURCE_TYPES, {
      code: 'provenance/inference_as_known',
      message: `a known statement may only cite: ${KNOWN_SOURCE_TYPES.join(', ')}`,
    }),
    ref: id('The record this was read from.'),
  }),
  observed_at: instant('When the fact was observed.'),
  derived_from: optional(arrayOf(id('A statement this was derived from.'))),
});
export type KnownStatement = Infer<typeof knownStatementValidator>;

export const userReportedStatementValidator = object({
  statement_id: id('Statement id.'),
  kind: literal('user_reported'),
  text: statementText(),
  source: object({
    type: enumOf(USER_REPORTED_SOURCE_TYPES),
    ref: id('The message or tap this was captured from.'),
  }),
  reported_at: instant('When the member reported it.'),
  /**
   * Reboot plan §13: "Unverified stays unverified ... It never gets promoted to
   * a known fact." A const `false` means no code path can flip it without
   * failing the contract.
   */
  verified: literal(false),
});
export type UserReportedStatement = Infer<typeof userReportedStatementValidator>;

export const inferredStatementValidator = object({
  statement_id: id('Statement id.'),
  kind: literal('inferred'),
  text: inferredText(),
  source: object({
    type: enumOf(INFERRED_SOURCE_TYPES),
    ref: id('The model run or heuristic that produced it.'),
  }),
  /** The hedge is a field, not only a habit of phrasing. */
  hedge: enumOf(HEDGE_VOCABULARY),
  confidence: enumOf(CONFIDENCE_LEVELS),
  /** At least one thing it was inferred from. An inference from nothing is a guess. */
  basis: arrayOf(id('A record this inference rests on.'), { minItems: 1 }),
  inferred_at: instant('When the inference was made.'),
  derived_from: optional(arrayOf(id('A statement this was derived from.'))),
});
export type InferredStatement = Infer<typeof inferredStatementValidator>;

export const proposedActionStatementValidator = object({
  statement_id: id('Statement id.'),
  kind: literal('proposed_action'),
  text: statementText(),
  /** Sized to the window. Reboot plan §7: "Never three things." */
  window: object({
    starts_at: instant('Proposed window start.'),
    ends_at: instant('Proposed window end.'),
  }),
  /** No card without a goal to hang it on (reboot plan §14). */
  goal_ref: id('The goal this action serves.'),
  place_ref: optional(id('An operator-curated place, if the action has one.')),
  person_ref: optional(id('A member-stated person, if the action has one.')),
  /**
   * Reboot plan §26: the "cap is invisible" rule generalised — no manufactured
   * urgency anywhere. A const keeps it from being reintroduced as a growth lever.
   */
  urgency: literal('none'),
});
export type ProposedActionStatement = Infer<typeof proposedActionStatementValidator>;

export const statementValidator = discriminatedUnion<'kind', Statement>('kind', [
  { tag: 'known', validator: knownStatementValidator as Validator<Statement> },
  { tag: 'user_reported', validator: userReportedStatementValidator as Validator<Statement> },
  { tag: 'inferred', validator: inferredStatementValidator as Validator<Statement> },
  { tag: 'proposed_action', validator: proposedActionStatementValidator as Validator<Statement> },
]);

export type Statement = KnownStatement | UserReportedStatement | InferredStatement | ProposedActionStatement;

export const statementContract: Contract<Statement> = defineContract(
  {
    name: 'cedrus.statement',
    version: 1,
    title: 'Statement',
    description:
      'One tagged claim. The kind travels with the value from the moment it is read, never applied at render time.',
    sources: ['CEDRUS.md I.7', 'reboot plan §10 /card/$id', 'reboot plan §13', 'reboot plan §19', 'reboot plan §27 risk 12'],
  },
  statementValidator,
);
