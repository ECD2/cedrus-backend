/**
 * Mutation controls.
 *
 * CEDRUS.md Part II Law 3: "A passing check proves nothing unless you know it
 * can fail. Before trusting a green result, break the thing it is supposed to
 * catch and prove the check goes red."
 *
 * And II.2, on what proves a new test or regression guard: "Revert the fix and
 * show the suite goes RED, then restore it ... Quote the mutation run's exit
 * code."
 *
 * This harness does that for every critical guard in the package. For each
 * mutation it:
 *
 *   1. records the original bytes of the target file,
 *   2. applies one surgical edit that disables exactly one guard,
 *   3. runs the full suite and records the exit code and which tests failed,
 *   4. restores the original bytes,
 *   5. re-runs the suite and asserts it is green again.
 *
 * A mutation whose suite stays GREEN is a failure of this harness, not a
 * success: it means the guard is untested and the green result carries no
 * information.
 *
 * Usage:  node tools/mutate.mjs [--json]
 * Exit:   0 when every mutation went red and every restore went green.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each mutation names the guard it disables, the doctrine that guard enforces,
 * and one exact string replacement. The replacement must be unique in the file:
 * the harness refuses to run if it is not, because a mutation that lands in two
 * places is not a control, it is a rewrite.
 */
const MUTATIONS = [
  {
    id: 'M01',
    guard: 'provenance: known-source allowlist',
    doctrine: 'An inference may not be presented as a known fact (reboot plan §12, §13, §27 risk 12).',
    file: 'src/guards/provenance.ts',
    find: "export const KNOWN_SOURCE_TYPES = ['calendar_freebusy', 'member_stated', 'operator_entered', 'system_record'] as const;",
    replace:
      "export const KNOWN_SOURCE_TYPES = ['calendar_freebusy', 'member_stated', 'operator_entered', 'system_record', 'model_inference', 'member_sms'] as const;",
  },
  {
    id: 'M02',
    guard: 'provenance: hedge language in a known statement',
    doctrine: 'The label can be right while the sentence lies.',
    file: 'src/guards/provenance.ts',
    find: `export const HEDGE_MARKERS = [
  'usually',`,
    replace: `export const HEDGE_MARKERS = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M03',
    guard: 'provenance: certainty language in an inferred statement',
    doctrine: 'The mirror rule. An inference asserting certainty is the same failure.',
    file: 'src/guards/provenance.ts',
    find: `export const CERTAINTY_MARKERS = [
  'definitely',`,
    replace: `export const CERTAINTY_MARKERS = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M04',
    guard: 'provenance: no laundering through derived_from',
    doctrine: 'A known statement may not be derived from an inferred or user-reported one.',
    file: 'src/guards/provenance.ts',
    find: "      if (parentKind === 'inferred' || parentKind === 'user_reported') {",
    replace: '      if (false) {',
  },
  {
    id: 'M05',
    guard: 'authorization: scope allowlist',
    doctrine: 'Request the narrowest scope that returns free/busy and no more (reboot plan §16).',
    file: 'src/guards/authorization.ts',
    find: "export const ALLOWED_SCOPES = ['calendar.freebusy.read'] as const;",
    replace: "export const ALLOWED_SCOPES = ['calendar.freebusy.read', 'calendar.events.read', 'calendar.readonly', 'https://www.googleapis.com/auth/calendar'] as const;",
  },
  {
    id: 'M06',
    guard: 'authorization: named outcome must not be vague',
    doctrine: 'An outcome that could be printed on any consent screen is not a named outcome.',
    file: 'src/guards/authorization.ts',
    find: `export const VAGUE_OUTCOME_PHRASES = [
  'improve your experience',`,
    replace: `export const VAGUE_OUTCOME_PHRASES = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M07',
    guard: 'authorization: every scope justified by the declared purpose',
    doctrine: 'Nothing is collected without a shipped feature consuming it (reboot plan §18).',
    file: 'src/guards/authorization.ts',
    find: '    if (!justified.includes(scope as AllowedScope)) {',
    replace: '    if (false) {',
  },
  {
    id: 'M08',
    guard: 'calendar: forbidden field list',
    doctrine: 'Never store, never request, never log titles, descriptions, locations, attendees (reboot plan §17).',
    file: 'src/guards/calendar-boundary.ts',
    find: `export const FORBIDDEN_CALENDAR_FIELDS = [
  'title',`,
    replace: `export const FORBIDDEN_CALENDAR_FIELDS = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M09',
    guard: 'calendar: fetch-boundary assertion throws',
    doctrine: 'The enforcement point is the fetch, not the render.',
    file: 'src/guards/calendar-boundary.ts',
    find: '  if (issues.length > 0) throw new CalendarBoundaryViolation(issues);',
    replace: '  if (issues.length > 999) throw new CalendarBoundaryViolation(issues);',
  },
  {
    id: 'M10',
    guard: 'objects are closed to unknown keys',
    doctrine: 'An unknown key on a calendar payload is how a title reaches the logs.',
    file: 'src/schema/core.ts',
    find: `          issues.push(issue(join(path, key), 'object/unknown_key', \`unknown field "\${key}" is not permitted\`));`,
    replace: '          void key;',
  },
  {
    id: 'M11',
    guard: 'fabrication: a count must equal the records it cites',
    doctrine: 'No fabricated activity counts, ever. If three people are going, it says three (CEDRUS.md I.7.3).',
    file: 'src/guards/fabrication.ts',
    find: '  if (count.value !== count.source_refs.length) {',
    replace: '  if (false) {',
  },
  {
    id: 'M12',
    guard: 'fabrication: no scores, streaks or engagement metrics',
    doctrine: 'An inferred score is a fabricated count wearing a chart (reboot plan §13, §19).',
    file: 'src/guards/fabrication.ts',
    find: `export const FORBIDDEN_PROGRESS_FIELDS = [
  'score',`,
    replace: `export const FORBIDDEN_PROGRESS_FIELDS = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M13',
    guard: 'fabrication: a person may not be invented',
    doctrine: 'A person exists because the member or an operator said so.',
    file: 'src/guards/fabrication.ts',
    find: "export const PERSON_ORIGINS = ['member_stated', 'operator_entered'] as const;",
    replace: "export const PERSON_ORIGINS = ['member_stated', 'operator_entered', 'model_inference', 'generated'] as const;",
  },
  {
    id: 'M14',
    guard: 'fabrication: no contact disclosure in a projection',
    doctrine: 'Phone numbers are not revealed before both people consent, per introduction (CEDRUS.md I.7.5).',
    file: 'src/guards/fabrication.ts',
    find: `export const FORBIDDEN_CONTACT_FIELDS = [
  'phone',`,
    replace: `export const FORBIDDEN_CONTACT_FIELDS = [
  '__disabled_by_mutation__',`,
  },
  {
    id: 'M15',
    guard: 'Today: stated timing may not be presented as known',
    doctrine: '"Usually open" becomes "open" only with a calendar, and the label changes with it (reboot plan §12).',
    file: 'src/contracts/today.ts',
    find: "    if (today.timing_basis === 'stated' && today.day_line.kind !== 'inferred') {",
    replace: '    if (false) {',
  },
  {
    id: 'M16',
    guard: 'Today: a fallback is announced, never silent',
    doctrine: 'It does not silently start guessing while looking certain (reboot plan §12, Lesson 7).',
    file: 'src/contracts/today.ts',
    find: '    if (needsNotice && today.fallback_notice === null) {',
    replace: '    if (false) {',
  },
  {
    id: 'M17',
    guard: 'pace card: exactly one proposed action',
    doctrine: 'Two cards means neither is the one thing (reboot plan §14).',
    file: 'src/contracts/pace-card.ts',
    find: '  if (proposals.length !== 1) {',
    replace: '  if (false) {',
  },
  {
    id: 'M18',
    guard: 'pace card: reviewed before delivery',
    doctrine: 'Every card is reviewed by Emil before delivery (reboot plan §14).',
    file: 'src/contracts/pace-card.ts',
    find: '    if (card.review_ref === null) {',
    replace: '    if (false) {',
  },
  {
    id: 'M19',
    guard: 'consent: bundled and preselected are impossible',
    doctrine: 'Bundled or preselected consent causes A2P rejection, which takes the assistant offline (CEDRUS.md I.15).',
    file: 'src/contracts/consent.ts',
    find: '  bundled: literal(false),\n  preselected: literal(false),',
    replace: '  bundled: boolean(),\n  preselected: boolean(),',
  },
  {
    id: 'M20',
    guard: 'consent: the exact wording is required',
    doctrine: 'Record the exact wording the person agreed to. It is the defensible record (CEDRUS.md I.15).',
    file: 'src/contracts/consent.ts',
    find: '  exact_wording: string({\n    minLength: 20,',
    replace: '  exact_wording: string({\n    minLength: 0,',
  },
  {
    id: 'M21',
    guard: 'agent request: out of scope is logged and answered honestly',
    doctrine: 'Anything outside the four jobs gets an honest answer and a logged request (CEDRUS.md I.6.4).',
    file: 'src/contracts/agent-request.ts',
    find: "      if (request.response_kind === 'answered') {",
    replace: '      if (false) {',
  },
  {
    id: 'M22',
    guard: 'agent request: safety replies are never tone shifted',
    doctrine: 'STOP, HELP and distress stay in a fixed register regardless of setting (CEDRUS.md I.6.4).',
    file: 'src/contracts/agent-request.ts',
    find: '      if (request.voice_applied) {',
    replace: '      if (false) {',
  },
  {
    id: 'M23',
    guard: 'operator review: every kill and edit carries a reason',
    doctrine: 'That log is the training signal for what to automate (reboot plan §14).',
    file: 'src/contracts/operator-review.ts',
    find: '      if (review.reason_code === null) {',
    replace: '      if (false) {',
  },
  {
    id: 'M24',
    guard: 'analytics: vanity metrics are rejected',
    doctrine: 'No vanity metrics on any dashboard (reboot plan §24).',
    file: 'src/contracts/analytics.ts',
    find: '      if (typeof name === \'string\' && (VANITY_EVENT_NAMES as readonly string[]).includes(name)) {',
    replace: '      if (false) {',
  },
  {
    id: 'M25',
    guard: 'envelope: credentials never travel',
    doctrine: 'connection_tokens is the one table where a grant mistake is a credential leak (reboot plan §20).',
    file: 'src/contracts/envelope.ts',
    // Targets the check rather than the first list entry. An earlier version of
    // this mutation replaced FORBIDDEN_ENVELOPE_FIELDS[0] ('accesstoken') and
    // the suite stayed green, because the counterexample carries a
    // `refresh_token` instead. The harness reported that correctly as an
    // uncontrolled guard; the fix was to the mutation, not to the guard.
    find: '      if (FORBIDDEN_SET.has(normaliseKey(node.key))) {',
    replace: '      if (false) {',
  },
  {
    id: 'M26',
    guard: 'migration: a value that cannot be known is never invented',
    doctrine: 'Record silence explicitly rather than inferring it from absence (reboot plan §24, Lesson 5).',
    file: 'src/migrate/migrations.ts',
    find: "    const source = outcome === 'silent' ? 'no_response' : 'unknown';",
    replace: "    const source = outcome === 'silent' ? 'no_response' : 'tap';",
  },
  {
    id: 'M27',
    guard: 'migration: a connection cannot be upgraded without a named outcome',
    doctrine: 'Manufacturing consent for a disclosure that never happened is worse than no row.',
    file: 'src/migrate/migrations.ts',
    find: '    if (purpose === undefined || namedOutcome === undefined || disclosure === undefined) {',
    replace: '    if (false) {',
  },
  {
    id: 'M28',
    guard: 'JSON Schema drift detection',
    doctrine: 'A validator change that skips the schema regeneration must not pass silently.',
    // Retargeted at vendor time (2026-08-05): amendment 6 replaced the literal
    // 200 with GOAL_TEXT_MAX_CHARS, so the old find-string no longer exists.
    // The harness REFUSED rather than reporting a pass, which is the behaviour
    // D-12 records and the reason it is trusted. Same mutation, current text.
    file: 'src/contracts/goals.ts',
    find: "  stated_text: string({ minLength: 3, maxLength: GOAL_TEXT_MAX_CHARS, description: \"The goal in the member's own words.\" }),",
    replace: "  stated_text: string({ minLength: 4, maxLength: GOAL_TEXT_MAX_CHARS, description: \"The goal in the member's own words.\" }),",
  },
  {
    id: 'M29',
    guard: 'availability: the basis and the notice must agree',
    doctrine: 'Today always says which one it is (reboot plan §10, §12).',
    file: 'src/contracts/calendar.ts',
    find: "    predicate: (a) => (a.basis === 'stated' ? a.fallback_notice !== null : a.fallback_notice === null),",
    replace: '    predicate: () => true,',
  },
  {
    id: 'M30',
    guard: 'progression: progress may not exceed its evidence',
    doctrine: 'Progression reads outcomes directly; a number without records behind it is fabricated.',
    file: 'src/contracts/pillars.ts',
    find: '      if (line.confirmed_helped.value > line.outcomes_recorded.value) {',
    replace: '      if (false) {',
  },
];

const runSuite = () => {
  const result = spawnSync('node', ['--test', 'test/**/*.test.ts'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const failed = [...stdout.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  const passMatch = /^ℹ pass (\d+)$/m.exec(stdout);
  const failMatch = /^ℹ fail (\d+)$/m.exec(stdout);
  return {
    exitCode: result.status ?? -1,
    pass: passMatch ? Number(passMatch[1]) : -1,
    fail: failMatch ? Number(failMatch[1]) : -1,
    failedTests: [...new Set(failed)],
  };
};

const main = () => {
  const asJson = process.argv.includes('--json');

  const baseline = runSuite();
  if (baseline.exitCode !== 0) {
    process.stderr.write('baseline suite is not green; fix that before running mutation controls\n');
    process.exit(2);
  }
  process.stdout.write(`baseline: exit ${baseline.exitCode}, ${baseline.pass} passing\n\n`);

  const results = [];
  let harnessFailures = 0;

  for (const mutation of MUTATIONS) {
    const path = join(root, mutation.file);
    const original = readFileSync(path, 'utf8');

    const occurrences = original.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      process.stderr.write(`${mutation.id}: target string appears ${occurrences} times in ${mutation.file}; refusing\n`);
      harnessFailures += 1;
      results.push({ ...mutation, status: 'target_not_unique', occurrences });
      continue;
    }

    writeFileSync(path, original.replace(mutation.find, mutation.replace), 'utf8');
    let mutated;
    try {
      mutated = runSuite();
    } finally {
      writeFileSync(path, original, 'utf8');
    }

    const restored = runSuite();
    const wentRed = mutated.exitCode !== 0;
    const restoredGreen = restored.exitCode === 0;
    if (!wentRed || !restoredGreen) harnessFailures += 1;

    const line = `${mutation.id} ${wentRed && restoredGreen ? 'PASS' : 'FAIL'}  ` +
      `mutated exit=${mutated.exitCode} fail=${mutated.fail}  restored exit=${restored.exitCode}  ${mutation.guard}`;
    process.stdout.write(`${line}\n`);
    if (!wentRed) process.stdout.write(`  ^ SUITE STAYED GREEN: this guard is not covered by any test\n`);

    results.push({
      id: mutation.id,
      guard: mutation.guard,
      doctrine: mutation.doctrine,
      file: mutation.file,
      mutation: `${mutation.find.split('\n')[0]}  ->  ${mutation.replace.split('\n')[0]}`,
      mutated_exit_code: mutated.exitCode,
      mutated_failing_tests: mutated.failedTests,
      mutated_fail_count: mutated.fail,
      restored_exit_code: restored.exitCode,
      restored_pass_count: restored.pass,
      status: wentRed && restoredGreen ? 'controlled' : 'UNCONTROLLED',
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    baseline_exit_code: baseline.exitCode,
    baseline_pass_count: baseline.pass,
    mutations_run: MUTATIONS.length,
    controlled: results.filter((r) => r.status === 'controlled').length,
    uncontrolled: results.filter((r) => r.status !== 'controlled').length,
    results,
  };

  writeFileSync(join(root, 'tools', 'mutation-results.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (asJson) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(
    `\n${summary.controlled}/${summary.mutations_run} mutations controlled. ` +
      `Results written to tools/mutation-results.json\n`,
  );
  process.exit(harnessFailures === 0 ? 0 : 1);
};

main();
