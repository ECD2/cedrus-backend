/**
 * Guard: no fabricated people, counts, or progress.
 *
 * Canon:
 *   - CEDRUS.md Part I §7 item 3: "No fabricated activity counts, ever. If three
 *     people are going, it says three."
 *   - CEDRUS.md Part I §4: Progression "explicitly does not count: opening
 *     Cedrus, completing tasks, app streaks, messages sent, or arbitrary
 *     wellness goals."
 *   - Reboot plan §8: "Unfinished is labelled, never mocked. No placeholder
 *     data, ever (this is a trust-law adjacent rule: fabricated content and
 *     fabricated counts are the same failure)."
 *   - Reboot plan §13: "No streaks and no scores derived from it ... an inferred
 *     score is a fabricated count wearing a chart."
 *   - Reboot plan §19: "What is deliberately absent: any score, streak, points,
 *     level, or health metric."
 *
 * Three checks:
 *   1. COUNTS   — a count's value must equal the number of records it cites.
 *   2. SCORES   — no score, streak, points, level, rank, or wellness metric may
 *                 appear anywhere in a progression payload.
 *   3. PEOPLE   — a person may only exist because the member or the operator
 *                 said so, and a person projection may not carry contact
 *                 details.
 */

import { issue, walk, type Issue } from '../schema/core.ts';

export interface CountLike {
  readonly value: number;
  readonly basis: string;
  readonly source_refs: readonly string[];
}

/**
 * Check 1. A count must be able to name every thing it counted.
 *
 * This is the mechanical form of "if three people are going, it says three":
 * a `value` of 3 needs 3 refs. A count with a value and no refs is the exact
 * shape of a fabricated count, and it is rejected.
 */
export const checkCountIsDerived = (count: CountLike, path: string): readonly Issue[] => {
  if (count.value !== count.source_refs.length) {
    return [
      issue(
        path,
        'fabrication/count_not_derived',
        `count says ${count.value} but cites ${count.source_refs.length} record(s); a count must name what it counted`,
      ),
    ];
  }
  const seen = new Set(count.source_refs);
  if (seen.size !== count.source_refs.length) {
    return [issue(path, 'fabrication/count_duplicate_refs', 'a count may not cite the same record twice')];
  }
  return [];
};

/**
 * Field names banned from progression and from anything a member is shown as
 * "how it is going". Normalised the same way as the calendar guard.
 */
export const FORBIDDEN_PROGRESS_FIELDS = [
  'score',
  'streak',
  'streaks',
  'points',
  'level',
  'rank',
  'xp',
  'badge',
  'badges',
  'healthscore',
  'wellnessscore',
  'consistencyscore',
  'grade',
  'percentcomplete',
  'completionrate',
  'multiplier',
  'combo',
] as const;

/**
 * Metrics Cedrus refuses to count even when they are real, because counting
 * them makes the product about itself (CEDRUS.md Part I §4).
 */
export const FORBIDDEN_ENGAGEMENT_FIELDS = [
  'appopens',
  'opens',
  'sessions',
  'pageviews',
  'messagessent',
  'taskscompleted',
  'loginstreak',
  'timeinapp',
] as const;

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const PROGRESS_SET: ReadonlySet<string> = new Set([...FORBIDDEN_PROGRESS_FIELDS, ...FORBIDDEN_ENGAGEMENT_FIELDS]);

/** Check 2. No score, streak, or engagement metric anywhere in the payload. */
export const findFabricatedProgress = (payload: unknown, path = ''): readonly Issue[] => {
  const issues: Issue[] = [];
  walk(payload, path, (node) => {
    if (node.key === null) return;
    const normalised = normaliseKey(node.key);
    if (PROGRESS_SET.has(normalised)) {
      issues.push(
        issue(
          node.path,
          'fabrication/derived_score',
          `"${node.key}" is a derived score or engagement metric; Progression reads outcomes directly (reboot plan §19)`,
        ),
      );
    }
  });
  return issues;
};

/**
 * Check 3a. Origins a person record may have. A person exists because someone
 * said so. `model_inference` and `generated` are not origins.
 */
export const PERSON_ORIGINS = ['member_stated', 'operator_entered'] as const;

export const checkPersonOrigin = (origin: string, path: string): readonly Issue[] => {
  if ((PERSON_ORIGINS as readonly string[]).includes(origin)) return [];
  return [
    issue(
      path,
      'fabrication/invented_person',
      `a person may not originate from "${origin}"; allowed origins are: ${PERSON_ORIGINS.join(', ')}`,
    ),
  ];
};

/**
 * Check 3b. Contact details never appear in a people projection.
 * CEDRUS.md Part I §7 item 5: phone numbers are not revealed before both people
 * consent, per introduction. The safe form is that the projection has no field
 * that could carry one.
 */
export const FORBIDDEN_CONTACT_FIELDS = [
  'phone',
  'phonee164',
  'phonenumber',
  'mobile',
  'email',
  'emailaddress',
  'instagram',
  'handle',
  'address',
  'homeaddress',
] as const;

const CONTACT_SET: ReadonlySet<string> = new Set(FORBIDDEN_CONTACT_FIELDS);

export const findContactDisclosure = (payload: unknown, path = ''): readonly Issue[] => {
  const issues: Issue[] = [];
  walk(payload, path, (node) => {
    if (node.key === null) return;
    if (CONTACT_SET.has(normaliseKey(node.key))) {
      issues.push(
        issue(
          node.path,
          'fabrication/contact_disclosure',
          `"${node.key}" would disclose contact details; introductions are double opt-in and per person (CEDRUS.md I.7.5)`,
        ),
      );
    }
  });
  return issues;
};

export const forbiddenProgressPropertyNamesSchema = (): { [key: string]: unknown } => ({
  propertyNames: {
    not: { enum: [...FORBIDDEN_PROGRESS_FIELDS, ...FORBIDDEN_ENGAGEMENT_FIELDS] },
  },
});
