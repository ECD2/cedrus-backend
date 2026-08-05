/**
 * Goals, and the optional goal lanes.
 *
 * Canon: reboot plan §10 (`/goals`) — up to three goals, in the member's own
 * words, three optional lanes (work / people / body), free text with ghost-text
 * examples rather than a picker, "one is enough" stated explicitly, and an
 * optional cadence stored as text rather than parsed into a schedule.
 *
 * Two rules the contract enforces that a form cannot:
 *   - the member's words are stored verbatim and separately from any normalised
 *     form, because the pace card has to quote them back;
 *   - the lane is nullable with no default. A goal we could not sort is
 *     unsorted, not guessed into "work".
 */

import {
  arrayOf,
  boolean,
  defineContract,
  enumOf,
  inspect,
  integer,
  literal,
  nullable,
  object,
  optional,
  string,
  type Contract,
  type Infer,
} from '../schema/core.ts';
import { goalLane, id, instant, memberId } from '../common/primitives.ts';
import { issue } from '../schema/core.ts';

export const GOAL_VERSION = 2;
export const GOAL_SET_VERSION = 2;

/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2: "goal_text: verbatim
 * member words, 280-char cap, reject-not-truncate."
 *
 * The lab capped at 200. The deployed service caps at 280
 * (`services/goals.js` MAX_GOAL_TEXT_CHARS) and rejects rather than truncates,
 * which is the same discipline at a different number. Leaving the contract at
 * 200 would make every legitimate 201-to-280 character goal a logged violation,
 * which is how a validation log becomes noise and then gets ignored.
 *
 * The floor of 3 is NOT relaxed to match the service, which accepts any
 * non-empty string. That difference is deliberate and is the first thing this
 * wiring actually catches.
 *
 * Lab original: 200.
 */
export const GOAL_TEXT_MAX_CHARS = 280;

/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2.
 *
 * `cedrus_inferred` is added because it is the live partition key. `user_goals`
 * holds two populations kept apart by `origin`: what a member deliberately wrote
 * (`user_set`) and what the pipeline captured from chat (`cedrus_inferred`). A
 * contract that cannot represent the second one cannot describe the table.
 * `operator_entered` is the Slice 2 addition for operator-created context.
 *
 * Only `user_set` and `operator_entered` goals may headline a pace card;
 * `cedrus_inferred` never does. That is an engine rule, not a shape rule, so it
 * is not enforced here.
 *
 * Lab original: `['user_set', 'operator_entered']`.
 */
export const GOAL_ORIGINS = ['user_set', 'cedrus_inferred', 'operator_entered'] as const;

/**
 * AMENDED AT VENDOR TIME (2026-08-05). Catalog item 2.
 *
 * The deployed `user_goals_status_check` wins. It admits exactly these four
 * values (CEDRUS.md II.5, Data model), and changing a live CHECK constraint is a
 * data migration nobody needs yet. The lab's `active | paused | retired` was a
 * clean design that no database agrees with.
 *
 * "Stale" is deliberately not a status: it is a derived property
 * (`days_since_movement`), because a goal does not stop being open by being
 * ignored.
 *
 * Lab original: `['active', 'paused', 'retired']`.
 */
export const GOAL_STATUSES = ['open', 'completed', 'missed', 'canceled'] as const;

export const goalValidator = object({
  schema_version: literal(GOAL_VERSION),
  goal_id: id('Goal id.'),
  member_id: memberId(),

  /**
   * The member's own words, verbatim. Never a category, never a rewrite. This is
   * the string a pace card quotes in its "because you said" block.
   */
  stated_text: string({ minLength: 3, maxLength: GOAL_TEXT_MAX_CHARS, description: "The goal in the member's own words." }),

  /** Nullable with no default. An unsorted goal stays unsorted. */
  lane: nullable(goalLane()),

  /** Plain language, stored as text. Deliberately not parsed into a schedule. */
  cadence_text: optional(string({ minLength: 1, maxLength: 80, description: 'e.g. "a couple of times a week".' })),

  origin: enumOf(GOAL_ORIGINS),
  status: enumOf(GOAL_STATUSES),
  /** Member-set ordering, 1 to 3. Not a score, not computed, nullable by default. */
  priority: nullable(integer({ minimum: 1, maximum: 3, description: 'Member-set rank.' })),
  created_at: instant('Created.'),
  updated_at: instant('Updated.'),
});
export type Goal = Infer<typeof goalValidator>;

export const goalContract: Contract<Goal> = defineContract(
  {
    name: 'cedrus.goal',
    version: GOAL_VERSION,
    title: 'Goal',
    description: "One goal in the member's own words, with an optional lane.",
    sources: ['reboot plan §10 /goals', 'reboot plan §19 user_goals.lane'],
  },
  goalValidator,
);

/**
 * The goal set. Three is a ceiling, one is enough, zero is a valid state for a
 * member who has not answered yet.
 */
export const goalSetValidator = inspect(
  object({
    schema_version: literal(GOAL_SET_VERSION),
    member_id: memberId(),
    goals: arrayOf(goalValidator, { maxItems: 3, description: 'Three is a ceiling. One is enough.' }),
    /** Reboot plan §10: "One is enough" is stated to the member, so it is in the contract. */
    one_is_enough_shown: boolean(),
    updated_at: instant('Updated.'),
  }),
  {
    expressedInJsonSchema: false,
    run: (set, path) => {
      const seen = new Set<string>();
      const issues = [];
      for (let i = 0; i < set.goals.length; i += 1) {
        const goal = set.goals[i];
        if (goal === undefined) continue;
        if (goal.member_id !== set.member_id) {
          issues.push(
            issue(`${path}goals[${i}].member_id`, 'goal_set/member_mismatch', 'a goal set may only hold one member\'s goals'),
          );
        }
        if (seen.has(goal.goal_id)) {
          issues.push(issue(`${path}goals[${i}].goal_id`, 'goal_set/duplicate_goal', 'duplicate goal id in the set'));
        }
        seen.add(goal.goal_id);
      }
      return issues;
    },
  },
);
export type GoalSet = Infer<typeof goalSetValidator>;

export const goalSetContract: Contract<GoalSet> = defineContract(
  {
    name: 'cedrus.goal_set',
    version: GOAL_SET_VERSION,
    title: 'Goal set',
    description: 'Up to three goals for one member. Zero is a valid state.',
    sources: ['reboot plan §10 /goals'],
  },
  goalSetValidator,
);

/** v1: before lanes existed (migration sequence #2, `user_goals.lane`). */
export const goalV1Validator = object({
  schema_version: literal(1),
  goal_id: id('Goal id.'),
  member_id: memberId(),
  stated_text: string({ minLength: 3, maxLength: 200 }),
  origin: enumOf(GOAL_ORIGINS),
  status: enumOf(GOAL_STATUSES),
  created_at: instant('Created.'),
  updated_at: instant('Updated.'),
});
export type GoalV1 = Infer<typeof goalV1Validator>;
